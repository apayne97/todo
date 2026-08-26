// Parse and serialize todos.md. Pure functions, no DOM — also runs under node for tests.

// ---------- dates ----------

export function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function addUnit(d, n, u) {
  const x = new Date(d);
  if (u === "d") x.setDate(x.getDate() + n);
  else if (u === "w") x.setDate(x.getDate() + n * 7);
  else if (u === "m") x.setMonth(x.getMonth() + n);
  else if (u === "y") x.setFullYear(x.getFullYear() + n);
  return x;
}

export function daysBetween(aISO, bISO) {
  return Math.round((parseISO(aISO) - parseISO(bISO)) / 86400000);
}

// The Monday that starts *next* week. Sunday counts as the end of the current week.
export function nextMonday(from = new Date()) {
  const x = new Date(from);
  x.setHours(0, 0, 0, 0);
  let delta = (8 - x.getDay()) % 7; // Sun->1, Tue->6, ...
  if (delta === 0) delta = 7; // today is Monday -> +7
  return addDays(x, delta);
}

// Last day (Sunday) of the current week, given today.
export function weekEndISO(todayISO) {
  const d = parseISO(todayISO);
  const toSun = (7 - d.getDay()) % 7;
  return iso(addDays(d, toSun));
}

const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DOW3 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Turn free-form date text into an ISO string (or null).
export function parseDateInput(raw, baseISO) {
  let s = String(raw || "").trim().toLowerCase();
  if (!s) return null;
  const base = parseISO(baseISO) || new Date();
  base.setHours(0, 0, 0, 0);

  if (s === "today") return iso(base);
  if (s === "tomorrow" || s === "tmr" || s === "tom") return iso(addDays(base, 1));
  if (s === "yesterday") return iso(addDays(base, -1));
  if (s === "next week" || s === "nextweek") return iso(nextMonday(base));

  let rel = /^\+(\d+)\s*([dwmy])$/.exec(s);
  if (rel) return iso(addUnit(base, Number(rel[1]), rel[2]));
  if (/^\+(\d+)$/.exec(s)) return iso(addDays(base, Number(s.slice(1))));

  let next = false;
  if (s.startsWith("next ")) { next = true; s = s.slice(5).trim(); }
  let di = DOW.indexOf(s);
  if (di < 0) di = DOW3.indexOf(s);
  if (di >= 0) {
    let delta = (di - base.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // a bare weekday name means the next one, not today
    if (next) delta += 7;
    return iso(addDays(base, delta));
  }

  if (parseISO(s)) return s;

  let md = /^(\d{1,2})[/-](\d{1,2})$/.exec(s);
  if (md) {
    let y = base.getFullYear();
    let cand = new Date(y, Number(md[1]) - 1, Number(md[2]));
    cand.setHours(0, 0, 0, 0);
    if (cand < base) cand.setFullYear(y + 1);
    return iso(cand);
  }
  return null;
}

// ---------- item tokens ----------

function blankItem(depth, done) {
  return {
    depth, done,
    title: "",
    projects: [],
    sched: null,
    due: null,
    created: null,
    doneDate: null,
    repeat: null, // { kind: "+"|".", n, u }
    needs: [],
    bumps: 0,
    pri: null,
    id: null,
    extra: [], // unknown tokens, preserved verbatim
    notes: [],
    link: null, // a single URL, stored on its own "link: …" line
  };
}

const LINK_RE = /^link:\s+(\S+)$/i;

const TOKEN_TESTS = [
  /^\+[\w-]+$/,
  /^sched:\d{4}-\d{2}-\d{2}$/,
  /^due:\d{4}-\d{2}-\d{2}$/,
  /^created:\d{4}-\d{2}-\d{2}$/,
  /^done:\d{4}-\d{2}-\d{2}$/,
  /^repeat:[+.]\d+[dwmy]$/,
  /^needs:[\w,-]+$/,
  /^bumps:\d+$/,
  /^pri:[ABCabc]$/,
  /^id:[\w-]+$/,
];

function looksLikeToken(tok) {
  if (TOKEN_TESTS.some((re) => re.test(tok))) return true;
  // unknown key:value metadata (kept verbatim), but not a URL or "word: word"
  return /^[a-z][\w-]*:[^\s/]+$/.test(tok);
}

function applyToken(it, tok) {
  let m;
  if ((m = /^\+([\w-]+)$/.exec(tok))) { it.projects.push(m[1]); return true; }
  if ((m = /^sched:(\d{4}-\d{2}-\d{2})$/.exec(tok))) { it.sched = m[1]; return true; }
  if ((m = /^due:(\d{4}-\d{2}-\d{2})$/.exec(tok))) { it.due = m[1]; return true; }
  if ((m = /^created:(\d{4}-\d{2}-\d{2})$/.exec(tok))) { it.created = m[1]; return true; }
  if ((m = /^done:(\d{4}-\d{2}-\d{2})$/.exec(tok))) { it.doneDate = m[1]; return true; }
  if ((m = /^repeat:([+.])(\d+)([dwmy])$/.exec(tok))) { it.repeat = { kind: m[1], n: Number(m[2]), u: m[3] }; return true; }
  if ((m = /^needs:([\w,-]+)$/.exec(tok))) { it.needs = m[1].split(",").map((s) => s.trim()).filter(Boolean); return true; }
  if ((m = /^bumps:(\d+)$/.exec(tok))) { it.bumps = Number(m[1]); return true; }
  if ((m = /^pri:([ABCabc])$/.exec(tok))) { it.pri = m[1].toUpperCase(); return true; }
  if ((m = /^id:([\w-]+)$/.exec(tok))) { it.id = m[1]; return true; }
  return false;
}

function parseItemBody(it, rest) {
  const toks = rest.trim().split(/\s+/).filter(Boolean);
  const title = [];
  let inTokens = false;
  for (const tok of toks) {
    if (!inTokens && looksLikeToken(tok)) inTokens = true;
    if (!inTokens) { title.push(tok); continue; }
    if (!applyToken(it, tok)) it.extra.push(tok);
  }
  it.title = title.join(" ").trim();
}

// Compose an item back into a single "- [ ] ..." line body (no checkbox prefix).
export function itemBody(it) {
  const p = [];
  if (it.title.trim()) p.push(it.title.trim());
  for (const proj of it.projects) p.push(`+${proj}`);
  if (it.sched) p.push(`sched:${it.sched}`);
  if (it.due) p.push(`due:${it.due}`);
  if (it.repeat) p.push(`repeat:${it.repeat.kind}${it.repeat.n}${it.repeat.u}`);
  if (it.needs.length) p.push(`needs:${it.needs.join(",")}`);
  if (it.pri) p.push(`pri:${it.pri}`);
  if (it.bumps) p.push(`bumps:${it.bumps}`);
  if (it.created) p.push(`created:${it.created}`);
  if (it.doneDate) p.push(`done:${it.doneDate}`);
  for (const e of it.extra) p.push(e);
  if (it.id) p.push(`id:${it.id}`);
  return p.join(" ");
}

// ---------- file ----------

const ITEM_RE = /^([ \t]*)- \[([ xX])\]\s+(.*)$/;

export function parse(text) {
  const lines = String(text).split("\n");
  const items = [];
  const preamble = [];
  const projects = [];
  let cur = null;
  let curProject = null;
  let section = "active"; // active | done | projects
  let seenItem = false;

  for (const line of lines) {
    if (/^##\s+done\s*$/i.test(line.trim())) { section = "done"; cur = null; continue; }
    if (/^##\s+projects\s*$/i.test(line.trim())) { section = "projects"; cur = null; continue; }

    if (section === "projects") {
      const ph = /^###\s+(.+?)\s*$/.exec(line);
      if (ph) {
        curProject = { name: ph[1].trim(), desc: [], meta: [], link: null };
        projects.push(curProject);
        continue;
      }
      if (!curProject || line.trim() === "") continue;
      const pl = LINK_RE.exec(line.trim());
      if (pl) { if (!curProject.link) curProject.link = pl[1]; continue; }
      const kv = /^([A-Za-z][\w-]*):\s+(.*)$/.exec(line.trim());
      if (kv) curProject.meta.push([kv[1], kv[2]]);
      else curProject.desc.push(line.trim());
      continue;
    }

    const m = ITEM_RE.exec(line);
    if (m) {
      const indent = m[1].replace(/\t/g, "  ").length;
      cur = blankItem(Math.floor(indent / 2), m[2].toLowerCase() === "x");
      parseItemBody(cur, m[3]);
      cur._doneSection = section === "done";
      items.push(cur);
      seenItem = true;
      continue;
    }
    if (cur && line.trim() !== "") {
      const il = LINK_RE.exec(line.trim());
      if (il && !cur.link) { cur.link = il[1]; continue; }
      cur.notes.push(line.replace(/^\s+/, ""));
      continue;
    }
    if (!seenItem && line.trim() !== "") preamble.push(line);
  }

  // normalize depths so the first item is 0 and steps are <= +1
  normalizeDepths(items);
  return {
    items,
    preamble,
    projects: projects.map((p) => ({
      name: p.name,
      desc: p.desc.join("\n"),
      meta: p.meta,
      link: p.link || "",
    })),
  };
}

function normalizeDepths(items) {
  let prev = -1;
  const map = [];
  for (const it of items) {
    let d = it.depth;
    if (d > prev + 1) d = prev + 1;
    if (d < 0) d = 0;
    it.depth = d;
    prev = d;
  }
  void map;
}

export function buildTrees(items) {
  const roots = [];
  const stack = [];
  for (const it of items) {
    it.children = [];
    while (stack.length && stack[stack.length - 1].depth >= it.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(it);
    else roots.push(it);
    stack.push(it);
  }
  return roots;
}

export function serialize(model) {
  const roots = buildTrees(model.items.slice());
  const active = roots.filter((r) => !r.done);
  const done = roots.filter((r) => r.done);
  done.sort((a, b) => String(a.doneDate || "").localeCompare(String(b.doneDate || "")));

  const out = [];
  out.push(model.preamble && model.preamble.length ? model.preamble.join("\n") : "# Todos");
  out.push("");

  const emit = (it) => {
    const ind = "  ".repeat(it.depth);
    out.push(`${ind}- [${it.done ? "x" : " "}] ${itemBody(it)}`.trimEnd());
    if (it.link) out.push(`${ind}  link: ${it.link}`);
    for (const n of it.notes) out.push(`${ind}  ${n}`);
    for (const c of it.children) emit(c);
  };

  for (const r of active) { emit(r); out.push(""); }
  out.push("## Done");
  out.push("");
  for (const r of done) emit(r);

  const projects = (model.projects || []).filter(
    (p) => p.name && (p.desc.trim() || p.meta.length || (p.link || "").trim())
  );
  if (projects.length) {
    out.push("");
    out.push("## Projects");
    out.push("");
    for (const p of projects) {
      out.push(`### ${p.name}`);
      if (p.desc.trim()) out.push(p.desc.trim());
      if ((p.link || "").trim()) out.push(`link: ${p.link.trim()}`);
      for (const [k, v] of p.meta) out.push(`${k}: ${v}`);
      out.push("");
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "") + "\n";
}

// ---------- ids ----------

export function ensureIds(items) {
  const used = new Set(items.map((i) => i.id).filter(Boolean));
  for (const it of items) {
    if (it.id) continue;
    let id;
    do {
      id = Math.random().toString(36).slice(2, 6);
    } while (used.has(id) || id.length < 4);
    used.add(id);
    it.id = id;
  }
}

// ---------- derived status ----------

export function computeStatus(model, todayISO) {
  const items = model.items;
  const byId = new Map(items.filter((i) => i.id).map((i) => [i.id, i]));
  buildTrees(items);

  for (const it of items) {
    it._blockedBy = [];
    it._dangling = [];
    for (const nid of it.needs) {
      const t = byId.get(nid);
      if (!t) it._dangling.push(nid);
      else if (!t.done) it._blockedBy.push(t);
    }
  }

  const mark = (it) => {
    let total = 0;
    let doneN = 0;
    for (const c of it.children) {
      const [ct, cd] = mark(c);
      total += ct;
      doneN += cd;
    }
    it._childTotal = it.children.length;
    it._childDone = it.children.filter((c) => c.done).length;
    if (it.children.length) return [total + it.children.length, doneN + it._childDone];
    return [total, doneN];
  };
  for (const r of buildTrees(items)) mark(r);

  // cycle flag on needs graph
  const state = new Map();
  const dfs = (id) => {
    if (state.get(id) === "done") return false;
    if (state.get(id) === "open") return true;
    state.set(id, "open");
    const it = byId.get(id);
    let cyc = false;
    for (const n of it ? it.needs : []) if (dfs(n)) cyc = true;
    state.set(id, "done");
    if (cyc && it) it._cycle = true;
    return cyc;
  };
  for (const it of items) if (it.id) dfs(it.id);

  for (const it of items) it.isBlocked = it._blockedBy.length > 0 || it._cycle === true;
}

// ---------- mutations ----------

function subtreeRange(items, it) {
  const idx = items.indexOf(it);
  let end = idx + 1;
  while (end < items.length && items[end].depth > it.depth) end++;
  return [idx, end];
}

export function setSubtreeDone(model, it, done, todayISO) {
  const [idx, end] = subtreeRange(model.items, it);
  for (let i = idx; i < end; i++) {
    const s = model.items[i];
    s.done = done;
    if (done) s.doneDate = todayISO;
    else s.doneDate = null;
  }
}

function cloneItem(it) {
  return JSON.parse(JSON.stringify({ ...it, children: undefined }));
}

// Complete a recurring item: mark this instance done, splice a fresh instance in place.
export function completeRecurring(model, it, todayISO) {
  const [idx, end] = subtreeRange(model.items, it);
  const subtree = model.items.slice(idx, end);
  const clones = subtree.map((s) => {
    const c = cloneItem(s);
    c.id = null;
    c.done = false;
    c.doneDate = null;
    c.bumps = 0;
    c.notes = s.notes.slice();
    return c;
  });

  const root = clones[0];
  root.created = todayISO;
  const { kind, n, u } = it.repeat;
  const offset = it.sched && it.due ? daysBetween(it.due, it.sched) : null;

  if (kind === "+") {
    let base = parseISO(it.sched) || parseISO(todayISO);
    do {
      base = addUnit(base, n, u);
    } while (iso(base) < todayISO);
    root.sched = iso(base);
    root.due = offset != null ? iso(addDays(base, offset)) : it.due;
  } else {
    const base = addUnit(parseISO(todayISO), n, u);
    root.sched = iso(base);
    root.due = offset != null ? iso(addDays(base, offset)) : null;
  }

  model.items.splice(idx, 0, ...clones);
  // mark the (now shifted) originals done
  for (let i = idx + clones.length; i < end + clones.length; i++) {
    model.items[i].done = true;
    model.items[i].doneDate = todayISO;
  }
}

// After toggling, complete a parent whose children are all done / reopen if a child reopens.
export function reconcileAncestors(model, todayISO) {
  const roots = buildTrees(model.items);
  const walk = (it) => {
    for (const c of it.children) walk(c);
    if (it.children.length) {
      const all = it.children.every((c) => c.done);
      if (all && !it.done) { it.done = true; it.doneDate = todayISO; }
      if (!all && it.done) { it.done = false; it.doneDate = null; }
    }
  };
  for (const r of roots) walk(r);
}

export function toggleDone(model, id, todayISO) {
  const it = model.items.find((i) => i.id === id);
  if (!it) return;
  if (!it.done) {
    if (it.repeat) completeRecurring(model, it, todayISO);
    else setSubtreeDone(model, it, true, todayISO);
  } else {
    setSubtreeDone(model, it, false, null);
  }
  reconcileAncestors(model, todayISO);
}
