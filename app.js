import * as P from "./parse.js";
import * as M from "./model.js";
import { el } from "./dom.js";

const API = "/todos";

const VIEWS = [
  ["today", "Today"],
  ["tomorrow", "Tomorrow"],
  ["upcoming", "Upcoming"],
  ["inbox", "Inbox"],
  ["done", "Done"],
  ["blocked", "Blocked"],
  ["habits", "Habits"],
  ["projects", "Projects"],
  ["shortcuts", "Shortcuts"],
];

const NO_COUNT = ["done", "habits", "projects", "shortcuts"];

// views where the list order is driven purely by date — changing an item's date
// shuffles it around, so after a date edit the cursor holds its spot in the list
// rather than chasing the item to its new home (you're working straight down)
const DATE_VIEWS = new Set(["today", "tomorrow", "upcoming"]);

// Every rebindable shortcut. `sel: true` = needs a selected item. `run({ sel })`.
const ACTIONS = {
  down: { group: "Navigate", label: "move down", run: () => moveSel(1) },
  up: { group: "Navigate", label: "move up", run: () => moveSel(-1) },
  bottom: { group: "Navigate", label: "jump to bottom", run: () => selectEdge(1) },
  search: { group: "Navigate", label: "search", run: () => openSearch() },
  filterProject: { group: "Navigate", label: "filter by project", run: () => openProjectFilter() },
  filterLocation: { group: "Navigate", label: "filter by location", run: () => openLocationFilter() },
  clearFilters: {
    group: "Navigate",
    label: "leave project view / clear search + filters",
    run: () => {
      if (state.projectView) return exitProjectDetail();
      if (!state.search && !state.projectFilter && !state.locationFilter) return;
      state.search = "";
      state.projectFilter = null;
      state.locationFilter = null;
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
  syncDates: { group: "Selected item", label: "copy dates to subtasks", sel: true, run: ({ sel }) => syncSubtaskDates(sel) },
  schedMinusDay: { group: "Nudge schedule", label: "−1 day", sel: true, run: ({ sel }) => nudgeSched(sel, -1, "d") },
  schedPlusDay: { group: "Nudge schedule", label: "+1 day", sel: true, run: ({ sel }) => nudgeSched(sel, 1, "d") },
  schedMinusWeek: { group: "Nudge schedule", label: "−1 week", sel: true, run: ({ sel }) => nudgeSched(sel, -1, "w") },
  schedPlusWeek: { group: "Nudge schedule", label: "+1 week", sel: true, run: ({ sel }) => nudgeSched(sel, 1, "w") },
  schedMinusMonth: { group: "Nudge schedule", label: "−1 month", sel: true, run: ({ sel }) => nudgeSched(sel, -1, "m") },
  schedPlusMonth: { group: "Nudge schedule", label: "+1 month", sel: true, run: ({ sel }) => nudgeSched(sel, 1, "m") },
  setProject: { group: "Selected item", label: "set project", sel: true, run: ({ sel }) => openSetProject(sel) },
  setLocation: { group: "Selected item", label: "set location", sel: true, run: ({ sel }) => openSetLocation(sel) },
  editTitle: { group: "Selected item", label: "edit title", sel: true, run: ({ sel }) => { state.editing = { id: sel.id, mode: "title" }; render(); } },
  editLine: { group: "Selected item", label: "edit whole line", sel: true, run: ({ sel }) => { state.editing = { id: sel.id, mode: "full" }; render(); } },
  editNote: { group: "Selected item", label: "edit note", sel: true, run: ({ sel }) => editNote(sel) },
  editLink: { group: "Selected item", label: "edit link", sel: true, run: ({ sel }) => editLink(sel) },
  deps: { group: "Selected item", label: "deps: waiting-on / blocking", sel: true, run: ({ sel }) => { state.deps = sel.id; state._depsTrail = []; render(); } },
  moveDown: { group: "Selected item", label: "reorder down", sel: true, run: ({ sel }) => mutate(() => reorder(sel, 1), { coalesce: "reorder", reorderOnly: true }) },
  moveUp: { group: "Selected item", label: "reorder up", sel: true, run: ({ sel }) => mutate(() => reorder(sel, -1), { coalesce: "reorder", reorderOnly: true }) },
  del: { group: "Selected item", label: "delete", sel: true, run: ({ sel }) => mutate(() => deleteItem(sel)) },
  undo: { group: "Selected item", label: "undo", run: () => undo() },

  add: { group: "Create", label: "add item here", run: () => addItem() },
  bulkAdd: { group: "Create", label: "bulk add — paste, one task per line", run: () => bulkAdd() },
  capture: { group: "Create", label: "quick capture", run: () => openCapture() },
  newBlocking: { group: "Create", label: "new task that blocks this", sel: true, run: ({ sel }) => createLinkedItem(sel, "blocking") },
  newDependent: { group: "Create", label: "new task that depends on this", sel: true, run: ({ sel }) => createLinkedItem(sel, "dependent") },
  followUp: { group: "Create", label: "follow-up task (blocked on this, +3d)", sel: true, run: ({ sel }) => createFollowUp(sel) },
};

const DEFAULT_BINDINGS = {
  down: ["k", "ArrowDown"], up: ["j", "ArrowUp"], bottom: ["G"],
  search: ["/"], filterProject: ["P"], filterLocation: ["@"], clearFilters: ["\\"], help: ["?"],
  toggleDone: ["x"], today: ["T"], tomorrow: ["t"], nextWeek: ["w"],
  setSched: ["s"], setDue: ["d"], setRepeat: ["r"], setProject: ["p"], setLocation: ["L"],
  editTitle: ["e", "Enter"], editLine: ["E"], editNote: ["n"], editLink: ["l"], deps: [".", "b"],
  syncDates: ["S"],
  schedMinusDay: ["["], schedPlusDay: ["]"],
  schedMinusWeek: ["{"], schedPlusWeek: ["}"],
  schedMinusMonth: ["("], schedPlusMonth: [")"],
  moveDown: ["K"], moveUp: ["J"], del: ["#", "Delete"], undo: ["u"],
  add: ["a"], bulkAdd: ["A"], capture: ["c"],
  newBlocking: ["B"], newDependent: ["D"], followUp: ["F"],
};

// not rebindable — shown for reference on the Shortcuts page
const FIXED_KEYS = [
  ["1–9", "switch view"],
  ["⌃1–⌃9", "Nth project — switch the drill-in, or toggle the list filter"],
  ["g g", "jump to top"],
  ["Tab / Shift-Tab", "indent / outdent as subtask"],
  ["Esc / \\", "leave project drill-in → clear filters → deselect"],
  ["Projects: click / ↵ / o", "open — all of that project's tasks, editable"],
  ["Projects: j/k then …", "J/K reorder (renumbers ⌃N) · e n l L C r edit · # archive · a new"],
  ["Habits: j/k then …", "x log a rep · e desc · g goal · r rename · # archive (↵ restores; # again deletes) · a new"],
];

const state = {
  model: { items: [], preamble: [], projects: [], habits: [] },
  etag: "0",
  view: "today",
  selectedId: null,
  projectFilter: null,
  locationFilter: null, // null | "home" | "work" | "transit" | "out"
  _locSeeded: false, // per-machine default applied once
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
  deps: null, // id of the item whose dependency tree is on screen
  _depsTrail: [], // walk history for the deps overlay
  projectView: null, // project name — drilled-in "all tasks for this project" list
  projectShowDone: false, // include completed tasks in the project drill-in
  toastMsg: null,
  _flat: [],
  _focusEl: null,
  _lastG: 0,
};

const todayISO = () => P.iso(new Date());
const tomorrowISO = () => P.iso(P.addDays(new Date(), 1));
const $ = (sel, el = document) => el.querySelector(sel);

// ---------- key bindings ----------

// Overrides are stored server-side (todo.config.json, via /config) so a rebind
// follows you to every browser — regular Chrome, the installed app, the phone.
// localStorage is a same-session cache so startup doesn't flash the defaults.
function bindingsFrom(stored) {
  const b = {};
  for (const act of Object.keys(ACTIONS)) {
    b[act] = Array.isArray(stored[act]) ? stored[act] : DEFAULT_BINDINGS[act] || [];
  }
  return b;
}

function localKeyCache() {
  try {
    return JSON.parse(localStorage.getItem("todo.keys") || "{}");
  } catch {
    return {};
  }
}

let BINDINGS = bindingsFrom(localKeyCache());

// only the entries that differ from the defaults get persisted
function bindingOverrides() {
  const diff = {};
  for (const act of Object.keys(BINDINGS)) {
    if (JSON.stringify(BINDINGS[act]) !== JSON.stringify(DEFAULT_BINDINGS[act] || [])) {
      diff[act] = BINDINGS[act];
    }
  }
  return diff;
}

async function loadBindings() {
  if (DEMO) return;
  try {
    const r = await fetch("/config");
    if (!r.ok) return;
    const cfg = await r.json();
    const keys = cfg.keys || {};
    BINDINGS = bindingsFrom(keys);
    try {
      localStorage.setItem("todo.keys", JSON.stringify(keys));
    } catch {}
    if ($("#app")?.childElementCount) render();
  } catch {}
}

function saveBindings() {
  const diff = bindingOverrides();
  try {
    localStorage.setItem("todo.keys", JSON.stringify(diff));
  } catch {}
  if (DEMO) return;
  fetch("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keys: diff }),
  }).catch(() => {});
}

function resetBindings() {
  BINDINGS = bindingsFrom({});
  saveBindings();
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

// ?demo (or #demo) loads tutorial.md read-only — a sandbox with every feature on display
const DEMO = /(\bdemo\b)/.test(location.search) || location.hash === "#demo";

async function load() {
  if (DEMO) {
    state.demo = true;
    const text = await (await fetch("./tutorial.md")).text();
    state.model = P.parse(text);
    recompute();
    render();
    return;
  }
  const r = await fetch(API);
  if (r.status === 401) return void (location.href = "/login?next=" + encodeURIComponent(location.pathname));
  const { text, etag, location: locDefault } = await r.json();
  state.model = P.parse(text);
  state.etag = etag;
  if (!state._locSeeded) {
    state._locSeeded = true;
    if (locDefault && P.LOCATIONS.includes(locDefault)) state.locationFilter = locDefault;
  }
  recompute();
  render();
}

function recompute() {
  P.computeStatus(state.model, todayISO());
  const habits = P.computeHabitStats(state.model, todayISO());
  let bumped = false;
  for (const h of habits) if (h._bestChanged) { h.best = h._best; bumped = true; }
  if (bumped) scheduleSave(); // persist a new all-time streak record
}

let saveTimer = null;
function scheduleSave() {
  if (state.demo) return; // sandbox — changes live only in memory
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
    if (r.status === 401) {
      location.href = "/login?next=" + encodeURIComponent(location.pathname);
      return;
    }
    const j = await r.json();
    if (r.status === 412) {
      state.etag = j.etag;
      toast("File changed on disk — reloaded. Re-apply your last edit.");
      state.dirty = false;
      state.saveError = false;
      await load();
      return;
    }
    state.etag = j.etag;
    state.dirty = false;
    state.saveError = false;
  } catch (e) {
    state.saveError = true; // stays dirty; retry shortly
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 4000);
  } finally {
    state.saving = false;
    if (!RENDERING) render();
  }
}

const _coalesce = {};

// opts.coalesce: a tag; consecutive mutations with the same tag within ~700ms
//   share one undo step (so a burst of reorders undoes as a unit)
// opts.reorderOnly: true when the model's order changed but nothing else —
//   skips computeStatus and only re-renders the list, not the whole shell
// opts.keepSel: don't chase the selection to a new row if the current one left
//   the view — for repeat-press actions (nudge) that keep operating on one task
function mutate(fn, opts = {}) {
  const dateView = DATE_VIEWS.has(state.view);
  const now = Date.now();
  const merge = opts.coalesce && now - (_coalesce[opts.coalesce] || 0) < 700;
  _coalesce[opts.coalesce] = now;
  if (!merge) {
    state.undo.push(P.serialize(state.model));
    if (state.undo.length > 50) state.undo.shift();
  }
  const prevIdx = state._flat.indexOf(state.selectedId);
  fn();
  if (!opts.reorderOnly) recompute();
  scheduleSave();
  const paint = opts.reorderOnly ? renderMain : render;
  paint();
  // Hold the cursor's spot in the list, rather than chasing the item, when the
  // change either (a) pushed it out of view entirely (bump, done, delete…) or
  // (b) — on a date-driven view — just shuffled it to a new position because its
  // date changed. Either way you keep working straight down the list.
  const nowIdx = state._flat.indexOf(state.selectedId);
  const gone = nowIdx < 0;
  const shuffled = !opts.reorderOnly && dateView && nowIdx >= 0 && nowIdx !== prevIdx;
  if (!opts.keepSel && prevIdx >= 0 && state.selectedId && (gone || shuffled)) {
    state.selectedId = state._flat[Math.min(prevIdx, state._flat.length - 1)] ?? null;
    paint();
  }
  document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
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
  if (state.demo || state.dirty || state.editing || state.ask) return;
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

function reorderProject(name, dir) {
  const order = allProjects();
  const i = order.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return;
  mutate(() => {
    [order[i], order[j]] = [order[j], order[i]];
    state.model.projectOrder = order;
  });
}

// curated swatches for the color picker — spread around the wheel, tuned for the dark theme
const SWATCHES = [
  "#e5484d", "#e5844d", "#e0c04a", "#a5c261",
  "#5ec26b", "#4dc2a8", "#4da6e5", "#6a7ee5",
  "#9b6ae5", "#c96ae5", "#e56aa8", "#8b93a1",
];

function ensureProjectEntry(name) {
  let e = projectEntry(name);
  if (!e) {
    e = { name, desc: "", meta: [], link: "", color: "", location: "", archived: null };
    state.model.projects.push(e);
  }
  if (e.link == null) e.link = "";
  if (e.color == null) e.color = "";
  if (e.location == null) e.location = "";
  if (e.archived === undefined) e.archived = null;
  return e;
}

// name + description + info + color + live task counts, for the Projects view
function projectSummaries() {
  return allProjects().map((name) => {
    const e = projectEntry(name) || { name, desc: "", meta: [], link: "", color: "", location: "" };
    const mine = state.model.items.filter((it) => it.projects.includes(name));
    const open = mine.filter((i) => !i.done);
    return {
      name,
      desc: e.desc,
      meta: e.meta,
      link: e.link || "",
      color: e.color || "",
      location: e.location || "",
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

// isReady / isOverdue / viewMatch / sortKey / anyDesc / allProjects / projColor /
// autoColor / projectEntry all live in model.js now (shared, pure, tested). These
// thin wrappers bind the current model + today so call sites stay unchanged.
const isReady = M.isReady;
const anyDesc = M.anyDesc;
const sortKey = M.sortKey;
const autoColor = M.autoColor;
const projectEntry = (name) => M.projectEntry(state.model, name);
const projColor = (name) => M.projColor(state.model, name);
const allProjects = () => M.allProjects(state.model);
const isOverdue = (it) => M.isOverdue(it, todayISO());
const viewMatch = (it, view) => M.viewMatch(it, view, { today: todayISO(), tomorrow: tomorrowISO() });

function visibleRoots() {
  const roots = P.buildTrees(state.model.items);
  const q = state.search.toLowerCase();
  // the item being edited stays visible regardless of the current filters
  const editing = (r) => state.editing && anyDesc(r, (x) => x.id === state.editing.id);
  // location filter — a real filter: untagged tasks are hidden until you clear it
  const locOK = (x) => x._effLocation === state.locationFilter;
  const locFilterActive = state.locationFilter && state.view !== "blocked";
  return roots
    .filter((r) => editing(r) || anyDesc(r, (x) => viewMatch(x, state.view)))
    .filter((r) => editing(r) || !state.projectFilter || anyDesc(r, (x) => x.projects.includes(state.projectFilter)))
    .filter((r) => editing(r) || !locFilterActive || anyDesc(r, locOK))
    .filter((r) => editing(r) || !q || anyDesc(r, (x) => x.title.toLowerCase().includes(q)))
    // by date, then your manual order (file order) within a date — Array.sort is stable
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
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
  return el("span", { class: "chip " + (cls || ""), title: title || null }, text);
}

function rowEl(it) {
  const row = el("div", {
    class:
      "row" +
      (it.id === state.selectedId ? " sel" : "") +
      (it.done ? " done" : "") +
      (it.isBlocked ? " blocked" : ""),
    style: { paddingLeft: 10 + it.depth * 22 + "px" },
    "data-id": it.id || "",
    onclick: () => selectItem(it.id),
    ondblclick: () => {
      selectItem(it.id);
      state.editing = { id: it.id, mode: "title" };
      render();
    },
  });

  row.append(
    el("button", {
      class: "box",
      onclick: (e) => {
        e.stopPropagation();
        mutate(() => P.toggleDone(state.model, it.id, todayISO()));
      },
    }, it.done ? "✓" : it._childTotal ? `${it._childDone}/${it._childTotal}` : "")
  );

  if (state.editing && state.editing.id === it.id) {
    const full = state.editing.mode === "full";
    const inp = el("input", {
      class: "edit",
      value: full ? P.itemBody(it).replace(/\s*id:\S+\s*$/, "") : it.title,
      placeholder: full ? "title +project sched:… due:… pri:A" : null,
      onkeydown: (e) => {
        e.stopPropagation();
        if (e.key === "Enter") commitEdit(it, inp.value, state.editing.mode);
        else if (e.key === "Escape") {
          state.editing = null;
          render();
        }
      },
      onblur: () => {
        if (!RENDERING && state.editing) commitEdit(it, inp.value, state.editing.mode);
      },
    });
    row.append(inp);
    state._focusEl = inp;
    return row;
  }

  // title + chips + note live in a body column so a long title wraps under
  // itself and the checkbox stays put at the top-left
  const body = el("div", { class: "rowbody" }, el("span", { class: "title" }, it.title || "(untitled)"));
  row.append(body);

  for (const p of it.projects) {
    const c = chip("+" + p, "proj");
    c.style.borderColor = projColor(p);
    body.append(c);
  }
  // location: solid chip if the task carries its own @tag, ghosted if inherited
  const loc = it._effLocation;
  if (loc) body.append(chip("@" + loc, "loc" + (it.location ? "" : " inherited"), it.location ? "" : "from its project"));
  if (it.pri) body.append(chip(it.pri, "pri pri-" + it.pri));
  if (it.due) body.append(chip("due " + relDay(it.due), "due" + (P.daysBetween(it.due, todayISO()) <= 1 ? " hot" : "")));
  // In Today, an exact-today schedule is redundant; an overdue one still shows
  // ("3d over") so you can see how far a task has slipped.
  if (it.sched && !(state.view === "today" && it.sched === todayISO()))
    body.append(chip(relDay(it.sched), "sched"));
  if (it.repeat) body.append(chip("↻ " + it.repeat.kind + it.repeat.n + it.repeat.u, "rep"));
  if ((it.bumps || 0) > 0) {
    const heat = it.bumps >= 5 ? " hot" : it.bumps >= 3 ? " warm" : "";
    body.append(chip("⤴" + it.bumps, "bump" + heat, `bumped ${it.bumps}×`));
  }
  if (it.isBlocked && !it._cycle) {
    const names = it._blockedBy.map((b) => b.title);
    body.append(chip("🔒", "lock", "blocked by: " + names.join(", ")));
  }
  if (it._cycle) body.append(chip("⚠ cycle", "bad", "this item is in a dependency cycle"));
  if (it._dangling.length) body.append(chip("⚠ broken dep", "bad", "needs: " + it._dangling.join(", ") + " — no such task"));
  const waiting = (it._blocking || []).filter((b) => !b.done).length;
  if (waiting) {
    const c = chip("⛓ " + waiting, "deps", `${waiting} task${waiting > 1 ? "s" : ""} depend on this — press . for the tree`);
    c.style.cursor = "pointer";
    c.onclick = (e) => {
      e.stopPropagation();
      selectItem(it.id);
      state.deps = it.id;
      render();
    };
    body.append(c);
  }
  if (it.link) body.append(linkChip(it.link));
  const noteText = getNote(it);
  if (noteText) {
    body.append(
      el("div", {
        class: "note",
        onclick: (e) => {
          e.stopPropagation();
          selectItem(it.id);
          editNote(it);
        },
      }, noteText)
    );
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
  return el(
    "a",
    {
      class: "chip link",
      href: /^[a-z][\w+.-]*:/i.test(url) ? url : "https://" + url,
      target: "_blank",
      rel: "noopener noreferrer",
      title: url,
      onclick: (e) => e.stopPropagation(),
    },
    "🔗 " + linkText(url)
  );
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

function sectionHeadEl(text) {
  return el("div", { class: "dayhead" }, text);
}

function walkRows(roots, main) {
  const walk = (it) => {
    state._flat.push(it.id);
    main.append(rowEl(it));
    for (const c of it.children) walk(c);
  };
  for (const r of roots) walk(r);
}

function renderList(main) {
  const roots = visibleRoots();
  state._flat = [];
  if (!roots.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent =
      state.locationFilter && state.view !== "blocked"
        ? `Nothing tagged ${LOC_LABEL[state.locationFilter] || "@" + state.locationFilter} here. "@" to change, "\\" to clear.`
        : "Nothing here.";
    main.append(e);
    return;
  }
  // Today: overdue items float to the top under their own header
  if (state.view === "today") {
    const overdue = roots.filter((r) => anyDesc(r, isOverdue));
    const rest = roots.filter((r) => !anyDesc(r, isOverdue));
    if (overdue.length) {
      main.append(sectionHeadEl(`overdue · ${overdue.length}`));
      walkRows(overdue, main);
    }
    if (rest.length) {
      if (overdue.length) main.append(sectionHeadEl("today"));
      walkRows(rest, main);
    }
    return;
  }
  // Upcoming: split into rest-of-this-week / next-week / later
  if (state.view === "upcoming") {
    const we = P.weekEndISO(todayISO());
    const nextWe = P.iso(P.addDays(P.parseISO(we), 7));
    const labels = ["rest of this week", "next week", "later"];
    const bucket = (r) => {
      const k = sortKey(r);
      return k <= we ? 0 : k <= nextWe ? 1 : 2;
    };
    for (let b = 0; b < 3; b++) {
      const g = roots.filter((r) => bucket(r) === b);
      if (!g.length) continue;
      main.append(sectionHeadEl(`${labels[b]} · ${g.length}`));
      walkRows(g, main);
    }
    return;
  }
  walkRows(roots, main);
}

// ---------- blocked view ----------

function renderBlocked(main) {
  state._flat = [];
  const roots = visibleRoots();
  if (!roots.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "Nothing blocked, nothing broken.";
    main.append(e);
    return;
  }
  const groups = { ready: [], blocked: [], problem: [] };
  for (const r of roots) {
    if (anyDesc(r, (x) => x._dangling.length > 0 || x._cycle)) groups.problem.push(r);
    else if (anyDesc(r, (x) => x._blockedBy.length > 0)) groups.blocked.push(r);
    else groups.ready.push(r);
  }
  const section = (key, title, hint) => {
    if (!groups[key].length) return;
    main.append(sectionHeadEl(`${title} · ${groups[key].length}`));
    if (hint) {
      const h = document.createElement("div");
      h.className = "note";
      h.style.padding = "0 16px 4px";
      h.textContent = hint;
      main.append(h);
    }
    walkRows(groups[key], main);
  };
  section("ready", "ready — blockers cleared");
  section("blocked", "blocked");
  section("problem", "problems", "needs: points at a task that no longer exists, or a dependency cycle");
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
  state._flat = [];
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
      state._flat.push(it.id);
      const row = document.createElement("div");
      row.className = "row done" + (it.id === state.selectedId ? " sel" : "");
      row.style.paddingLeft = "10px";
      row.onclick = () => selectItem(it.id);
      const b = document.createElement("button");
      b.className = "box";
      b.textContent = "✓";
      b.title = "mark not done — moves it back to your active list";
      b.onclick = (e) => {
        e.stopPropagation();
        mutate(() => P.toggleDone(state.model, it.id, todayISO()));
      };
      row.append(b);
      const rbody = document.createElement("div");
      rbody.className = "rowbody";
      row.append(rbody);
      const t = document.createElement("span");
      t.className = "title";
      t.textContent = it.title;
      rbody.append(t);
      for (const p of it.projects) {
        const c = chip("+" + p, "proj");
        c.style.borderColor = projColor(p);
        rbody.append(c);
      }
      if (it.repeat) rbody.append(chip("↻", "rep"));
      if ((it.bumps || 0) > 0) rbody.append(chip("finished despite ⤴" + it.bumps, "bump"));
      if (it.created) {
        const age = P.daysBetween(it.doneDate, it.created);
        if (age >= 7) rbody.append(chip(age + "d to finish", "age"));
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
  return el("div", { class: "stat" }, el("b", null, n), el("span", null, label));
}

// ---------- habits view ----------

// selectedId on the Habits view is "habit:<name>" so it never collides with a
// task id in state._flat (recurring tasks share the list below the cards).
function selectedHabit() {
  const s = String(state.selectedId || "");
  if (!s.startsWith("habit:")) return null;
  return (state.model.habits || []).find((h) => h.name === s.slice(6)) || null;
}

function renderHabits(main) {
  const habits = state.model.habits || [];
  const lf = state.locationFilter;
  // location filter: a located habit hides unless it matches; untagged always shows
  const active = habits.filter((h) => !h.archived && (!lf || !h.location || h.location === lf));
  const archived = habits.filter((h) => h.archived);
  const recurring = P.buildTrees(state.model.items).filter(
    (r) => anyDesc(r, (x) => !x.done && !!x.repeat) && (!lf || anyDesc(r, (x) => x._effLocation === lf))
  );
  state._flat = [];

  const hint = document.createElement("div");
  hint.className = "dayhead";
  hint.textContent =
    "weekly goals · j/k select, then: x log · e description · g goal · L location · r rename · # archive · a new";
  main.append(hint);

  if (!active.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = archived.length
      ? "No active habits. Press a to add one, or ↵ on an archived one to bring it back."
      : 'No habits yet. Press a to add one (e.g. "hackerrank", goal 3).';
    main.append(e);
  }

  for (const h of active) {
    state._flat.push("habit:" + h.name);
    main.append(habitCardEl(h));
  }

  if (recurring.length) {
    main.append(sectionHeadEl(`recurring tasks · ${recurring.length}`));
    walkRows(recurring, main);
  }

  if (archived.length) {
    main.append(sectionHeadEl(`archived · ${archived.length}  ·  ↵ restore · # delete`));
    for (const h of archived) {
      state._flat.push("habit:" + h.name);
      main.append(archivedHabitRow(h));
    }
  }
}

function archivedHabitRow(h) {
  const row = document.createElement("div");
  row.className = "harch" + ("habit:" + h.name === state.selectedId ? " sel" : "");
  row.onclick = () => selectItem("habit:" + h.name);
  const name = document.createElement("span");
  name.className = "harchname";
  name.textContent = h.name;
  row.append(name);
  const meta = document.createElement("span");
  meta.className = "harchmeta";
  const when = /^\d{4}-\d{2}-\d{2}$/.test(h.archived) ? ` · archived ${relDay(h.archived)}` : "";
  meta.textContent =
    `best ${h._best || h.best || 0}w · ${h._total || 0} all-time${when}`;
  row.append(meta);
  return row;
}

function habitCardEl(h) {
  const goal = h._goal || 0;
  const done = h._thisWeek || 0;
  const card = document.createElement("div");
  card.className = "pcard hcard" + ("habit:" + h.name === state.selectedId ? " sel" : "");
  card.onclick = () => selectItem("habit:" + h.name);

  const head = document.createElement("div");
  head.className = "phead";
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.style.background = projColor(h.name);
  head.append(dot);
  const name = document.createElement("span");
  name.className = "pname";
  name.textContent = h.name;
  head.append(name);
  if (h.location) head.append(chip("@" + h.location, "loc"));
  const counts = document.createElement("span");
  counts.className = "pcounts";
  counts.textContent = goal
    ? `${done} / ${goal} this week${done >= goal ? "  ✓" : ""}`
    : `${done} this week · no goal (g)`;
  head.append(counts);
  card.append(head);

  if (h.desc) {
    const d = document.createElement("div");
    d.className = "pdesc";
    d.textContent = h.desc;
    card.append(d);
  }

  if (goal) {
    const bar = document.createElement("div");
    bar.className = "hbar";
    const fill = document.createElement("span");
    fill.style.width = Math.min(100, Math.round((done / goal) * 100)) + "%";
    if (done >= goal) fill.classList.add("met");
    bar.append(fill);
    card.append(bar);
  }

  const streak = document.createElement("div");
  streak.className = "hstreak";
  streak.textContent =
    `streak ${h._streak || 0}w · best ${h._best || 0}w · ${h._total || 0} all-time`;
  card.append(streak);

  const spark = document.createElement("div");
  spark.className = "hspark";
  spark.title = "last 8 weeks";
  for (const wk of h._spark || []) {
    const cell = document.createElement("span");
    cell.className =
      "hcell" + (wk.hit ? " hit" : wk.n ? " partial" : "") + (wk.current ? " cur" : "");
    cell.title = `${wk.n} rep${wk.n === 1 ? "" : "s"}${wk.current ? " (this week)" : ""}`;
    spark.append(cell);
  }
  card.append(spark);

  return card;
}

function logHabit(h) {
  const day = todayISO();
  mutate(() => {
    const it = P.parse(`- [x] ${h.name} +${h.name} created:${day} done:${day}`).items[0];
    state.model.items.push(it);
    P.ensureIds(state.model.items);
  });
  toast(`logged ${h.name} — ${h._thisWeek} / ${h._goal || "–"} this week`);
}

function newHabit() {
  ask('new habit name (spaces become "-")', "", (v) => {
    const name = slugifyProject(v);
    if (!name) return;
    if ((state.model.habits || []).some((h) => h.name === name))
      return toast(`"${name}" already exists`);
    ask(`${name} — goal per week (a number)`, "3", (g) => {
      const goal = Math.max(0, parseInt(g, 10) || 0);
      mutate(() => {
        (state.model.habits ||= []).push({ name, desc: "", meta: [], goal, best: 0 });
      });
      state.selectedId = "habit:" + name;
      render();
    });
  });
}

function editHabitDesc(h) {
  askText(`${h.name} — description`, h.desc || "", (v) => mutate(() => (h.desc = v.trim())));
}

function editHabitGoal(h) {
  ask(`${h.name} — goal per week`, String(h.goal ?? ""), (v) => {
    const goal = Math.max(0, parseInt(v, 10) || 0);
    mutate(() => (h.goal = goal));
  });
}

function renameHabit(h) {
  ask(`rename "${h.name}" to`, h.name, (v) => {
    const name = slugifyProject(v);
    if (!name || name === h.name) return;
    if ((state.model.habits || []).some((x) => x.name === name))
      return toast(`"${name}" already exists`);
    const old = h.name;
    mutate(() => {
      h.name = name;
      for (const it of state.model.items)
        it.projects = it.projects.map((p) => (p === old ? name : p));
    });
    state.selectedId = "habit:" + name;
    render();
  });
}

// Soft-retire: the `### block`, best, and all logged reps stay; the habit drops
// to the archived list and stops counting toward its goal / the /start check.
function archiveHabit(h) {
  mutate(() => (h.archived = todayISO()));
  toast(`archived ${h.name}`);
}

function restoreHabit(h) {
  mutate(() => (h.archived = null));
  toast(`restored ${h.name}`);
}

function deleteHabit(h) {
  // hard delete: drop the definition AND the reps it logged (title === name,
  // tagged +name). Archive is the path that keeps history — delete removes it.
  mutate(() => {
    state.model.habits = (state.model.habits || []).filter((x) => x !== h);
    state.model.items = state.model.items.filter(
      (it) => !(it.done && it.title === h.name && it.projects.length === 1 && it.projects[0] === h.name)
    );
  });
  state.selectedId = null;
  render();
}

// ---------- projects view ----------

function renderProjects(main) {
  const rows = projectSummaries();
  const archived = (state.model.projects || []).filter((p) => p.archived);
  state._flat = [...rows.map((p) => p.name), ...archived.map((p) => p.name)];

  const hint = document.createElement("div");
  hint.className = "dayhead";
  hint.textContent =
    "click / ↵ open · j/k select, then: J/K reorder · e desc · r rename · n info · l link · L location · C color · # archive · a new";
  main.append(hint);

  if (!rows.length && !archived.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No projects yet. Press a to add one, or tag a task with +name.";
    main.append(e);
    return;
  }

  rows.forEach((p, i) => {
    const card = document.createElement("div");
    card.className = "pcard" + (p.name === state.selectedId ? " sel" : "");
    card.onclick = () => openProjectDetail(p.name);

    const head = document.createElement("div");
    head.className = "phead";
    const num = document.createElement("span");
    num.className = "pcardnum";
    num.textContent = i < 9 ? `⌃${i + 1}` : "";
    if (i < 9) num.title = `⌃${i + 1} filters/opens this project`;
    head.append(num);
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = projColor(p.name);
    head.append(dot);
    const name = document.createElement("button");
    name.className = "pname";
    name.textContent = p.name;
    name.title = "open this project";
    name.onclick = () => openProjectDetail(p.name);
    head.append(name);
    if (p.location) head.append(chip("@" + p.location, "loc"));
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
  });

  if (archived.length) {
    main.append(sectionHeadEl(`archived · ${archived.length}  ·  ↵ open · # restore`));
    for (const p of archived) {
      const open = state.model.items.filter((it) => !it.done && it.projects.includes(p.name)).length;
      const row = document.createElement("div");
      row.className = "parch" + (p.name === state.selectedId ? " sel" : "");
      row.onclick = () => openProjectDetail(p.name);
      const nm = document.createElement("span");
      nm.className = "parchname";
      nm.textContent = p.name;
      row.append(nm);
      const meta = document.createElement("span");
      meta.className = "parchmeta";
      const when = /^\d{4}-\d{2}-\d{2}$/.test(p.archived) ? ` · archived ${relDay(p.archived)}` : "";
      meta.textContent = `${open} open${when}`;
      row.append(meta);
      main.append(row);
    }
  }
}

function archiveProject(name) {
  mutate(() => (ensureProjectEntry(name).archived = todayISO()));
  if (state.projectFilter === name) state.projectFilter = null;
  toast(`archived +${name} — its open tasks are hidden from the lists`);
}

function restoreProject(name) {
  mutate(() => {
    const e = projectEntry(name);
    if (e) e.archived = null;
  });
  toast(`restored +${name}`);
}

function editProjectDesc(name) {
  const e = projectEntry(name) || { desc: "" };
  askText(`${name} — description`, e.desc || "", (v) =>
    mutate(() => {
      ensureProjectEntry(name).desc = v.trim();
    })
  );
}

// ---------- project drill-in (all tasks for one project, editable) ----------

function openProjectDetail(name) {
  state.projectView = name;
  state.selectedId = null;
  render();
}

function exitProjectDetail() {
  const name = state.projectView;
  state.projectView = null;
  state.view = "projects";
  state.selectedId = name; // land back on the card you came from
  render();
}

// One gesture, two meanings: while drilled into a project it swaps which project
// you're looking at (same view); everywhere else it toggles the list filter.
function goToProject(name) {
  if (state.projectView) {
    if (name && name !== state.projectView) {
      state.projectView = name;
      state.selectedId = null;
      render();
    }
    return;
  }
  setProjectFilter(state.projectFilter === name ? null : name);
}

// Every task tagged with the project, whatever its date/status — buckets mirror
// the nav (overdue / today / tomorrow / upcoming / no date) plus optional done.
// Rows are normal rows: all the usual keys edit them in place.
function renderProjectDetail(main) {
  const name = state.projectView;
  const t = todayISO();
  const tom = tomorrowISO();
  state._flat = [];

  const controls = document.createElement("div");
  controls.className = "controls";
  const back = document.createElement("button");
  back.textContent = "\\ all projects";
  back.title = "back to the project list";
  back.onclick = exitProjectDetail;
  controls.append(back);
  const hint = document.createElement("span");
  hint.className = "chint";
  hint.textContent = "⌃1–⌃9 switch project";
  controls.append(hint);
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  controls.append(spacer);
  const dt = document.createElement("button");
  dt.textContent = state.projectShowDone ? "hide done" : "show done";
  dt.className = state.projectShowDone ? "on" : "";
  dt.onclick = () => {
    state.projectShowDone = !state.projectShowDone;
    render();
  };
  controls.append(dt);
  main.append(controls);

  const roots = P.buildTrees(state.model.items)
    .filter((r) => anyDesc(r, (x) => x.projects.includes(name)))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const open = roots.filter((r) => anyDesc(r, (x) => !x.done));
  const doneTrees = roots.filter((r) => !anyDesc(r, (x) => !x.done));

  const buckets = [
    ["overdue", (r) => anyDesc(r, isOverdue)],
    ["today", (r) => !anyDesc(r, isOverdue) && sortKey(r) === t],
    ["tomorrow", (r) => sortKey(r) === tom],
    ["upcoming", (r) => sortKey(r) > tom && sortKey(r) !== "9999-99-99"],
    ["no date", (r) => sortKey(r) === "9999-99-99"],
  ];
  let shown = 0;
  for (const [label, pred] of buckets) {
    const g = open.filter(pred);
    if (!g.length) continue;
    shown += g.length;
    main.append(sectionHeadEl(`${label} · ${g.length}`));
    walkRows(g, main);
  }
  if (!shown) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No open tasks in this project — press a to add one.";
    main.append(e);
  }
  if (state.projectShowDone && doneTrees.length) {
    main.append(sectionHeadEl(`done · ${doneTrees.length}`));
    walkRows(doneTrees, main);
  }
}

function editProjectMeta(name) {
  const e = projectEntry(name) || { meta: [] };
  const lines = [];
  if (e.location) lines.push(`location: ${e.location}`);
  for (const [k, v] of e.meta) lines.push(`${k}: ${v}`);
  askText(`${name} — info (one "key: value" per line; location: home|work|transit|out)`, lines.join("\n"), (v) =>
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
      // "link:" and "location:" lines become structured fields, not meta rows
      const linkPair = pairs.find(([k]) => k.toLowerCase() === "link");
      if (linkPair) ent.link = linkPair[1];
      const locPair = pairs.find(([k]) => k.toLowerCase() === "location");
      if (locPair) ent.location = P.LOCATIONS.includes(locPair[1].toLowerCase().trim()) ? locPair[1].toLowerCase().trim() : "";
      ent.meta = pairs.filter(([k]) => !["link", "location", "archived"].includes(k.toLowerCase()));
    })
  );
}

function slugifyProject(v) {
  return v
    .trim()
    .replace(/^\+/, "")
    .replace(/[^\w-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function newProjectName(onName) {
  ask('new project name (spaces become "-")', "", (v) => {
    const name = slugifyProject(v);
    if (name) onName(name);
  });
}

// Rename a project everywhere: its `## Projects` entry, every `+tag`, the filter
// and the current selection.
function renameProject(oldName) {
  ask(`rename "${oldName}" to`, oldName, (v) => {
    const name = slugifyProject(v);
    if (!name || name === oldName) return;
    if (allProjects().includes(name)) return toast(`"${name}" already exists`);
    mutate(() => {
      const e = projectEntry(oldName);
      if (e) e.name = name;
      for (const it of state.model.items) {
        it.projects = it.projects.map((p) => (p === oldName ? name : p));
      }
      if (state.projectFilter === oldName) state.projectFilter = name;
      if (state.selectedId === oldName) state.selectedId = name;
    });
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
  // Fixed keys sit in their own full-width band — several have long key text
  // that reads badly squeezed into a narrow column.
  const fixed = document.createElement("div");
  fixed.className = "kfixed";
  const h = document.createElement("h3");
  h.textContent = "Fixed";
  fixed.append(h);
  for (const [keys, desc] of FIXED_KEYS) {
    const r = document.createElement("div");
    r.className = "krow";
    r.innerHTML = `<kbd>${keys.replace(/</g, "&lt;")}</kbd><span>${desc}</span>`;
    fixed.append(r);
  }
  wrap.append(fixed);
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
    : "click a key to remove it · + to add · saved on the server — they follow you to every browser and your phone";
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

  if (!state.demo) {
    const demo = document.createElement("a");
    demo.className = "demolink";
    demo.href = "?demo";
    demo.textContent = "Open the demo — a sandbox with every feature on display →";
    wrap.append(demo);

    const bookmarklet = document.createElement("a");
    bookmarklet.className = "demolink";
    bookmarklet.href = "/bookmarklet.html";
    bookmarklet.target = "_blank";
    bookmarklet.rel = "noopener noreferrer";
    bookmarklet.textContent = "Get the job-posting capture bookmarklet →";
    wrap.append(bookmarklet);
  }
  return wrap;
}

// ---------- shell ----------

let RENDERING = false;

function paintList(main) {
  if (state.projectView) renderProjectDetail(main);
  else if (state.view === "shortcuts") main.append(shortcutsEditorEl());
  else if (state.view === "projects") renderProjects(main);
  else if (state.view === "done") renderDone(main);
  else if (state.view === "blocked") renderBlocked(main);
  else if (state.view === "habits") renderHabits(main);
  else renderList(main);
}

// rebuild only the list, not the sidebar/header — for changes that don't move
// items between views (reordering)
function renderMain() {
  const main = $(".main");
  if (!main) return render();
  RENDERING = true;
  main.innerHTML = "";
  state._focusEl = null;
  paintList(main);
  RENDERING = false;
  if (state._focusEl) state._focusEl.focus();
}

function render() {
  const app = $("#app");
  RENDERING = true; // tearing down the DOM blurs the edit input — don't treat that as a commit
  app.innerHTML = "";
  state._focusEl = null;

  const side = document.createElement("nav");
  side.className = "side";
  VIEWS.forEach(([k, label], i) => {
    const b = document.createElement("button");
    b.className = "navbtn" + (state.view === k ? " on" : "");
    let count = "";
    if (!NO_COUNT.includes(k)) {
      const n = P.buildTrees(state.model.items).filter((r) => anyDesc(r, (x) => viewMatch(x, k))).length;
      if (n) count = ` ${n}`;
    }
    b.innerHTML = `<span class="nk">${i + 1}</span> ${label}<span class="nc">${count}</span>`;
    b.onclick = () => {
      state.view = k;
      state.projectView = null;
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
    all.className = "navbtn tiny" + (!state.projectFilter && !state.projectView ? " on" : "");
    all.innerHTML = `<span class="nk">\\</span> all`;
    all.title = state.projectView ? "back to all projects (\\)" : "clear project filter (\\)";
    all.onclick = () => {
      if (state.projectView) return exitProjectDetail();
      state.projectFilter = null;
      render();
    };
    side.append(all);
    // numbered 1–9 to match ⌃1–⌃9 (and the P picker)
    projs.forEach((p, i) => {
      const b = document.createElement("button");
      const active = state.projectView ? state.projectView === p : state.projectFilter === p;
      b.className = "navbtn tiny" + (active ? " on" : "");
      const nk = i < 9 ? `⌃${i + 1}` : "";
      b.innerHTML = `<span class="nk">${nk}</span><span class="dot" style="background:${projColor(p)}"></span><span class="plabel">${p}</span>`;
      if (i < 9) b.title = `${state.projectView ? "open" : "filter by"} ${p}  (⌃${i + 1})`;
      b.onclick = () => goToProject(p);
      side.append(b);
    });
  }

  // location filter — a small always-visible row; "anywhere" = off (shows all)
  const lh = document.createElement("div");
  lh.className = "sidehead";
  lh.textContent = "location";
  side.append(lh);
  const lall = document.createElement("button");
  lall.className = "navbtn tiny" + (state.locationFilter ? "" : " on");
  lall.innerHTML = `<span class="nk">@</span> anywhere`;
  lall.title = "clear location filter (@)";
  lall.onclick = () => {
    state.locationFilter = null;
    render();
  };
  side.append(lall);
  P.LOCATIONS.forEach((loc) => {
    const b = document.createElement("button");
    b.className = "navbtn tiny" + (state.locationFilter === loc ? " on" : "");
    b.innerHTML = `<span class="nk"></span><span class="plabel">${LOC_LABEL[loc]}</span>`;
    b.title = `show only @${loc} tasks`;
    b.onclick = () => {
      state.locationFilter = state.locationFilter === loc ? null : loc;
      state.selectedId = null;
      render();
    };
    side.append(b);
  });

  app.append(side);

  const mainWrap = document.createElement("main");
  const head = document.createElement("header");
  const headTitle = state.projectView
    ? `+${state.projectView}`
    : VIEWS.find((v) => v[0] === state.view)[1];
  head.innerHTML = `<h1>${headTitle}</h1>`;
  if (state.search) {
    const s = chip('search: "' + state.search + '" ✕', "filter");
    s.onclick = () => {
      state.search = "";
      render();
    };
    head.append(s);
  }
  if (state.locationFilter) {
    const l = chip((LOC_LABEL[state.locationFilter] || state.locationFilter) + " ✕", "filter");
    l.title = "location filter — showing only tasks tagged this location. Click to clear.";
    l.onclick = () => {
      state.locationFilter = null;
      render();
    };
    head.append(l);
  }
  if (!state.demo) {
    if (state.saveError) {
      const c = chip("save failed · retry", "savefail", "couldn't reach the server — click to retry now");
      c.onclick = () => save();
      head.append(c);
    } else if (state.dirty || state.saving) {
      head.append(chip("saving…", "saving"));
    } else {
      head.append(chip("synced", "synced", "your edits are saved to the server"));
    }
  }
  if (state.demo) {
    const d = chip("DEMO · changes aren't saved · exit ✕", "demo");
    d.onclick = () => {
      location.href = location.pathname;
    };
    head.append(d);
  }
  mainWrap.append(head);

  const main = document.createElement("div");
  main.className = "main";
  paintList(main);
  mainWrap.append(main);
  app.append(mainWrap);

  if (state.ask) app.append(askEl());
  if (state.picker) app.append(pickerEl());
  if (state.overlay === "help") app.append(helpEl());
  if (state.deps) app.append(depsEl());
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
    : (p.numbered ? "number picks · " : "") + "↑↓ or nav keys move · Enter choose · Esc close";
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
  wrap.className = "ask help";
  const box = document.createElement("div");
  box.className = "askbox wide help";
  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "press ? or Esc to close";
  box.append(hint);
  box.append(keymapEl());
  wrap.append(box);
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.overlay = null;
      render();
    }
  };
  return wrap;
}

// two-column dependency view for the focused item (state.deps)
function closeDeps() {
  state.deps = null;
  state._depsTrail = [];
  render();
}

function walkInto(id) {
  state._depsTrail.push(state.deps);
  state.deps = id;
  render();
}

// inline "find a task and link it" field for one column of the deps overlay
function depsSearchEl(placeholder, eligible, onPick) {
  const box = document.createElement("div");
  box.className = "depssearch";
  const inp = document.createElement("input");
  inp.placeholder = placeholder;
  const results = document.createElement("div");
  results.className = "depsresults";
  const refresh = () => {
    results.innerHTML = "";
    const q = inp.value.trim().toLowerCase();
    if (!q) return;
    const hits = eligible()
      .filter((t) => (t.title || "").toLowerCase().includes(q))
      .slice(0, 6);
    for (const t of hits) {
      const r = document.createElement("button");
      r.className = "depsresult";
      r.textContent = t.title || "(untitled)";
      r.onmousedown = (e) => {
        e.preventDefault(); // fire before the input's blur
        onPick(t);
      };
      results.append(r);
    }
    if (!hits.length) {
      const e = document.createElement("div");
      e.className = "note";
      e.textContent = "no match";
      results.append(e);
    }
  };
  inp.oninput = refresh;
  inp.onkeydown = (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      inp.value = "";
      refresh();
      inp.blur();
    }
  };
  box.append(inp, results);
  return box;
}

function depsEl() {
  const byId = new Map(state.model.items.filter((i) => i.id).map((i) => [i.id, i]));
  const it = byId.get(state.deps);
  const wrap = document.createElement("div");
  wrap.className = "ask";
  wrap.onclick = (e) => {
    if (e.target === wrap) closeDeps();
  };
  const box = document.createElement("div");
  box.className = "askbox wide deps";
  wrap.append(box);
  if (!it) {
    box.textContent = "gone.";
    return wrap;
  }

  const head = document.createElement("div");
  head.className = "depshead";
  if (state._depsTrail.length) {
    const back = document.createElement("button");
    back.className = "kbd";
    back.textContent = "← back";
    back.onclick = () => {
      state.deps = state._depsTrail.pop();
      render();
    };
    head.append(back);
  }
  const title = document.createElement("button");
  title.className = "depstitle";
  title.textContent = (it.done ? "✓ " : "") + (it.title || "(untitled)");
  title.title = "select this task in the list";
  title.onclick = () => {
    selectItem(it.id);
    closeDeps();
  };
  head.append(title);
  box.append(head);

  const cols = document.createElement("div");
  cols.className = "depscols";
  box.append(cols);

  const entries = []; // ids in render order, for number-key walk-in
  const col = (label, list, describe, unlink, footer) => {
    const c = document.createElement("div");
    c.className = "depscol";
    const h = document.createElement("h3");
    h.textContent = `${label} · ${list.length}`;
    c.append(h);
    if (!list.length) {
      const e = document.createElement("div");
      e.className = "note";
      e.textContent = "—";
      c.append(e);
    }
    for (const entry of list) {
      const row = document.createElement("div");
      row.className = "depsrow";
      const n = entries.length + 1;
      const go = document.createElement("button");
      go.className = "depsgo";
      go.innerHTML = `<span class="pnum">${n < 10 ? n : ""}</span>`;
      go.append(document.createTextNode(describe(entry)));
      go.disabled = !entry.id;
      go.onclick = () => entry.id && walkInto(entry.id);
      row.append(go);
      const x = document.createElement("button");
      x.className = "depsx";
      x.textContent = "✕";
      x.title = "unlink";
      x.onclick = () => mutate(() => unlink(entry));
      row.append(x);
      entries.push(entry.id || null);
      c.append(row);
    }
    c.append(footer);
    return c;
  };

  const linkedIds = new Set(it.needs);
  const openTasks = () => state.model.items.filter((t) => t.id && !t.done && t.id !== it.id);

  // waiting on — its needs:
  const needs = it.needs.map((nid) => byId.get(nid) || { dangling: nid });
  const waitFoot = document.createElement("div");
  waitFoot.className = "depsfoot";
  waitFoot.append(
    depsSearchEl(
      "find a task that blocks this…",
      () => openTasks().filter((t) => !linkedIds.has(t.id)),
      (t) => {
        mutate(() => it.needs.push(t.id));
      }
    )
  );
  const newBlk = document.createElement("button");
  newBlk.className = "kadd";
  newBlk.textContent = "＋ new task that blocks this";
  newBlk.onclick = () => {
    const sel = it;
    state.deps = null;
    state._depsTrail = [];
    createLinkedItem(sel, "blocking");
  };
  waitFoot.append(newBlk);
  cols.append(
    col(
      "waiting on",
      needs,
      (x) =>
        x.dangling
          ? `⚠ unknown: ${x.dangling}`
          : `${x.done ? "✓ " : x._blockedBy?.length ? "🔒 " : "○ "}${x.title || "(untitled)"}`,
      (x) => {
        it.needs = it.needs.filter((nid) => nid !== (x.id || x.dangling));
      },
      waitFoot
    )
  );

  // blocking — tasks whose needs: point here
  const depFoot = document.createElement("div");
  depFoot.className = "depsfoot";
  depFoot.append(
    depsSearchEl(
      "find a task that depends on this…",
      () => openTasks().filter((t) => !t.needs.includes(it.id)),
      (t) => {
        mutate(() => t.needs.push(it.id));
      }
    )
  );
  const newDep = document.createElement("button");
  newDep.className = "kadd";
  newDep.textContent = "＋ new task that depends on this";
  newDep.onclick = () => {
    const sel = it;
    state.deps = null;
    state._depsTrail = [];
    createLinkedItem(sel, "dependent");
  };
  depFoot.append(newDep);
  cols.append(
    col(
      "blocking",
      it._blocking || [],
      (x) => {
        const ready = !x.done && x._blockedBy.filter((b) => b.id !== it.id).every((b) => b.done);
        return `${x.done ? "✓ " : ready ? "▸ " : "· "}${x.title || "(untitled)"}`;
      },
      (x) => {
        x.needs = x.needs.filter((nid) => nid !== it.id);
      },
      depFoot
    )
  );

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "number → walk in · ✕ → unlink · title → select in list · Backspace → back · Esc → close";
  box.append(hint);
  wrap._entries = entries;
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

// The schedule a freshly-added task should carry, from where you're standing:
// Today → today, Tomorrow → tomorrow, Upcoming → the date of the section you're
// in (read off the sibling you're next to; falls back to end of this week).
function newItemSched(sel) {
  if (state.view === "today") return todayISO();
  if (state.view === "tomorrow") return tomorrowISO();
  if (state.view === "upcoming") {
    const k = sel && sortKey(sel);
    return k && k !== "9999-99-99" ? k : P.weekEndISO(todayISO());
  }
  return null;
}

// Add a task inline: after the selected row (as a sibling), or at the top.
// Picks up the current view's date context and the active project filter.
function addItem() {
  mutate(() => {
    const it = P.parse("- [ ] new task").items[0];
    it.title = "";
    it.created = todayISO();
    const items = state.model.items;
    const sel = selectedItem();
    if (sel) {
      const [, end] = subtreeRange(sel);
      it.depth = sel.depth;
      items.splice(end, 0, it);
    } else items.unshift(it);
    const sched = newItemSched(sel);
    if (sched) it.sched = sched;
    if (state.projectView) it.projects = [state.projectView];
    else if (state.projectFilter) it.projects = [state.projectFilter];
    if (state.locationFilter && !it.location) it.location = state.locationFilter;
    P.ensureIds(items);
    state.selectedId = it.id;
    state.editing = { id: it.id, mode: "title" };
  });
}

// Paste a block of text → one task per line, each treated like a fresh `a`:
// same insertion point, view date-context and project. Common list prefixes
// (-, *, 1., "[ ]") are stripped; tokens inside a line (+proj, due:…, pri:A) win.
function bulkAdd() {
  askText("bulk add — one task per line  (⇧↵ to add)", "", (text) => {
    const lines = text
      .split("\n")
      .map((l) => l.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?(?:\[[ xX]?\]\s*)?/, "").trim())
      .filter(Boolean);
    if (!lines.length) return;
    mutate(() => {
      const items = state.model.items;
      const sel = selectedItem();
      const depth = sel ? sel.depth : 0;
      let at = sel ? subtreeRange(sel)[1] : 0;
      const sched = newItemSched(sel);
      const proj = state.projectView || state.projectFilter || null;
      const created = todayISO();
      const added = [];
      for (const line of lines) {
        const it = P.parse("- [ ] " + normalizeDatesInText(line)).items[0];
        it.depth = depth;
        it.created = created;
        if (sched && !it.sched && !it.due) it.sched = sched;
        if (proj && !it.projects.length) it.projects = [proj];
        if (state.locationFilter && !it.location) it.location = state.locationFilter;
        items.splice(at++, 0, it);
        added.push(it);
      }
      P.ensureIds(items);
      if (added[0]) state.selectedId = added[0].id;
    });
    toast(`added ${lines.length} task${lines.length > 1 ? "s" : ""}`);
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
    if (state.view === "today") it.sched = todayISO();
    else if (state.view === "tomorrow") it.sched = tomorrowISO();
    if (state.projectFilter) it.projects = [state.projectFilter];
    else if (sel.projects.length) it.projects = [sel.projects[0]];
    P.ensureIds(items);
    if (direction === "blocking") sel.needs.push(it.id);
    else it.needs.push(sel.id);
    state.selectedId = it.id;
    state.editing = { id: it.id, mode: "title" };
  });
}

// "reach out to X" → a dependent "follow up on reach out to X" task, blocked on
// the original and scheduled a few days out so it surfaces only once you've
// actually made contact. Strips a leading "follow up on/with/re" first so a
// chain of these stays "follow up on X", not "follow up on follow up on X".
const FOLLOWUP_RE = /^\s*follow[-\s]?up\s+(?:on|with|re|about)\s+/i;
function createFollowUp(sel) {
  const base = (sel.title || "").replace(FOLLOWUP_RE, "").trim();
  const origin = sel.id;
  let newId;
  mutate(() => {
    const items = state.model.items;
    const it = P.parse("- [ ] new").items[0];
    it.title = "follow up on " + base;
    it.created = todayISO();
    it.depth = sel.depth;
    it.sched = P.iso(P.addDays(new Date(), 3));
    if (sel.projects.length) it.projects = [sel.projects[0]];
    const [, end] = subtreeRange(sel);
    items.splice(end, 0, it);
    P.ensureIds(items);
    it.needs.push(sel.id);
    newId = it.id;
    state.selectedId = it.id;
  }, { keepSel: true });
  toast(`follow-up queued — now check off "${(sel.title || "task").slice(0, 28)}"`);
  // brief beat on the new task, then hand focus back to the original so the
  // usual next move (mark the reach-out done with x) just works
  setTimeout(() => {
    if (state.selectedId === newId) {
      state.selectedId = origin;
      render();
      document.querySelector(".row.sel")?.scrollIntoView({ block: "nearest" });
    }
  }, 500);
}

// ---------- action helpers (called from ACTIONS) ----------

function openSearch() {
  ask("search", state.search, (v) => {
    state.search = v.trim();
    render();
  });
}

// Apply a project filter (null clears). Drops out of a project drill-in, and if
// you're on the Projects cards — where a filter is invisible — jumps to Today.
function setProjectFilter(name) {
  state.projectFilter = name;
  state.projectView = null;
  if (name && state.view === "projects") state.view = "today";
  state.selectedId = null;
  render();
}

function openProjectFilter() {
  // projects numbered 1..N to match ⌃1..⌃N and the sidebar; clear is last
  const list = allProjects();
  const opts = [
    ...list.map((p) => ({ value: p, label: p, dot: projColor(p) })),
    { value: null, label: "All projects (clear)" },
  ];
  const cur = opts.findIndex((o) => o.value === state.projectFilter);
  openPicker("Filter by project", opts, cur < 0 ? opts.length - 1 : cur, (v) => setProjectFilter(v), {
    numbered: true,
  });
}

function openCapture() {
  ask("quick capture", "", (v) => {
    if (!v.trim()) return;
    mutate(() => {
      const it = P.parse("- [ ] " + normalizeDatesInText(v)).items[0];
      it.created = todayISO();
      if (state.projectFilter && !it.projects.length) it.projects = [state.projectFilter];
      if (state.locationFilter && !it.location) it.location = state.locationFilter;
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

// Copy this item's sched/due onto every task nested under it. Handy after
// splitting a task into a checklist: view filtering already floors a subtask's
// effective date to its parent's, and this makes the raw tokens match too.
function syncSubtaskDates(sel) {
  const [i, e] = subtreeRange(sel);
  const n = e - i - 1;
  if (n < 1) return toast("no subtasks to sync");
  mutate(() => {
    for (let j = i + 1; j < e; j++) {
      state.model.items[j].sched = sel.sched;
      state.model.items[j].due = sel.due;
    }
  });
  toast(`${n} subtask${n > 1 ? "s" : ""} → ${sel.sched ? relDay(sel.sched) : "no date"}`);
}

// Shift the selected item's schedule by a relative amount, from its current
// sched (or from today if it has none). Doesn't touch bumps: — a deliberate
// reschedule, not a "push it off" bump. keepSel so you can hold on one task and
// press [ / ] repeatedly even after it scrolls out of the current view.
function nudgeSched(sel, n, unit) {
  const base = sel.sched ? P.parseISO(sel.sched) : new Date();
  mutate(() => (sel.sched = P.iso(P.addUnit(base, n, unit))), { coalesce: "nudge", keepSel: true });
  toast(`"${(sel.title || "task").slice(0, 28)}" → ${relDay(sel.sched)}`);
}

const LOC_LABEL = { home: "🏠 home", work: "🏢 work", transit: "🚌 in transit", out: "🛒 out" };

function openLocationFilter() {
  const opts = [
    ...P.LOCATIONS.map((l) => ({ value: l, label: LOC_LABEL[l] })),
    { value: null, label: "Anywhere (clear)" },
  ];
  const cur = opts.findIndex((o) => o.value === state.locationFilter);
  openPicker("Filter by location", opts, cur < 0 ? opts.length - 1 : cur, (v) => {
    state.locationFilter = v;
    state.selectedId = null;
    render();
  });
}

// picker of the 4 locations + "none"; `set(value)` gets "" or a location name
function pickLocation(title, current, set) {
  const opts = [
    { value: "", label: "(anywhere — no location)" },
    ...P.LOCATIONS.map((l) => ({ value: l, label: LOC_LABEL[l] })),
  ];
  const cur = opts.findIndex((o) => o.value === (current || ""));
  openPicker(title, opts, cur < 0 ? 0 : cur, (v) => set(v));
}

function openSetLocation(sel) {
  pickLocation("Set location", sel.location, (v) => mutate(() => (sel.location = v || null)));
}

function openSetProjectLocation(name) {
  pickLocation(`${name} — location`, projectEntry(name)?.location, (v) =>
    mutate(() => (ensureProjectEntry(name).location = v || ""))
  );
}

function openSetHabitLocation(h) {
  pickLocation(`${h.name} — location`, h.location, (v) => mutate(() => (h.location = v || "")));
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
  }, { numbered: true });
}

// Move `it`'s subtree past its nearest sibling that (a) is visible in the current
// view and (b) sorts to the same slot — same depth, same sortKey (date). Since
// list views sort by date and keep file order within a date, that's the only
// reorder that's actually visible, so J/K nudges the list you're looking at.
function reorder(it, dir) {
  const items = state.model.items;
  const visible = new Set(state._flat);
  const key = sortKey(it);
  const sibling = (x) => x.depth === it.depth && visible.has(x.id) && sortKey(x) === key;
  const [i, e] = subtreeRange(it);
  if (dir < 0) {
    let p = i - 1;
    while (p >= 0) {
      if (items[p].depth < it.depth) return; // out of the parent
      if (sibling(items[p])) break;
      p--;
    }
    if (p < 0) return;
    let ps = p;
    while (ps > 0 && items[ps - 1].depth > it.depth) ps--; // start of that sibling's subtree
    const block = items.splice(i, e - i);
    items.splice(ps, 0, ...block);
  } else {
    let n = e;
    while (n < items.length) {
      if (items[n].depth < it.depth) return;
      if (sibling(items[n])) break;
      n++;
    }
    if (n >= items.length) return;
    let ne = n + 1;
    while (ne < items.length && items[ne].depth > it.depth) ne++; // end of that sibling's subtree
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
  state.model.items.splice(i, e - i);
  // mutate() moves the selection to the next row down (or nothing) after re-render
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
    if (/^[1-9]$/.test(k) || k === "g" || k === "Tab" || k === " ") {
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
    if (k === "ArrowDown" || (!p.filterable && actionForKey(k) === "down")) {
      p.hi = (p.hi + 1) % n;
      return render();
    }
    if (k === "ArrowUp" || (!p.filterable && actionForKey(k) === "up")) {
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

  if (state.deps) {
    if (k === "Escape" || actionForKey(k) === "deps") return closeDeps();
    if (k === "Backspace") {
      if (state._depsTrail.length) {
        state.deps = state._depsTrail.pop();
        render();
      } else closeDeps();
      return;
    }
    if (/^[1-9]$/.test(k)) {
      const id = document.querySelector(".ask")?._entries?.[Number(k) - 1];
      if (id) {
        state._depsTrail.push(state.deps);
        state.deps = id;
        render();
      }
      return;
    }
    return;
  }

  // Esc: leave a project drill-in, then graduated back-out — filters, selection
  if (k === "Escape") {
    if (state.projectView) return exitProjectDetail();
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

  // ⌃1–⌃9 → the Nth project: swap the drill-in if you're in one, else toggle the
  // list filter (matches the sidebar numbers)
  if (e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(k)) {
    e.preventDefault();
    const p = allProjects()[Number(k) - 1];
    if (p) goToProject(p);
    return;
  }

  // view switching (not rebindable)
  if (/^[1-9]$/.test(k) && Number(k) <= VIEWS.length) {
    state.view = VIEWS[Number(k) - 1][0];
    state.projectView = null;
    state.selectedId = null;
    return render();
  }

  // Habits view: contextual keys (not rebindable) — must precede the g-chord.
  // Only intercept when a habit card is selected; a recurring task in the list
  // below falls through to the normal task keys.
  if (state.view === "habits") {
    if (k === "a") {
      e.preventDefault();
      return newHabit();
    }
    const h = selectedHabit();
    if (h && ["x", "Enter", "e", "g", "L", "r", "#", "Delete"].includes(k)) {
      e.preventDefault();
      if (h.archived) {
        // progressive delete: ↵/x restores, # (again) purges for good
        if (k === "Enter" || k === "x") return restoreHabit(h);
        if (k === "#" || k === "Delete") return deleteHabit(h);
        return; // e/g/r/L don't apply to an archived habit
      }
      if (k === "x" || k === "Enter") return logHabit(h);
      if (k === "e") return editHabitDesc(h);
      if (k === "g") return editHabitGoal(h);
      if (k === "L") return openSetHabitLocation(h);
      if (k === "r") return renameHabit(h);
      return archiveHabit(h); // # / Delete — soft, reversible
    }
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
  if (state.view === "projects" && !state.projectView && ["e", "Enter", "o", "n", "l", "L", "C", "r", "a", "J", "K", "#", "Delete"].includes(k)) {
    e.preventDefault();
    if (k === "a")
      return newProjectName((name) => {
        mutate(() => ensureProjectEntry(name));
        state.selectedId = name;
        editProjectDesc(name);
      });
    if (!state.selectedId) return;
    const arch = projectEntry(state.selectedId)?.archived;
    if (k === "#" || k === "Delete") return arch ? restoreProject(state.selectedId) : archiveProject(state.selectedId);
    if (k === "Enter" || k === "o") return openProjectDetail(state.selectedId);
    if (k === "L") return openSetProjectLocation(state.selectedId);
    if (arch) return; // an archived project — only ↵ (open), L, # (restore) apply
    if (k === "J") return reorderProject(state.selectedId, -1);
    if (k === "K") return reorderProject(state.selectedId, 1);
    if (k === "n") return editProjectMeta(state.selectedId);
    if (k === "l") return editProjectLink(state.selectedId);
    if (k === "C") return editProjectColor(state.selectedId);
    if (k === "r") return renameProject(state.selectedId);
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

loadBindings();
load();
