#!/usr/bin/env node
// Tiny static server + todos.md read/write API. Stdlib only, zero deps.
//
//   node server.mjs [--port 4444] [--file todos.md]
//
// Env:
//   TODO_PORT           override port (default 4444)
//   TODO_FILE           path to the markdown ground truth (default ./todos.md).
//                       The data lives in its own repo — point this at a checkout
//                       of it (e.g. ~/life/todo-data/todos.md); autosave commits
//                       *that* repo, not the app code.
//   TODO_AUTOCOMMIT     git-commit todos.md ~8s after the last edit (a burst of
//                       edits becomes one "todo: autosave <date> <time>" commit).
//                       ON by default; set TODO_AUTOCOMMIT=0 to disable.
//   TODO_AUTOPUSH       also push after committing, rebasing onto any concurrent
//                       push first. ON by default; set TODO_AUTOPUSH=0 to keep
//                       commits local. (Disabling autocommit disables push too.)
//   TODO_PASSWORD       if set, gate /todos and /config behind a password (a
//                       signed cookie via /login). Unset = no auth. Set it once
//                       the server is reachable from outside localhost/LAN.
//
// API:
//   GET  /todos    -> { text, etag }        etag is the file mtime
//   PUT  /todos    body { text, etag }      412 if etag is stale, else writes atomically
//   GET/PUT /config                         UI prefs (key bindings); gated with /todos
//   POST /capture  body { title, url?, due?, note? }   appends one task (see below);
//                  CORS-open so the browser-extension/bookmarklet can call it from
//                  any origin — it can only ever add a line to todos.md, nothing else.
//   GET  /         desktop app   ·   GET /m   mobile app
// Everything else is served as a static file from this directory.

import { createServer } from "node:http";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, normalize } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as P from "./parse.js";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORT = Number(argVal("--port") || process.env.TODO_PORT || 4444);
const FILE = resolve(HERE, argVal("--file") || process.env.TODO_FILE || "todos.md");
// UI prefs (currently just key bindings). Local to this machine, not committed.
const CONFIG = resolve(HERE, "todo.config.json");
// both on by default — the point of this app is that todos.md is never stranded
// on one machine. Opt out with TODO_AUTOCOMMIT=0 (all local) or TODO_AUTOPUSH=0.
const AUTOCOMMIT = process.env.TODO_AUTOCOMMIT !== "0";
const AUTOPUSH = AUTOCOMMIT && process.env.TODO_AUTOPUSH !== "0";

// Optional password gate. TODO_PASSWORD unset -> no auth (localhost / same-LAN
// use is unchanged). Set it once the server is reachable from outside (Tailscale,
// the always-on Linux box, a port-forward). A correct password sets a long-lived
// signed cookie; only the data endpoints are gated, static assets stay open so
// the login page can load. /capture stays open regardless — it can only ever
// append one task, and the deployment is assumed to sit behind Tailscale/LAN.
const PASSWORD = process.env.TODO_PASSWORD || "";
const AUTH = PASSWORD.length > 0;
const SESSION = AUTH ? createHmac("sha256", PASSWORD).update("todo-session-v1").digest("hex") : "";

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function authed(req) {
  if (!AUTH) return true;
  const tok = cookies(req).todo_session || "";
  if (tok.length !== SESSION.length) return false;
  try {
    return timingSafeEqual(Buffer.from(tok), Buffer.from(SESSION));
  } catch {
    return false;
  }
}

function sessionCookie(req) {
  const secure = req.headers["x-forwarded-proto"] === "https" || req.socket.encrypted ? "; Secure" : "";
  return `todo_session=${SESSION}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure}`;
}

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const LOGIN_HTML = (err, next) => `<!doctype html><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>todo · sign in</title>
<style>
  body{background:#14161a;color:#d9dee7;font:15px/1.5 ui-monospace,Menlo,monospace;
    display:grid;place-items:center;min-height:100vh;margin:0}
  form{display:grid;gap:12px;width:min(320px,80vw)}
  h1{font-size:16px;font-weight:600;margin:0 0 4px}
  input{font:inherit;padding:12px;border-radius:8px;border:1px solid #2c313b;
    background:#1b1e24;color:#d9dee7}
  button{font:inherit;padding:12px;border-radius:8px;border:0;
    background:#6ea8fe;color:#0b1220;font-weight:600;cursor:pointer}
  .err{color:#ff7a7a;font-size:13px;min-height:1em}
</style>
<form method=POST action="/login?next=${encodeURIComponent(next && next.startsWith("/") ? next : "/")}">
  <h1>todo</h1>
  <div class=err>${err ? "wrong password" : ""}</div>
  <input type=password name=password placeholder=password autofocus autocomplete=current-password>
  <button>sign in</button>
</form>`;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

async function etagOf(path) {
  try {
    const s = await stat(path);
    return String(Math.round(s.mtimeMs));
  } catch {
    return "0";
  }
}

const run = (cmd, cmdArgs, opts) =>
  new Promise((res) => execFile(cmd, cmdArgs, opts, (err, stdout, stderr) => res({ err, stdout, stderr })));

const pad = (n) => String(n).padStart(2, "0");
function stamp(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let committing = false;
let commitTimer = null;

// Debounced (see scheduleCommit): a burst of edits collapses into one commit.
// Operates on whichever git repo holds todos.md — which is its own repo once the
// data is split out from the app code (TODO_FILE points into that checkout).
async function autosave() {
  if (committing) return scheduleCommit();
  committing = true;
  try {
    const repo = await run("git", ["rev-parse", "--show-toplevel"], { cwd: dirname(FILE) });
    if (repo.err) return;
    const g = (a) => run("git", ["-C", repo.stdout.trim(), ...a.filter((x) => x != null)]);

    await g(["add", "--", FILE]);
    if (!(await g(["diff", "--cached", "--quiet", "--", FILE])).err) return; // nothing changed

    await g(["commit", "-m", `todo: autosave ${stamp()}`, "--", FILE]);
    if (!AUTOPUSH) return;

    // Other Claude sessions may share this repo — rebase onto any concurrent push.
    if ((await g(["push", "origin", "main"])).err) {
      await g(["pull", "--rebase", "--autostash", "origin", "main"]);
      await g(["push", "origin", "main"]);
    }
  } finally {
    committing = false;
  }
}

function scheduleCommit() {
  if (!AUTOCOMMIT) return;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => void autosave(), 8000);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/login") {
    if (!AUTH) return send(res, 302, "", { Location: "/" });
    const next = url.searchParams.get("next") || "/";
    if (req.method === "GET") {
      return send(res, 200, LOGIN_HTML(url.searchParams.get("err"), next), { "Content-Type": MIME[".html"] });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      let pw = "";
      const ct = req.headers["content-type"] || "";
      if (ct.includes("application/json")) {
        try { pw = String(JSON.parse(body).password || ""); } catch {}
      } else {
        pw = new URLSearchParams(body).get("password") || "";
      }
      const ok =
        pw.length === PASSWORD.length &&
        (() => { try { return timingSafeEqual(Buffer.from(pw), Buffer.from(PASSWORD)); } catch { return false; } })();
      const dest = next.startsWith("/") ? next : "/";
      if (!ok) return send(res, 303, "", { Location: "/login?err=1&next=" + encodeURIComponent(dest) });
      return send(res, 303, "", { Location: dest, "Set-Cookie": sessionCookie(req) });
    }
    return send(res, 405, "method not allowed");
  }

  if (url.pathname === "/logout") {
    return send(res, 303, "", {
      Location: "/login",
      "Set-Cookie": "todo_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
    });
  }

  // gate the data endpoints (not static assets, not /capture)
  if (AUTH && !authed(req) && ["/todos", "/config"].includes(url.pathname)) {
    return send(res, 401, JSON.stringify({ error: "auth" }), { "Content-Type": MIME[".json"] });
  }

  if (url.pathname === "/todos") {
    if (req.method === "GET") {
      let text = "";
      try {
        text = await readFile(FILE, "utf8");
      } catch {
        text = "# Todos\n\n## Done\n";
      }
      return send(res, 200, JSON.stringify({ text, etag: await etagOf(FILE) }), {
        "Content-Type": MIME[".json"],
      });
    }
    if (req.method === "PUT") {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, JSON.stringify({ error: "bad json" }), { "Content-Type": MIME[".json"] });
      }
      const current = await etagOf(FILE);
      if (payload.etag != null && String(payload.etag) !== current) {
        return send(res, 412, JSON.stringify({ error: "stale", etag: current }), {
          "Content-Type": MIME[".json"],
        });
      }
      const tmp = FILE + ".tmp-" + process.pid;
      await writeFile(tmp, String(payload.text ?? ""), "utf8");
      await rename(tmp, FILE);
      scheduleCommit();
      return send(res, 200, JSON.stringify({ ok: true, etag: await etagOf(FILE) }), {
        "Content-Type": MIME[".json"],
      });
    }
    return send(res, 405, "method not allowed");
  }

  if (url.pathname === "/config") {
    if (req.method === "GET") {
      let cfg = "{}";
      try {
        cfg = await readFile(CONFIG, "utf8");
      } catch {}
      return send(res, 200, cfg, { "Content-Type": MIME[".json"] });
    }
    if (req.method === "PUT") {
      let payload;
      try {
        payload = JSON.parse(await readBody(req));
      } catch {
        return send(res, 400, JSON.stringify({ error: "bad json" }), { "Content-Type": MIME[".json"] });
      }
      const tmp = CONFIG + ".tmp-" + process.pid;
      await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
      await rename(tmp, CONFIG);
      return send(res, 200, JSON.stringify({ ok: true }), { "Content-Type": MIME[".json"] });
    }
    return send(res, 405, "method not allowed");
  }

  if (url.pathname === "/capture") {
    // Called from the job-posting bookmarklet, which runs on whatever site the
    // posting lives on — so this is deliberately CORS-open. It can only ever
    // append one well-formed task to todos.md; nothing it accepts can overwrite
    // or delete existing content.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (req.method !== "POST") return send(res, 405, "method not allowed");

    let payload;
    try {
      payload = JSON.parse(await readBody(req));
    } catch {
      return send(res, 400, JSON.stringify({ error: "bad json" }), { "Content-Type": MIME[".json"] });
    }
    const title = String(payload.title || "").trim();
    if (!title) {
      return send(res, 400, JSON.stringify({ error: "title required" }), { "Content-Type": MIME[".json"] });
    }

    let text = "";
    try {
      text = await readFile(FILE, "utf8");
    } catch {
      text = "# Todos\n\n## Done\n";
    }
    const model = P.parse(text);
    const today = P.iso(new Date());
    const due = /^\d{4}-\d{2}-\d{2}$/.test(payload.due || "") ? payload.due : null;
    let raw = `- [ ] ${title} +industry-job-application`;
    if (due) raw += ` due:${due}`;
    raw += ` created:${today}`;
    const it = P.parse(raw).items[0];
    if (payload.url) it.link = String(payload.url).trim();
    if (payload.note) it.notes = [String(payload.note).trim()];

    // same insertion point as the app's own quick-capture: top of the active list
    const items = model.items;
    const firstDone = items.findIndex((x) => x.done && x.depth === 0);
    items.splice(firstDone < 0 ? items.length : firstDone, 0, it);
    P.ensureIds(items);

    const tmp = FILE + ".tmp-" + process.pid;
    await writeFile(tmp, P.serialize(model), "utf8");
    await rename(tmp, FILE);
    scheduleCommit();
    return send(res, 200, JSON.stringify({ ok: true, id: it.id }), { "Content-Type": MIME[".json"] });
  }

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
  if (rel === "/m" || rel === "/m/") rel = "/mobile.html";
  const path = join(HERE, normalize(rel));
  if (!path.startsWith(HERE)) return send(res, 403, "no");
  try {
    const data = await readFile(path);
    return send(res, 200, data, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
  } catch {
    return send(res, 404, "not found");
  }
});

server.listen(PORT, () => {
  console.log(`todo app   http://localhost:${PORT}`);
  console.log(`ground truth ${FILE}`);
  console.log(
    `autocommit ${
      AUTOPUSH ? "on + push" : AUTOCOMMIT ? "on (local; TODO_AUTOPUSH=0 set)" : "off (TODO_AUTOCOMMIT=0 set)"
    }`
  );
  console.log(`auth       ${AUTH ? "on (TODO_PASSWORD set)" : "off — open to anyone who can reach this port"}`);
});

// flush pending edits on the way out
let closing = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (closing) process.exit(0);
    closing = true;
    clearTimeout(commitTimer);
    if (AUTOCOMMIT) await autosave();
    process.exit(0);
  });
}
