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

// Every rebindable shortcut. `sel: true` = needs a selected item. `run({ sel })`.
const ACTIONS = {
  down: { group: "Navigate", label: "move down", run: () => moveSel(1) },
  up: { group: "Navigate", label: "move up", run: () => moveSel(-1) },
  bottom: { group: "Navigate", label: "jump to bottom", run: () => selectEdge(1) },
  search: { group: "Navigate", label: "search", run: () => openSearch() },
  filterProject: { group: "Navigate", label: "filter by project", run: () => openProjectFilter() },
  clearFilters: {
    group: "Navigate",
    label: "clear search + project filter",
    run: () => {
      if (!state.search && !state.projectFilter) return;
      state.search = "";
      state.projectFilter = null;
      render();
    },
  },
  help: { group: "Navigate", label: "toggle keyboard help", run: () => toggleHelp() },

  toggleDone: { group: "Selected item", label: "toggle done", sel: true, run: ({ sel }) => mutate(() => P.toggleDone(state.model, sel.id, todayISO())) },
  today: { group: "Selected item", label: "reschedule to today", sel: true, run: ({ sel }) => mutate(() => (sel.sched = todayISO())) },
  tomorrow: { group: "Selected item", label: "reschedule to tomorrow", sel: true, run: ({ sel }) => mutate(() => (sel.sched = P.iso(P.addDays(new Date(), 1)))) },
  nextWeek: { group: "Selected item", label: "bump to next Monday", sel: true, run: ({ sel }) => mutate(() => bump(sel, P.iso(P.nextMonday()))) },
  setSched: { group: "Selected item", label: "set scheduled date", sel: true, run: ({ sel }) => askSched(sel) },
  setDue: { group: "Selected item", label: "set due date", sel: true, run: ({ sel }) => askDue(sel) },
  setRepeat: { group: "Selected item", label: "set repeat", sel: true, run: ({ sel }) => askRepeat(sel) },
  blockers: { group: "Selected item", label: "manage blockers", sel: true, run: ({ sel }) => openBlockerPicker(sel) },
  setProject: { group: "Selected item", label: "set project", sel: true, run: ({ sel }) => openSetProject(sel) },
  editTitle: { group: "Selected item", label: "edit title", sel: true, run: ({ sel }) => { state.editing = { id: sel.id, mode: "title" }; render(); } },
  editLine: { group: "Selected item", label: "edit whole line", sel: true, run: ({ sel }) => { state.editing = { id: sel.id, mode: "full" }; render(); } },
  editNote: { group: "Selected item", label: "edit note", sel: true, run: ({ sel }) => editNote(sel) },
  editLink: { group: "Selected item", label: "edit link", sel: true, run: ({ sel }) => editLink(sel) },
  moveDown: { group: "Selected item", label: "reorder down", sel: true, run: ({ sel }) => mutate(() => reorder(sel, 1)) },
  moveUp: { group: "Selected item", label: "reorder up", sel: true, run: ({ sel }) => mutate(() => reorder(sel, -1)) },
  del: { group: "Selected item", label: "delete", sel: true, run: ({ sel }) => mutate(() => deleteItem(sel)) },
  undo: { group: "Selected item", label: "undo", run: () => undo() },

  add: { group: "Create", label: "add item here", run: () => addItem("context") },
  addInbox: { group: "Create", label: "add to Inbox", run: () => addItem("inbox") },
  capture: { group: "Create", label: "quick capture", run: () => openCapture() },
  newBlocking: { group: "Create", label: "new task that blocks this", sel: true, run: ({ sel }) => createLinkedItem(sel, "blocking") },
  newDependent: { group: "Create", label: "new task that depends on this", sel: true, run: ({ sel }) => createLinkedItem(sel, "dependent") },
};

const DEFAULT_BINDINGS = {
  down: ["j", "ArrowDown"], up: ["k", "ArrowUp"], bottom: ["G"],
  search: ["/"], filterProject: ["p"], clearFilters: ["\\"], help: ["?"],
  toggleDone: ["x"], today: ["T"], tomorrow: ["t"], nextWeek: ["w"],
  setSched: ["s"], setDue: ["d"], setRepeat: ["r"], blockers: ["b"], setProject: ["P"],
  editTitle: ["e", "Enter"], editLine: ["E"], editNote: ["n"], editLink: ["l"],
  moveDown: ["J"], moveUp: ["K"], del: ["#", "Delete"], undo: ["u"],
  add: ["a"], addInbox: ["A"], capture: ["c"],
  newBlocking: ["B"], newDependent: ["D"],
};

// not rebindable — shown for reference on the Shortcuts page
const FIXED_KEYS = [
  ["1–8", "switch view"],
  ["g g", "jump to top"],
  ["Tab / Shift-Tab", "indent / outdent as subtask"],
  ["Esc", "clear filters, then deselect, then close"],
  ["Projects view: e n l C a", "description · info · link · color · new project"],
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
  capturingKey: null, // action name being rebound on the Shortcuts page
  toastMsg: null,
  _flat: [],
  _focusEl: null,
  _lastG: 0,
};

const todayISO = () => P.iso(new Date());
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- key bindings ----------

function loadBindings() {
  let stored = {};
  try {
    stored = JSON.parse(localStorage.getItem("todo.keys") || "{}");
  } catch {}
  const b = {};
  for (const act of Object.keys(ACTIONS)) {
    b[act] = Array.isArray(stored[act]) ? stored[act] : DEFAULT_BINDINGS[act] || [];
  }
  return b;
}

let BINDINGS = loadBindings();

function saveBindings() {
  try {
    localStorage.setItem("todo.keys", JSON.stringify(BINDINGS));
  } catch {}
}

function resetBindings() {
  try {
    localStorage.removeItem("todo.keys");
  } catch {}
  BINDINGS = loadBindings();
}

function actionForKey(k) {
  for (const act of Object.keys(BINDINGS)) if (BINDINGS[act].includes(k)) return act;
  return null;
}

// bind key k to action act, removing it from whatever had it
function bindKey(act, k) {
  for (const a of Object.keys(BINDINGS)) BINDINGS[a] = BINDINGS[a].filter((x) => x !== k);
  BINDINGS[act] = [...BINDINGS[act], k];
  saveBindings();
}

function unbindKey(act, k) {
  BINDINGS[act] = BINDINGS[act].filter((x) => x !== k);
  saveBindings();
}

const KEY_LABELS = { " ": "Space", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "↵", Escape: "Esc", Backspace: "⌫", Delete: "Del", Tab: "Tab" };
const keyLabel = (k) => KEY_LABELS[k] || k;

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

function autoColor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 58%)`;
}

function projColor(name) {
  return projectEntry(name)?.color || autoColor(name);
}

// curated swatches for the color picker — spread around the wheel, tuned for the dark theme
const SWATCHES = [
  "#e5484d", "#e5844d", "#e0c04a", "#a5c261",
  "#5ec26b", "#4dc2a8", "#4da6e5", "#6a7ee5",
  "#9b6ae5", "#c96ae5", "#e56aa8", "#8b93a1",
];

function projectEntry(name) {
  return state.model.projects.find((p) => p.name === name) || null;
}

function ensureProjectEntry(name) {
  let e = projectEntry(name);
  if (!e) {
    e = { name, desc: "", meta: [], link: "", color: "" };
    state.model.projects.push(e);
  }
  if (e.link == null) e.link = "";
  if (e.color == null) e.color = "";
  return e;
}

// name + description + info + color + live task counts, for the Projects view
function projectSummaries() {
  return allProjects().map((name) => {
    const e = projectEntry(name) || { name, desc: "", meta: [], link: "", color: "" };
    const mine = state.model.items.filter((it) => it.projects.includes(name));
    const open = mine.filter((i) => !i.done);
    return {
      name,
      desc: e.desc,
      meta: e.meta,
      link: e.link || "",
      color: e.color || "",
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

function editProjectColor(name) {
  const cur = projectEntry(name)?.color || "";
  const opts = [
    { value: "", label: "auto (from name)", dot: autoColor(name), checked: !cur },
    ...SWATCHES.map((hex) => ({ value: hex, label: hex, dot: hex, checked: cur.toLowerCase() === hex })),
    { value: "__custom__", label: "custom…", action: true, always: true },
  ];
  openPicker(`${name} — color`, opts, Math.max(0, opts.findIndex((o) => o.checked)), (v) => {
    if (v === "__custom__") {
      askColor(`${name} — pick a color`, cur || autoColor(name), (hex) =>
        mutate(() => (ensureProjectEntry(name).color = hex))
      );
      return;
    }
    mutate(() => (ensureProjectEntry(name).color = v));
  });
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
    return (
      (s && s < t) ||
      (it.bumps || 0) >= 1 ||
      (!s && !d) ||
      it.isBlocked ||
      it._dangling.length > 0 ||
      it._cycle
    );
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
  // the item being edited stays visible regardless of the current filters
  const editing = (r) => state.editing && anyDesc(r, (x) => x.id === state.editing.id);
  return roots
    .filter((r) => editing(r) || anyDesc(r, (x) => viewMatch(x, state.view, t, we)))
    .filter((r) => editing(r) || !state.projectFilter || anyDesc(r, (x) => x.projects.includes(state.projectFilter)))
    .filter((r) => editing(r) || !q || anyDesc(r, (x) => x.title.toLowerCase().includes(q)))
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
      if (!RENDERING && state.editing) commitEdit(it, inp.value, state.editing.mode);
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
  hint.textContent = "e description · n info · l link · C color · a new project · click name to filter";
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

function actionGroups() {
  const groups = {};
  for (const [name, a] of Object.entries(ACTIONS)) {
    (groups[a.group] ||= []).push([name, a]);
  }
  return groups;
}

// read-only list, for the ? overlay
function keymapEl() {
  const wrap = document.createElement("div");
  wrap.className = "keymap";
  for (const [group, entries] of Object.entries(actionGroups())) {
    const h = document.createElement("h3");
    h.textContent = group;
    wrap.append(h);
    for (const [name, a] of entries) {
      const r = document.createElement("div");
      r.className = "krow";
      const keys = BINDINGS[name].map(keyLabel).join(" / ") || "—";
      r.innerHTML = `<kbd>${keys.replace(/</g, "&lt;")}</kbd><span>${a.label}</span>`;
      wrap.append(r);
    }
  }
  const h = document.createElement("h3");
  h.textContent = "Fixed";
  wrap.append(h);
  for (const [keys, desc] of FIXED_KEYS) {
    const r = document.createElement("div");
    r.className = "krow";
    r.innerHTML = `<kbd>${keys.replace(/</g, "&lt;")}</kbd><span>${desc}</span>`;
    wrap.append(r);
  }
  return wrap;
}

// editable version, for the Shortcuts view
function shortcutsEditorEl() {
  const wrap = document.createElement("div");
  wrap.className = "keymap editor";

  const bar = document.createElement("div");
  bar.className = "dayhead";
  bar.textContent = state.capturingKey
    ? `press a key for "${ACTIONS[state.capturingKey].label}"  ·  Esc to cancel`
    : "click a key to remove it · + to add · bindings are saved in this browser";
  wrap.append(bar);

  for (const [group, entries] of Object.entries(actionGroups())) {
    const h = document.createElement("h3");
    h.textContent = group;
    wrap.append(h);
    for (const [name, a] of entries) {
      const r = document.createElement("div");
      r.className = "krow edit" + (state.capturingKey === name ? " capturing" : "");
      const keys = document.createElement("span");
      keys.className = "kkeys";
      for (const key of BINDINGS[name]) {
        const b = document.createElement("button");
        b.className = "kbd";
        b.textContent = keyLabel(key);
        b.title = "remove";
        b.onclick = () => {
          unbindKey(name, key);
          render();
        };
        keys.append(b);
      }
      const add = document.createElement("button");
      add.className = "kadd";
      add.textContent = state.capturingKey === name ? "press a key…" : "＋";
      add.onclick = () => {
        state.capturingKey = state.capturingKey === name ? null : name;
        render();
      };
      keys.append(add);
      r.append(keys);
      const label = document.createElement("span");
      label.textContent = a.label;
      r.append(label);
      wrap.append(r);
    }
  }

  const h = document.createElement("h3");
  h.textContent = "Fixed (not editable)";
  wrap.append(h);
  for (const [keys, desc] of FIXED_KEYS) {
    const r = document.createElement("div");
    r.className = "krow";
    r.innerHTML = `<kbd>${keys.replace(/</g, "&lt;")}</kbd><span>${desc}</span>`;
    wrap.append(r);
  }

  const reset = document.createElement("button");
  reset.className = "kreset";
  reset.textContent = "Reset all to defaults";
  reset.onclick = () => {
    resetBindings();
    state.capturingKey = null;
    render();
  };
  wrap.append(reset);
  return wrap;
}

// ---------- shell ----------

let RENDERING = false;

function render() {
  const app = $("#app");
  RENDERING = true; // tearing down the DOM blurs the edit input — don't treat that as a commit
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
  if (state.view === "shortcuts") main.append(shortcutsEditorEl());
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

  RENDERING = false;
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
  const isColor = state.ask.color;
  const inp = document.createElement(multi ? "textarea" : "input");
  if (isColor) {
    inp.type = "color";
    inp.value = /^#[0-9a-f]{6}$/i.test(state.ask.initial || "") ? state.ask.initial : "#4da6e5";
  } else {
    inp.value = state.ask.initial || "";
  }
  if (multi) inp.rows = 5;
  const submit = () => {
    const cb = state.ask.onSubmit;
    state.ask = null;
    cb(inp.value);
    if (!state.ask) render();
  };
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && (!multi || e.shiftKey)) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      state.ask = null;
      render();
    }
  };
  if (isColor) inp.onchange = submit;
  box.append(inp);
  if (isColor) {
    const bar = document.createElement("div");
    bar.className = "askbar";
    const save = document.createElement("button");
    save.textContent = "Use this color";
    save.onclick = submit;
    bar.append(save);
    box.append(bar);
  }
  if (multi) {
    const bar = document.createElement("div");
    bar.className = "askbar";
    const save = document.createElement("button");
    save.textContent = "Save";
    save.onclick = submit;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = "⇧↵ to save · ↵ for a new line · Esc to cancel";
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

function askColor(label, initial, onSubmit) {
  state.ask = { label, initial, onSubmit, color: true };
  render();
}

// opts: { filterable, keepOpen, rebuild }
//  - filterable: type to narrow the list (arrows move, not j/k)
//  - keepOpen: onPick returning anything but an explicit close keeps the picker up
//  - rebuild: () => options, called after each pick to refresh checkmarks
function openPicker(title, options, hi, onPick, opts = {}) {
  state.picker = { title, options, hi: Math.max(0, hi), onPick, filter: "", ...opts };
  render();
}

function pickerVisible() {
  const p = state.picker;
  if (!p) return [];
  if (!p.filterable || !p.filter) return p.options;
  const q = p.filter.toLowerCase();
  return p.options.filter((o) => o.always || o.label.toLowerCase().includes(q));
}

function choosePicker(opt) {
  const p = state.picker;
  if (!p || !opt) return;
  const res = p.onPick(opt.value, opt);
  if (res === "close" || (!p.keepOpen && res !== false)) {
    state.picker = null;
  } else if (p.rebuild) {
    p.options = p.rebuild();
    if (p.hi >= pickerVisible().length) p.hi = Math.max(0, pickerVisible().length - 1);
  }
  render();
}

function pickerEl() {
  const p = state.picker;
  const wrap = document.createElement("div");
  wrap.className = "ask";
  const box = document.createElement("div");
  box.className = "askbox";
  const lbl = document.createElement("label");
  lbl.textContent = p.title;
  if (p.filterable) {
    const f = document.createElement("span");
    f.className = "pfilter";
    f.textContent = p.filter ? ` ›  ${p.filter}` : "  (type to filter)";
    lbl.append(f);
  }
  box.append(lbl);

  const list = document.createElement("div");
  list.className = "picklist";
  const vis = pickerVisible();
  if (!vis.length) {
    const e = document.createElement("div");
    e.className = "pickrow empty";
    e.textContent = "no matches";
    list.append(e);
  }
  vis.forEach((o, i) => {
    const row = document.createElement("div");
    row.className = "pickrow" + (i === p.hi ? " hi" : "") + (o.action ? " action" : "");
    if (p.numbered && i < 9) {
      const num = document.createElement("span");
      num.className = "pnum";
      num.textContent = i + 1;
      row.append(num);
    }
    if (o.checked != null) {
      const c = document.createElement("span");
      c.className = "pcheck";
      c.textContent = o.checked ? "✓" : "";
      row.append(c);
    }
    if (o.dot) {
      const d = document.createElement("span");
      d.className = "dot";
      d.style.background = o.dot;
      row.append(d);
    }
    row.append(document.createTextNode(o.label));
    if (o.hint) {
      const h = document.createElement("span");
      h.className = "prowhint";
      h.textContent = o.hint;
      row.append(h);
    }
    row.onmouseenter = () => {
      p.hi = i;
      render();
    };
    row.onclick = () => choosePicker(o);
    list.append(row);
  });
  box.append(list);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = p.filterable
    ? "type to filter · ↑↓ move · Enter choose · Esc close"
    : "↑↓ or j/k · Enter choose · Esc close";
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

// Create a new task linked to `sel` by a dependency, then edit its title.
//   "blocking"  → new task must be done first (sel needs it), inserted before sel
//   "dependent" → new task waits on sel (it needs sel), inserted after sel's subtree
function createLinkedItem(sel, direction) {
  mutate(() => {
    const items = state.model.items;
    const it = P.parse("- [ ] new").items[0];
    it.title = "";
    it.created = todayISO();
    it.depth = sel.depth;
    const [i, end] = subtreeRange(sel);
    items.splice(direction === "blocking" ? i : end, 0, it);
    if (state.view === "today" || state.view === "week") it.sched = todayISO();
    if (state.projectFilter) it.projects = [state.projectFilter];
    else if (sel.projects.length) it.projects = [sel.projects[0]];
    P.ensureIds(items);
    if (direction === "blocking") sel.needs.push(it.id);
    else it.needs.push(sel.id);
    state.selectedId = it.id;
    state.editing = { id: it.id, mode: "title" };
  });
}

// `b` — manage what blocks the selected item: toggle existing open tasks, or
// spin up a new blocking / dependent task. No ids to remember.
function openBlockerPicker(sel) {
  const build = () => [
    { value: "new-blocking", label: "＋ new task that blocks this", action: true, always: true },
    { value: "new-dependent", label: "＋ new task that depends on this", action: true, always: true },
    ...state.model.items
      .filter((it) => it.id && it.id !== sel.id && !it.done)
      .map((it) => ({
        value: it.id,
        label: it.title || "(untitled)",
        dot: it.projects[0] ? projColor(it.projects[0]) : null,
        hint: it.projects[0] ? "+" + it.projects[0] : "",
        checked: sel.needs.includes(it.id),
      })),
  ];
  openPicker(
    `Blockers for "${sel.title || "untitled"}"`,
    build(),
    0,
    (value) => {
      if (value === "new-blocking") {
        state.picker = null;
        createLinkedItem(sel, "blocking");
        return "close";
      }
      if (value === "new-dependent") {
        state.picker = null;
        createLinkedItem(sel, "dependent");
        return "close";
      }
      mutate(() => {
        const at = sel.needs.indexOf(value);
        if (at >= 0) sel.needs.splice(at, 1);
        else sel.needs.push(value);
      });
      return false; // keep the picker open for more toggles
    },
    { filterable: true, keepOpen: true, rebuild: build }
  );
}

// ---------- action helpers (called from ACTIONS) ----------

function openSearch() {
  ask("search", state.search, (v) => {
    state.search = v.trim();
    render();
  });
}

function openProjectFilter() {
  const opts = [
    { value: null, label: "All projects" },
    ...allProjects().map((p) => ({ value: p, label: p, dot: projColor(p) })),
  ];
  const cur = opts.findIndex((o) => o.value === state.projectFilter);
  openPicker("Filter by project", opts, cur < 0 ? 0 : cur, (v) => {
    state.projectFilter = v;
    render();
  }, { numbered: true });
}

function openCapture() {
  ask("quick capture", "", (v) => {
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

function toggleHelp() {
  state.overlay = state.overlay === "help" ? null : "help";
  render();
}

function askSched(sel) {
  ask("scheduled date", sel.sched || "", (v) =>
    mutate(() => (sel.sched = v.trim() ? P.parseDateInput(v, todayISO()) : null))
  );
}

function askDue(sel) {
  ask("due date", sel.due || "", (v) =>
    mutate(() => (sel.due = v.trim() ? P.parseDateInput(v, todayISO()) : null))
  );
}

function askRepeat(sel) {
  ask(
    "repeat  ( +1w from schedule · .3d from completion · blank clears )",
    sel.repeat ? `${sel.repeat.kind}${sel.repeat.n}${sel.repeat.u}` : "",
    (v) => {
      const rep = parseRepeat(v);
      if (rep !== undefined) mutate(() => (sel.repeat = rep));
    }
  );
}

function openSetProject(sel) {
  const opts = [
    { value: "", label: "(no project)" },
    ...allProjects().map((p) => ({ value: p, label: p, dot: projColor(p) })),
    { value: "__new__", label: "＋ new project…", action: true, always: true },
  ];
  const cur = opts.findIndex((o) => o.value === (sel.projects[0] || ""));
  openPicker("Set project", opts, cur < 0 ? 0 : cur, (v) => {
    if (v === "__new__") return newProjectName((name) => mutate(() => (sel.projects = [name])));
    mutate(() => (sel.projects = v ? [v] : []));
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

  // rebinding a shortcut on the Shortcuts page: capture the next key
  if (state.capturingKey) {
    e.preventDefault();
    if (["Shift", "Control", "Alt", "Meta", "CapsLock"].includes(k)) return;
    const act = state.capturingKey;
    state.capturingKey = null;
    if (k === "Escape") return render();
    if (/^[1-8]$/.test(k) || k === "g" || k === "Tab" || k === " ") {
      toast(`${keyLabel(k)} is reserved`);
      return render();
    }
    bindKey(act, k);
    return render();
  }

  if (state.picker) {
    const p = state.picker;
    const vis = pickerVisible();
    const n = Math.max(1, vis.length);
    if (k === "Escape") {
      state.picker = null;
      return render();
    }
    if (k === "Enter") return choosePicker(vis[p.hi]);
    if (k === "ArrowDown" || (!p.filterable && k === "j")) {
      p.hi = (p.hi + 1) % n;
      return render();
    }
    if (k === "ArrowUp" || (!p.filterable && k === "k")) {
      p.hi = (p.hi - 1 + n) % n;
      return render();
    }
    if (p.filterable) {
      if (k === "Backspace") {
        p.filter = p.filter.slice(0, -1);
        p.hi = 0;
        return render();
      }
      if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        p.filter += k;
        p.hi = 0;
        return render();
      }
      return;
    }
    if (/^[1-9]$/.test(k) && Number(k) <= vis.length) return choosePicker(vis[Number(k) - 1]);
    return;
  }

  if (state.overlay) {
    if (k === "Escape" || actionForKey(k) === "help") {
      state.overlay = null;
      render();
    }
    return;
  }

  // Esc: graduated back-out — filters, then selection
  if (k === "Escape") {
    if (state.search || state.projectFilter) {
      state.search = "";
      state.projectFilter = null;
      return render();
    }
    if (state.selectedId) {
      state.selectedId = null;
      return render();
    }
    return;
  }

  // view switching (not rebindable)
  if (/^[1-8]$/.test(k) && Number(k) <= VIEWS.length) {
    state.view = VIEWS[Number(k) - 1][0];
    state.selectedId = null;
    return render();
  }

  // g g chord → top (not rebindable)
  if (k === "g") {
    const now = Date.now();
    if (now - state._lastG < 450) {
      selectEdge(-1);
      state._lastG = 0;
    } else state._lastG = now;
    return;
  }

  // Tab / Shift-Tab indent (not rebindable — modifier based)
  if (k === "Tab") {
    const sel = selectedItem();
    if (sel) {
      e.preventDefault();
      mutate(() => indentItem(sel, e.shiftKey ? -1 : 1));
    }
    return;
  }

  // Projects view: contextual keys (not rebindable)
  if (state.view === "projects" && ["e", "Enter", "n", "l", "C", "a"].includes(k)) {
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
    if (k === "C") return editProjectColor(state.selectedId);
    return editProjectDesc(state.selectedId);
  }

  // rebindable actions
  const actName = actionForKey(k);
  if (actName) {
    const act = ACTIONS[actName];
    const sel = act.sel ? selectedItem() : null;
    if (act.sel && !sel) return;
    e.preventDefault();
    act.run({ sel, e });
  }
});

load();
