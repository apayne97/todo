import * as P from "./parse.js";

const API = "/todos";

const VIEWS = [
  ["today", "Today"],
  ["week", "This Week"],
  ["upcoming", "Upcoming"],
  ["inbox", "Inbox"],
  ["done", "Done"],
  ["review", "Review"],
  ["projects", "Projects"],
  ["shortcuts", "Shortcuts"],
];

const NO_COUNT = ["done", "projects", "shortcuts"];

const KEYMAP = [
  ["Navigate", [
    ["j / k", "move selection"],
    ["g g / G", "jump to top / bottom"],
    ["1–8", "switch view"],
    ["/", "search"],
    ["p", "filter by project (list)"],
    ["Esc", "close / deselect"],
  ]],
  ["Selected item", [
    ["x", "toggle done"],
    ["T", "reschedule to today"],
    ["t", "reschedule to tomorrow"],
    ["w", "bump to next Monday (bumps++)"],
    ["s", "set scheduled date"],
    ["d", "set due date"],
    ["r", "set repeat (+1w / .3d)"],
    ["b", "set blocker (needs:)"],
    ["P", "set project (or make a new one)"],
    ["Tab / Shift-Tab", "indent / outdent as subtask"],
    ["e / Enter", "edit the title"],
    ["E", "edit the whole line (tokens)"],
    ["n", "edit the note"],
    ["l", "edit the link (URL)"],
    ["J / K", "reorder"],
    ["#  or  Delete", "delete"],
    ["u", "undo"],
  ]],
  ["Create", [
    ["a", "add item here"],
    ["A", "add to Inbox"],
    ["c", "quick capture (anywhere)"],
  ]],
  ["Projects view", [
    ["e / Enter", "edit description"],
    ["n", "edit info (key: value lines)"],
    ["l", "edit link (URL)"],
    ["a", "new project"],
  ]],
];

const state = {
  model: { items: [], preamble: [], projects: [] },
  etag: "0",
  view: "today",
  selectedId: null,
  projectFilter: null,
  search: "",
  dirty: false,
  saving: false,
  undo: [],
  graphMode: "day",
  graphFilter: "all",
  overlay: null, // "help"
  editing: null, // { id, mode: "title" | "full" }
  ask: null, // { label, initial, onSubmit }
  picker: null, // { title, options, hi, onPick }
  toastMsg: null,
  _flat: [],
  _focusEl: null,
  _lastG: 0,
};

const todayISO = () => P.iso(new Date());
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- data ----------

async function load() {
  const r = await fetch(API);
  const { text, etag } = await r.json();
  state.model = P.parse(text);
  state.etag = etag;
  recompute();
  render();
}

function recompute() {
  P.computeStatus(state.model, todayISO());
}

let saveTimer = null;
function scheduleSave() {
  state.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 350);
}

async function save() {
  if (state.saving) return scheduleSave();
  state.saving = true;
  P.ensureIds(state.model.items);
  const text = P.serialize(state.model);
  try {
    const r = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, etag: state.etag }),
    });
    const j = await r.json();
    if (r.status === 412) {
      state.etag = j.etag;
      toast("File changed on disk — reloaded. Re-apply your last edit.");
      state.dirty = false;
      await load();
      return;
    }
    state.etag = j.etag;
    state.dirty = false;
  } catch (e) {
    toast("Save failed: " + e.message);
  } finally {
    state.saving = false;
  }
}

function mutate(fn) {
  state.undo.push(P.serialize(state.model));
  if (state.undo.length > 50) state.undo.shift();
  fn();
  recompute();
  scheduleSave();
  render();
}

function undo() {
  const prev = state.undo.pop();
  if (!prev) return toast("Nothing to undo");
  state.model = P.parse(prev);
  recompute();
  scheduleSave();
  render();
}

async function pollDisk() {
  if (state.dirty || state.editing || state.ask) return;
  try {
    const r = await fetch(API);
    const { text, etag } = await r.json();
    if (etag !== state.etag) {
      state.model = P.parse(text);
      state.etag = etag;
      recompute();
      render();
      toast("Updated from disk");
    }
  } catch {}
}
setInterval(pollDisk, 10000);
window.addEventListener("focus", pollDisk);

// ---------- helpers ----------

function toast(msg) {
  state.toastMsg = msg;
  render();
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    state.toastMsg = null;
    render();
  }, 3500);
}

function selectedItem() {
  return state.model.items.find((i) => i.id === state.selectedId) || null;
}

function subtreeRange(it) {
  const items = state.model.items;
  const idx = items.indexOf(it);
  let end = idx + 1;
  while (end < items.length && items[end].depth > it.depth) end++;
  return [idx, end];
}

function bump(it, dateISO) {
  it.sched = dateISO;
  it.bumps = (it.bumps || 0) + 1;
}

function parseRepeat(v) {
  v = v.trim();
  if (!v) return null;
  const m = /^([+.])?(\d+)\s*([dwmy])$/.exec(v);
  if (!m) {
    toast("repeat format: +1w (from schedule) or .3d (from completion)");
    return undefined;
  }
  return { kind: m[1] || "+", n: Number(m[2]), u: m[3] };
}

function allProjects() {
  const s = new Set();
  for (const it of state.model.items) for (const p of it.projects) s.add(p);
  for (const p of state.model.projects) s.add(p.name);
  return [...s].sort();
}

function projColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 58%)`;
}

function projectEntry(name) {
  return state.model.projects.find((p) => p.name === name) || null;
}

function ensureProjectEntry(name) {
  let e = projectEntry(name);
  if (!e) {
    e = { name, desc: "", meta: [], link: "" };
    state.model.projects.push(e);
  }
  if (e.link == null) e.link = "";
  return e;
}

// name + description + info + live task counts, for the Projects view
function projectSummaries() {
  return allProjects().map((name) => {
    const e = projectEntry(name) || { name, desc: "", meta: [], link: "" };
    const mine = state.model.items.filter((it) => it.projects.includes(name));
    const open = mine.filter((i) => !i.done);
    return {
      name,
      desc: e.desc,
      meta: e.meta,
      link: e.link || "",
      open: open.length,
      done: mine.filter((i) => i.done).length,
      blocked: open.filter((i) => i.isBlocked).length,
      nextDue: open.filter((i) => i.due).map((i) => i.due).sort()[0] || null,
    };
  });
}

function editProjectLink(name) {
  const e = projectEntry(name) || { link: "" };
  ask(`${name} — link (URL, blank to clear)`, e.link || "", (v) =>
    mutate(() => {
      ensureProjectEntry(name).link = v.trim();
    })
  );
}

// ---------- filtering ----------

function viewMatch(it, view, t, we) {
  if (view === "done") return it.done;
  if (it.done) return false;
  const s = it.sched;
  const d = it.due;
  if (view === "today") return !it.isBlocked && ((s && s <= t) || (d && d <= t));
  if (view === "week") return !it.isBlocked && ((s && s <= we) || (d && d <= we));
  if (view === "upcoming") return (s && s > we) || (!s && d && d > we);
  if (view === "inbox") return !s && !d && !it.isBlocked;
  if (view === "review")
    return (s && s < t) || (it.bumps || 0) >= 1 || (!s && !d) || it._dangling.length > 0 || it._cycle;
  return false;
}

function anyDesc(it, pred) {
  return pred(it) || it.children.some((c) => anyDesc(c, pred));
}

function visibleRoots() {
  const t = todayISO();
  const we = P.weekEndISO(t);
  const roots = P.buildTrees(state.model.items);
  const q = state.search.toLowerCase();
  return roots
    .filter((r) => anyDesc(r, (x) => viewMatch(x, state.view, t, we)))
    .filter((r) => !state.projectFilter || anyDesc(r, (x) => x.projects.includes(state.projectFilter)))
    .filter((r) => !q || anyDesc(r, (x) => x.title.toLowerCase().includes(q)))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || (b.bumps || 0) - (a.bumps || 0));
}

function sortKey(it) {
  const ds = [it.sched, it.due].filter(Boolean).sort();
  return ds[0] || "9999-99-99";
}

// ---------- rendering ----------

function relDay(dateISO) {
  const diff = P.daysBetween(dateISO, todayISO());
  if (diff === 0) return "today";
  if (diff === 1) return "tmrw";
  if (diff === -1) return "1d over";
  if (diff < 0) return `${-diff}d over`;
  if (diff < 7) return P.parseISO(dateISO).toLocaleDateString(undefined, { weekday: "short" });
  if (diff < 14) return "next " + P.parseISO(dateISO).toLocaleDateString(undefined, { weekday: "short" });
  return `${diff}d`;
}

function chip(text, cls, title) {
  const s = document.createElement("span");
  s.className = "chip " + (cls || "");
  s.textContent = text;
  if (title) s.title = title;
  return s;
}

function rowEl(it) {
  const row = document.createElement("div");
  row.className =
    "row" +
    (it.id === state.selectedId ? " sel" : "") +
    (it.done ? " done" : "") +
    (it.isBlocked ? " blocked" : "");
  row.style.paddingLeft = 10 + it.depth * 22 + "px";
  row.dataset.id = it.id || "";
  row.onclick = () => selectItem(it.id);
  row.ondblclick = () => {
    selectItem(it.id);
    state.editing = { id: it.id, mode: "title" };
    render();
  };

  const box = document.createElement("button");
  box.className = "box";
  box.textContent = it.done ? "✓" : it._childTotal ? `${it._childDone}/${it._childTotal}` : "";
  box.onclick = (e) => {
    e.stopPropagation();
    mutate(() => P.toggleDone(state.model, it.id, todayISO()));
  };
  row.append(box);

  if (state.editing && state.editing.id === it.id) {
    const full = state.editing.mode === "full";
    const inp = document.createElement("input");
    inp.className = "edit";
    inp.value = full ? P.itemBody(it).replace(/\s*id:\S+\s*$/, "") : it.title;
    if (full) inp.placeholder = "title +project sched:… due:… pri:A";
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === "Enter") commitEdit(it, inp.value, state.editing.mode);
      else if (e.key === "Escape") {
        state.editing = null;
        render();
      }
    };
    inp.onblur = () => {
      if (state.editing) commitEdit(it, inp.value, state.editing.mode);
    };
    row.append(inp);
    state._focusEl = inp;
    return row;
  }

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = it.title || "(untitled)";
  row.append(title);

  for (const p of it.projects) {
    const c = chip("+" + p, "proj");
    c.style.borderColor = projColor(p);
    row.append(c);
  }
  if (it.pri) row.append(chip(it.pri, "pri pri-" + it.pri));
  if (it.due) row.append(chip("due " + relDay(it.due), "due" + (P.daysBetween(it.due, todayISO()) <= 1 ? " hot" : "")));
  if (it.sched && !(state.view === "today" && it.sched <= todayISO()))
    row.append(chip(relDay(it.sched), "sched"));
  if (it.repeat) row.append(chip("↻ " + it.repeat.kind + it.repeat.n + it.repeat.u, "rep"));
  if ((it.bumps || 0) > 0) row.append(chip("⤴" + it.bumps, "bump", `bumped ${it.bumps}×`));
  if (it.isBlocked) {
    const names = it._blockedBy.map((b) => b.title).concat(it._cycle ? ["(dependency cycle)"] : []);
    row.append(chip("🔒", "lock", "blocked by: " + names.join(", ")));
  }
  if (it._dangling.length) row.append(chip("needs?", "warn", "unknown ids: " + it._dangling.join(", ")));
  if (it.link) row.append(linkChip(it.link));
  const noteText = getNote(it);
  if (noteText) {
    const note = document.createElement("div");
    note.className = "note";
    note.textContent = noteText;
    note.style.paddingLeft = 10 + it.depth * 22 + 26 + "px";
    note.onclick = (e) => {
      e.stopPropagation();
      selectItem(it.id);
      editNote(it);
    };
    row.append(note);
  }
  return row;
}

// One editable note per item. The parser keeps notes as an array for lossless
// reading of hand-written multi-line notes; the UI treats them as one string.
function getNote(it) {
  return it.notes.join(" ").trim();
}

function editNote(it) {
  ask("note (blank to clear)", getNote(it), (v) =>
    mutate(() => {
      it.notes = v.trim() ? [v.trim()] : [];
    })
  );
}

function editLink(it) {
  ask("link — a URL (blank to clear)", it.link || "", (v) =>
    mutate(() => {
      it.link = v.trim() || null;
    })
  );
}

function linkText(url) {
  return url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
}

// a clickable 🔗 chip; clicking the label opens the URL, not the row
function linkChip(url) {
  const a = document.createElement("a");
  a.className = "chip link";
  a.textContent = "🔗 " + linkText(url);
  a.href = /^[a-z][\w+.-]*:/i.test(url) ? url : "https://" + url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = url;
  a.onclick = (e) => e.stopPropagation();
  return a;
}

// Turn "due:fri" / "sched:tomorrow" inside a typed line into ISO dates.
function normalizeDatesInText(text) {
  return text.replace(/\b(sched|due):("[^"]*"|\S+)/g, (m, key, val) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return m;
    const d = P.parseDateInput(val.replace(/"/g, ""), todayISO());
    return d ? `${key}:${d}` : m;
  });
}

function commitEdit(it, text, mode) {
  text = normalizeDatesInText(text);
  mutate(() => {
    const tmp = P.parse(`- [${it.done ? "x" : " "}] ${text}`).items[0];
    if (mode === "full") {
      Object.assign(it, {
        title: tmp.title,
        projects: tmp.projects,
        sched: tmp.sched,
        due: tmp.due,
        repeat: tmp.repeat,
        needs: tmp.needs,
        pri: tmp.pri,
        bumps: tmp.bumps || it.bumps,
        created: tmp.created || it.created,
        extra: tmp.extra,
      });
    } else {
      // title mode: set the title, merge in any tokens that were typed, keep the rest
      it.title = tmp.title;
      if (tmp.projects.length) it.projects = [...new Set([...it.projects, ...tmp.projects])];
      if (tmp.sched) it.sched = tmp.sched;
      if (tmp.due) it.due = tmp.due;
      if (tmp.repeat) it.repeat = tmp.repeat;
      if (tmp.needs.length) it.needs = tmp.needs;
      if (tmp.pri) it.pri = tmp.pri;
    }
  });
  state.editing = null;
  render();
}

function selectItem(id) {
  state.selectedId = id;
  render();
}

function renderList(main) {
  const roots = visibleRoots();
  state._flat = [];
  if (!roots.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Nothing here.";
    main.append(e);
    return;
  }
  const walk = (it) => {
    state._flat.push(it.id);
    main.append(rowEl(it));
    for (const c of it.children) walk(c);
  };
  for (const r of roots) walk(r);
}

// ---------- done view + graph ----------

function renderDone(main) {
  const done = state.model.items.filter((i) => i.done && i.doneDate);
  const filtered = done.filter((i) =>
    state.graphFilter === "all" ? true : state.graphFilter === "recurring" ? !!i.repeat : !i.repeat
  );

  const controls = document.createElement("div");
  controls.className = "controls";
  for (const [k, lbl] of [["day", "By day (30d)"], ["week", "By week (12w)"]]) {
    const b = document.createElement("button");
    b.textContent = lbl;
    b.className = state.graphMode === k ? "on" : "";
    b.onclick = () => {
      state.graphMode = k;
      render();
    };
    controls.append(b);
  }
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  controls.append(spacer);
  for (const [k, lbl] of [["all", "All"], ["oneoff", "One-off"], ["recurring", "Recurring"]]) {
    const b = document.createElement("button");
    b.textContent = lbl;
    b.className = state.graphFilter === k ? "on" : "";
    b.onclick = () => {
      state.graphFilter = k;
      render();
    };
    controls.append(b);
  }
  main.append(controls);

  main.append(graphEl(filtered));
  main.append(statsEl(filtered));

  // grouped list, newest first
  const byDay = new Map();
  for (const it of filtered) {
    if (!byDay.has(it.doneDate)) byDay.set(it.doneDate, []);
    byDay.get(it.doneDate).push(it);
  }
  const days = [...byDay.keys()].sort().reverse();
  for (const day of days) {
    const h = document.createElement("div");
    h.className = "dayhead";
    h.textContent = P.parseISO(day).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
    main.append(h);
    for (const it of byDay.get(day)) {
      const row = document.createElement("div");
      row.className = "row done";
      row.style.paddingLeft = "10px";
      const b = document.createElement("span");
      b.className = "box";
      b.textContent = "✓";
      row.append(b);
      const t = document.createElement("span");
      t.className = "title";
      t.textContent = it.title;
      row.append(t);
      for (const p of it.projects) {
        const c = chip("+" + p, "proj");
        c.style.borderColor = projColor(p);
        row.append(c);
      }
      if (it.repeat) row.append(chip("↻", "rep"));
      if ((it.bumps || 0) > 0) row.append(chip("finished despite ⤴" + it.bumps, "bump"));
      if (it.created) {
        const age = P.daysBetween(it.doneDate, it.created);
        if (age >= 7) row.append(chip(age + "d to finish", "age"));
      }
      main.append(row);
    }
  }
}

function buckets(items, mode) {
  const out = [];
  const now = P.parseISO(todayISO());
  if (mode === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = P.iso(P.addDays(now, -i));
      out.push({ key: d, label: P.parseISO(d).toLocaleDateString(undefined, { day: "numeric" }), items: [] });
    }
    const idx = new Map(out.map((b, i) => [b.key, i]));
    for (const it of items) if (idx.has(it.doneDate)) out[idx.get(it.doneDate)].items.push(it);
  } else {
    // week buckets, Monday start
    const mon = P.addDays(now, -((now.getDay() + 6) % 7));
    for (let i = 11; i >= 0; i--) {
      const start = P.addDays(mon, -i * 7);
      out.push({ key: P.iso(start), label: P.iso(start).slice(5), start: P.iso(start), end: P.iso(P.addDays(start, 6)), items: [] });
    }
    for (const it of items)
      for (const b of out) if (it.doneDate >= b.start && it.doneDate <= b.end) b.items.push(it);
  }
  return out;
}

function graphEl(items) {
  const bs = buckets(items, state.graphMode);
  const max = Math.max(1, ...bs.map((b) => b.items.length));
  const W = 640;
  const H = 150;
  const pad = 20;
  const bw = (W - pad * 2) / bs.length;
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "graph");

  bs.forEach((b, i) => {
    const x = pad + i * bw;
    let y = H - pad;
    const byProj = new Map();
    for (const it of b.items) {
      const key = it.projects[0] || "—";
      byProj.set(key, (byProj.get(key) || 0) + 1);
    }
    for (const [proj, n] of byProj) {
      const h = (n / max) * (H - pad * 2);
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", x + 1);
      rect.setAttribute("y", y - h);
      rect.setAttribute("width", Math.max(1, bw - 2));
      rect.setAttribute("height", h);
      rect.setAttribute("fill", proj === "—" ? "#667" : projColor(proj));
      const tt = document.createElementNS(svgNS, "title");
      tt.textContent = `${b.key}: ${n} ${proj}`;
      rect.append(tt);
      svg.append(rect);
      y -= h;
    }
    if ((state.graphMode === "day" && i % 5 === 0) || (state.graphMode === "week" && i % 2 === 0)) {
      const tx = document.createElementNS(svgNS, "text");
      tx.setAttribute("x", x + bw / 2);
      tx.setAttribute("y", H - 6);
      tx.setAttribute("text-anchor", "middle");
      tx.setAttribute("class", "gax");
      tx.textContent = b.label;
      svg.append(tx);
    }
  });
  return svg;
}

function statsEl(items) {
  const t = P.parseISO(todayISO());
  const mon = P.addDays(t, -((t.getDay() + 6) % 7));
  const thisWeek = items.filter((i) => i.doneDate >= P.iso(mon)).length;
  const lastWeek = items.filter((i) => i.doneDate >= P.iso(P.addDays(mon, -7)) && i.doneDate < P.iso(mon)).length;

  const dates = new Set(items.map((i) => i.doneDate));
  let streak = 0;
  let cursor = new Date(t);
  if (!dates.has(P.iso(cursor))) cursor = P.addDays(cursor, -1);
  while (dates.has(P.iso(cursor))) {
    streak++;
    cursor = P.addDays(cursor, -1);
  }

  const el = document.createElement("div");
  el.className = "stats";
  el.append(stat(items.length, "completed"));
  el.append(stat(streak + "d", "streak"));
  el.append(stat(thisWeek, "this week"));
  el.append(stat(lastWeek, "last week"));
  return el;
}

function stat(n, label) {
  const s = document.createElement("div");
  s.className = "stat";
  s.innerHTML = `<b>${n}</b><span>${label}</span>`;
  return s;
}

// ---------- projects view ----------

function renderProjects(main) {
  const rows = projectSummaries();
  state._flat = rows.map((p) => p.name);

  const hint = document.createElement("div");
  hint.className = "dayhead";
  hint.textContent = "e description · n info · l link · a new project · click name to filter";
  main.append(hint);

  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No projects yet. Press a to add one, or tag a task with +name.";
    main.append(e);
    return;
  }

  for (const p of rows) {
    const card = document.createElement("div");
    card.className = "pcard" + (p.name === state.selectedId ? " sel" : "");
    card.onclick = () => {
      state.selectedId = p.name;
      render();
    };

    const head = document.createElement("div");
    head.className = "phead";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = projColor(p.name);
    head.append(dot);
    const name = document.createElement("button");
    name.className = "pname";
    name.textContent = p.name;
    name.title = "filter todos by this project";
    name.onclick = (e) => {
      e.stopPropagation();
      state.projectFilter = p.name;
      state.view = "today";
      state.selectedId = null;
      render();
    };
    head.append(name);
    const counts = document.createElement("span");
    counts.className = "pcounts";
    counts.textContent =
      `${p.open} open` +
      (p.blocked ? ` · ${p.blocked} blocked` : "") +
      ` · ${p.done} done` +
      (p.nextDue ? ` · next due ${relDay(p.nextDue)}` : "");
    head.append(counts);
    card.append(head);

    const desc = document.createElement("div");
    desc.className = "pdesc" + (p.desc ? "" : " empty");
    desc.textContent = p.desc || "no description — press e";
    desc.onclick = (e) => {
      e.stopPropagation();
      state.selectedId = p.name;
      editProjectDesc(p.name);
    };
    card.append(desc);

    if (p.link) {
      const lw = document.createElement("div");
      lw.className = "plink";
      lw.append(linkChip(p.link));
      card.append(lw);
    }

    if (p.meta.length) {
      const meta = document.createElement("dl");
      meta.className = "pmeta";
      for (const [k, v] of p.meta) {
        const dt = document.createElement("dt");
        dt.textContent = k;
        const dd = document.createElement("dd");
        dd.textContent = v;
        meta.append(dt, dd);
      }
      card.append(meta);
    }
    main.append(card);
  }
}

function editProjectDesc(name) {
  const e = projectEntry(name) || { desc: "" };
  askText(`${name} — description`, e.desc || "", (v) =>
    mutate(() => {
      ensureProjectEntry(name).desc = v.trim();
    })
  );
}

function editProjectMeta(name) {
  const e = projectEntry(name) || { meta: [] };
  const initial = e.meta.map(([k, v]) => `${k}: ${v}`).join("\n");
  askText(`${name} — info (one "key: value" per line)`, initial, (v) =>
    mutate(() => {
      const ent = ensureProjectEntry(name);
      const pairs = v
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(l);
          return m ? [m[1], m[2]] : ["note", l];
        });
      // a "link:" line here becomes the project's link, not a meta row
      const linkPair = pairs.find(([k]) => k.toLowerCase() === "link");
      if (linkPair) ent.link = linkPair[1];
      ent.meta = pairs.filter(([k]) => k.toLowerCase() !== "link");
    })
  );
}

function newProjectName(onName) {
  ask('new project name (spaces become "-")', "", (v) => {
    const name = v.trim().replace(/^\+/, "").replace(/\s+/g, "-");
    if (name) onName(name);
  });
}

// ---------- shortcuts view + overlay ----------

function keymapEl() {
  const wrap = document.createElement("div");
  wrap.className = "keymap";
  for (const [group, rows] of KEYMAP) {
    const h = document.createElement("h3");
    h.textContent = group;
    wrap.append(h);
    for (const [keys, desc] of rows) {
      const r = document.createElement("div");
      r.className = "krow";
      r.innerHTML = `<kbd>${keys.replace(/</g, "&lt;")}</kbd><span>${desc}</span>`;
      wrap.append(r);
    }
  }
  return wrap;
}

// ---------- shell ----------

function render() {
  const app = $("#app");
  app.innerHTML = "";
  state._focusEl = null;

  const side = document.createElement("nav");
  side.className = "side";
  const t = todayISO();
  const we = P.weekEndISO(t);
  VIEWS.forEach(([k, label], i) => {
    const b = document.createElement("button");
    b.className = "navbtn" + (state.view === k ? " on" : "");
    let count = "";
    if (!NO_COUNT.includes(k)) {
      const n = P.buildTrees(state.model.items).filter((r) => anyDesc(r, (x) => viewMatch(x, k, t, we))).length;
      if (n) count = ` ${n}`;
    }
    b.innerHTML = `<span class="nk">${i + 1}</span> ${label}<span class="nc">${count}</span>`;
    b.onclick = () => {
      state.view = k;
      state.selectedId = null;
      render();
    };
    side.append(b);
  });

  const projs = allProjects();
  if (projs.length) {
    const ph = document.createElement("div");
    ph.className = "sidehead";
    ph.textContent = "projects";
    side.append(ph);
    const all = document.createElement("button");
    all.className = "navbtn tiny" + (!state.projectFilter ? " on" : "");
    all.textContent = "all";
    all.onclick = () => {
      state.projectFilter = null;
      render();
    };
    side.append(all);
    for (const p of projs) {
      const b = document.createElement("button");
      b.className = "navbtn tiny" + (state.projectFilter === p ? " on" : "");
      b.innerHTML = `<span class="dot" style="background:${projColor(p)}"></span>${p}`;
      b.onclick = () => {
        state.projectFilter = state.projectFilter === p ? null : p;
        render();
      };
      side.append(b);
    }
  }
  app.append(side);

  const mainWrap = document.createElement("main");
  const head = document.createElement("header");
  head.innerHTML = `<h1>${VIEWS.find((v) => v[0] === state.view)[1]}</h1>`;
  if (state.search) {
    const s = chip('search: "' + state.search + '" ✕', "filter");
    s.onclick = () => {
      state.search = "";
      render();
    };
    head.append(s);
  }
  if (state.dirty) head.append(chip("saving…", "saving"));
  mainWrap.append(head);

  const main = document.createElement("div");
  main.className = "main";
  if (state.view === "shortcuts") main.append(keymapEl());
  else if (state.view === "projects") renderProjects(main);
  else if (state.view === "done") renderDone(main);
  else renderList(main);
  mainWrap.append(main);
  app.append(mainWrap);

  if (state.ask) app.append(askEl());
  if (state.picker) app.append(pickerEl());
  if (state.overlay === "help") app.append(helpEl());
  if (state.toastMsg) {
    const tt = document.createElement("div");
    tt.className = "toast";
    tt.textContent = state.toastMsg;
    app.append(tt);
  }

  if (state._focusEl) state._focusEl.focus();
  else if (state.ask) $(".ask input, .ask textarea")?.focus();
}

function askEl() {
  const multi = state.ask.multiline;
  const wrap = document.createElement("div");
  wrap.className = "ask";
  const box = document.createElement("div");
  box.className = "askbox";
  box.innerHTML = `<label>${state.ask.label}</label>`;
  const inp = document.createElement(multi ? "textarea" : "input");
  inp.value = state.ask.initial || "";
  if (multi) inp.rows = 5;
  const submit = () => {
    const cb = state.ask.onSubmit;
    state.ask = null;
    cb(inp.value);
    if (!state.ask) render();
  };
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (!multi || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      state.ask = null;
      render();
    }
  };
  box.append(inp);
  if (multi) {
    const bar = document.createElement("div");
    bar.className = "askbar";
    const save = document.createElement("button");
    save.textContent = "Save";
    save.onclick = submit;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "⌘↵ to save · Esc to cancel";
    bar.append(save, hint);
    box.append(bar);
  }
  wrap.append(box);
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.ask = null;
      render();
    }
  };
  return wrap;
}

function askText(label, initial, onSubmit) {
  state.ask = { label, initial, onSubmit, multiline: true };
  render();
}

function openPicker(title, options, hi, onPick) {
  state.picker = { title, options, hi: Math.max(0, hi), onPick };
  render();
}

function choosePicker(i) {
  const p = state.picker;
  if (!p) return;
  const o = p.options[i];
  state.picker = null;
  if (o) p.onPick(o.value);
  render();
}

function pickerEl() {
  const wrap = document.createElement("div");
  wrap.className = "ask";
  const box = document.createElement("div");
  box.className = "askbox";
  box.innerHTML = `<label>${state.picker.title}</label>`;
  const list = document.createElement("div");
  list.className = "picklist";
  state.picker.options.forEach((o, i) => {
    const row = document.createElement("div");
    row.className = "pickrow" + (i === state.picker.hi ? " hi" : "");
    if (o.dot) {
      const d = document.createElement("span");
      d.className = "dot";
      d.style.background = o.dot;
      row.append(d);
    }
    row.append(document.createTextNode(o.label));
    row.onmouseenter = () => {
      state.picker.hi = i;
      render();
    };
    row.onclick = () => choosePicker(i);
    list.append(row);
  });
  box.append(list);
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "↑↓ or j/k · Enter to choose · Esc to cancel";
  box.append(hint);
  wrap.append(box);
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.picker = null;
      render();
    }
  };
  return wrap;
}

function helpEl() {
  const wrap = document.createElement("div");
  wrap.className = "ask";
  const box = document.createElement("div");
  box.className = "askbox wide";
  box.append(keymapEl());
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "press ? or Esc to close";
  box.append(hint);
  wrap.append(box);
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.overlay = null;
      render();
    }
  };
  return wrap;
}

function ask(label, initial, onSubmit) {
  state.ask = { label, initial, onSubmit };
  render();
}

// ---------- keyboard ----------

function moveSel(dir) {
  const flat = state._flat;
  if (!flat.length) return;
  let i = flat.indexOf(state.selectedId);
  i = i < 0 ? (dir > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, i + dir));
  state.selectedId = flat[i];
  render();
  document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
}

function selectEdge(dir) {
  const flat = state._flat;
  if (!flat.length) return;
  state.selectedId = dir > 0 ? flat[flat.length - 1] : flat[0];
  render();
}

function addItem(mode) {
  mutate(() => {
    const it = P.parse("- [ ] new task").items[0];
    it.title = "";
    it.created = todayISO();
    const items = state.model.items;
    if (mode === "inbox") {
      const firstDone = items.findIndex((x) => x.done && x.depth === 0);
      items.splice(firstDone < 0 ? items.length : firstDone, 0, it);
    } else {
      const sel = selectedItem();
      if (sel) {
        const [, end] = subtreeRange(sel);
        it.depth = sel.depth;
        items.splice(end, 0, it);
      } else items.unshift(it);
      if (state.view === "today") it.sched = todayISO();
      if (state.view === "week") it.sched = todayISO();
    }
    if (state.projectFilter) it.projects = [state.projectFilter];
    P.ensureIds(items);
    state.selectedId = it.id;
    state.editing = { id: it.id, mode: "title" };
  });
}

function reorder(it, dir) {
  const items = state.model.items;
  const [i, e] = subtreeRange(it);
  if (dir < 0) {
    let p = i - 1;
    while (p >= 0 && items[p].depth > it.depth) p--;
    if (p < 0 || items[p].depth !== it.depth) return;
    let ps = p;
    while (ps > 0 && items[ps - 1].depth > it.depth) ps--;
    const block = items.splice(i, e - i);
    items.splice(ps, 0, ...block);
  } else {
    if (e >= items.length || items[e].depth !== it.depth) return;
    let ne = e + 1;
    while (ne < items.length && items[ne].depth > it.depth) ne++;
    const block = items.splice(i, e - i);
    items.splice(i + (ne - e), 0, ...block);
  }
}

function indentItem(it, dir) {
  const [i, e] = subtreeRange(it);
  if (e - i > 1) return toast("outdent/indent leaf items only");
  const items = state.model.items;
  if (dir > 0) {
    if (i === 0 || items[i - 1].depth < it.depth) return toast("nothing to nest under");
    it.depth = Math.min(it.depth + 1, items[i - 1].depth + 1);
  } else {
    it.depth = Math.max(0, it.depth - 1);
  }
}

function deleteItem(it) {
  const [i, e] = subtreeRange(it);
  const flat = state._flat;
  const pos = flat.indexOf(it.id);
  state.model.items.splice(i, e - i);
  state.selectedId = flat[Math.max(0, pos - 1)] || null;
}

document.addEventListener("keydown", (e) => {
  if (state.ask || state.editing) return;
  const tag = e.target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return;

  const k = e.key;
  // Stop a shortcut key from also being typed into an input we're about to focus.
  if (k.length === 1 && k !== " " && !e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();

  if (state.picker) {
    const n = state.picker.options.length;
    if (k === "Escape") {
      state.picker = null;
      return render();
    }
    if (k === "j" || k === "ArrowDown") {
      state.picker.hi = (state.picker.hi + 1) % n;
      return render();
    }
    if (k === "k" || k === "ArrowUp") {
      state.picker.hi = (state.picker.hi - 1 + n) % n;
      return render();
    }
    if (k === "Enter") return choosePicker(state.picker.hi);
    if (/^[1-9]$/.test(k) && Number(k) <= n) return choosePicker(Number(k) - 1);
    return;
  }

  if (k === "?") {
    state.overlay = state.overlay === "help" ? null : "help";
    return render();
  }
  if (state.overlay) {
    if (k === "Escape") {
      state.overlay = null;
      render();
    }
    return;
  }
  if (k === "Escape") {
    state.selectedId = null;
    return render();
  }
  if (/^[1-8]$/.test(k) && Number(k) <= VIEWS.length) {
    state.view = VIEWS[Number(k) - 1][0];
    state.selectedId = null;
    return render();
  }
  if (k === "j" || k === "ArrowDown") {
    e.preventDefault();
    return moveSel(1);
  }
  if (k === "k" || k === "ArrowUp") {
    e.preventDefault();
    return moveSel(-1);
  }
  if (k === "g") {
    const now = Date.now();
    if (now - state._lastG < 450) {
      selectEdge(-1);
      state._lastG = 0;
    } else state._lastG = now;
    return;
  }
  if (k === "G") return selectEdge(1);

  if (state.view === "projects" && ["e", "Enter", "n", "l", "a"].includes(k)) {
    e.preventDefault();
    if (k === "a")
      return newProjectName((name) => {
        mutate(() => ensureProjectEntry(name));
        state.selectedId = name;
        editProjectDesc(name);
      });
    if (!state.selectedId) return;
    if (k === "n") return editProjectMeta(state.selectedId);
    if (k === "l") return editProjectLink(state.selectedId);
    return editProjectDesc(state.selectedId);
  }

  if (k === "/") {
    e.preventDefault();
    return ask("search", state.search, (v) => {
      state.search = v.trim();
      render();
    });
  }
  if (k === "p") {
    e.preventDefault();
    const opts = [
      { value: null, label: "All projects" },
      ...allProjects().map((p) => ({ value: p, label: p, dot: projColor(p) })),
    ];
    const cur = opts.findIndex((o) => o.value === state.projectFilter);
    return openPicker("Filter by project", opts, cur < 0 ? 0 : cur, (v) => {
      state.projectFilter = v;
      render();
    });
  }
  if (k === "c") {
    e.preventDefault();
    return ask("quick capture", "", (v) => {
      if (!v.trim()) return;
      mutate(() => {
        const it = P.parse("- [ ] " + normalizeDatesInText(v)).items[0];
        it.created = todayISO();
        if (state.projectFilter && !it.projects.length) it.projects = [state.projectFilter];
        const firstDone = state.model.items.findIndex((x) => x.done && x.depth === 0);
        state.model.items.splice(firstDone < 0 ? state.model.items.length : firstDone, 0, it);
        P.ensureIds(state.model.items);
        state.selectedId = it.id;
      });
    });
  }
  if (k === "a") {
    e.preventDefault();
    return addItem("context");
  }
  if (k === "A") {
    e.preventDefault();
    return addItem("inbox");
  }
  if (k === "u") return undo();

  const sel = selectedItem();
  if (!sel) return;

  if (k === "x") return mutate(() => P.toggleDone(state.model, sel.id, todayISO()));
  if (k === "w") return mutate(() => bump(sel, P.iso(P.nextMonday())));
  if (k === "t") return mutate(() => (sel.sched = P.iso(P.addDays(new Date(), 1))));
  if (k === "T") return mutate(() => (sel.sched = todayISO()));
  if (k === "s")
    return ask("scheduled date", sel.sched || "", (v) =>
      mutate(() => (sel.sched = v.trim() ? P.parseDateInput(v, todayISO()) : null))
    );
  if (k === "d")
    return ask("due date", sel.due || "", (v) =>
      mutate(() => (sel.due = v.trim() ? P.parseDateInput(v, todayISO()) : null))
    );
  if (k === "r")
    return ask("repeat  ( +1w from schedule · .3d from completion · blank clears )", sel.repeat ? `${sel.repeat.kind}${sel.repeat.n}${sel.repeat.u}` : "", (v) => {
      const rep = parseRepeat(v);
      if (rep !== undefined) mutate(() => (sel.repeat = rep));
    });
  if (k === "b")
    return ask("blocked by (item ids, comma-separated)", sel.needs.join(","), (v) =>
      mutate(() => (sel.needs = v.split(",").map((s) => s.trim()).filter(Boolean)))
    );
  if (k === "P") {
    const opts = [
      { value: "", label: "(no project)" },
      ...allProjects().map((p) => ({ value: p, label: p, dot: projColor(p) })),
      { value: "__new__", label: "＋ new project…" },
    ];
    const cur = opts.findIndex((o) => o.value === (sel.projects[0] || ""));
    return openPicker("Set project", opts, cur < 0 ? 0 : cur, (v) => {
      if (v === "__new__") return newProjectName((name) => mutate(() => (sel.projects = [name])));
      mutate(() => (sel.projects = v ? [v] : []));
    });
  }
  if (k === "e" || k === "Enter") {
    state.editing = { id: sel.id, mode: "title" };
    return render();
  }
  if (k === "E") {
    state.editing = { id: sel.id, mode: "full" };
    return render();
  }
  if (k === "n") return editNote(sel);
  if (k === "l") return editLink(sel);
  if (k === "J") {
    e.preventDefault();
    return mutate(() => reorder(sel, 1));
  }
  if (k === "K") {
    e.preventDefault();
    return mutate(() => reorder(sel, -1));
  }
  if (k === "Tab") {
    e.preventDefault();
    return mutate(() => indentItem(sel, e.shiftKey ? -1 : 1));
  }
  if (k === "#" || k === "Delete") {
    e.preventDefault();
    return mutate(() => deleteItem(sel));
  }
});

load();
