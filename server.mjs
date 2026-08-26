#!/usr/bin/env node
// Tiny static server + todos.md read/write API. Stdlib only, zero deps.
//
//   node server.mjs [--port 4444] [--file todos.md]
//
// Env:
//   TODO_PORT           override port (default 4444)
//   TODO_FILE           path to the markdown ground truth (default ./todos.md)
//   TODO_AUTOCOMMIT=1   git-commit the file a few seconds after each write
//
// API:
//   GET  /todos   -> { text, etag }        etag is the file mtime
//   PUT  /todos   body { text, etag }      412 if etag is stale, else writes atomically
// Everything else is served as a static file from this directory.

import { createServer } from "node:http";
import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, extname, normalize } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const argVal = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const PORT = Number(argVal("--port") || process.env.TODO_PORT || 4444);
const FILE = resolve(HERE, argVal("--file") || process.env.TODO_FILE || "todos.md");
const AUTOCOMMIT = process.env.TODO_AUTOCOMMIT === "1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
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

let commitTimer = null;
function scheduleCommit() {
  if (!AUTOCOMMIT) return;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(async () => {
    const repo = await run("git", ["rev-parse", "--show-toplevel"], { cwd: HERE });
    if (repo.err) return;
    const root = repo.stdout.trim();
    await run("git", ["-C", root, "add", FILE]);
    const diff = await run("git", ["-C", root, "diff", "--cached", "--quiet", "--", FILE]);
    if (!diff.err) return; // nothing staged
    await run("git", ["-C", root, "commit", "-m", "todo: sync", "--", FILE]);
  }, 8000);
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

  // static files
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/") rel = "/index.html";
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
  console.log(`autocommit ${AUTOCOMMIT ? "on" : "off (set TODO_AUTOCOMMIT=1 to enable)"}`);
});
