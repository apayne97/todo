// Mobile todo — a small read/complete/snooze/capture front-end over the same
// todos.md + /todos API the desktop app uses. Shares parse.js. Keyboard-free.
import * as P from "./parse.js";
import * as M from "./model.js";

const API = "/todos";
const SNAP = "todo.mobile.snapshot";

const todayISO = () => P.iso(new Date());
const tomorrowISO = () => P.iso(P.addDays(new Date(), 1));

const VIEWS = [
  ["today", "Today"],
  ["habits", "Habits"],
  ["inbox", "Inbox"],
];

const state = {
  model: { items: [], preamble: [], projects: [], habits: [] },
  etag: "0",
  view: "today",
  expanded: null, // id of the row whose detail panel is open
  loaded: false,
  offline: false,
  saving: false,
  dirty: false,
  adding: false,
  filterOpen: false, // "project" | "location" | false
  projectFilter: null, // project name, or null
  locationFilter: null, // "home" | "work" | "transit" | "out" | null
  _locSeeded: false,
  undo: null, // { text, label }
  toastMsg: null,
  _preEdit: null,
  _undoTimer: null,
  _toastTimer: null,
};

const $ = (sel, el = document) => el.querySelector(sel);

// ---------- data ----------

function recompute() {
  P.computeStatus(state.model, todayISO());
  const habits = P.computeHabitStats(state.model, todayISO());
  let bumped = false;
  for (const h of habits) if (h._bestChanged) { h.best = h._best; bumped = true; }
  if (bumped) scheduleSave(); // a new all-time streak — persist it
}

function activeHabits() {
  const lf = state.locationFilter;
  return (state.model.habits || []).filter(
    (h) => !h.archived && (!lf || !h.location || h.location === lf)
  );
}

function cacheSnapshot(text, etag) {
  try {
    localStorage.setItem(SNAP, JSON.stringify({ text, etag, at: Date.now() }));
  } catch {}
}

function readSnapshot() {
  try {
    return JSON.parse(localStorage.getItem(SNAP) || "null");
  } catch {
    return null;
  }
}

function gotoLogin() {
  location.href = "/login?next=" + encodeURIComponent(location.pathname);
}

async function load() {
  if (state.dirty) return; // don't clobber an unsaved local edit
  try {
    const r = await fetch(API, { headers: { "Cache-Control": "no-cache" } });
    if (r.status === 401) return gotoLogin();
    if (!r.ok) throw new Error("http " + r.status);
    const { text, etag, location: locDefault } = await r.json();
    state.model = P.parse(text);
    state.etag = etag;
    state.loaded = true;
    state.offline = false;
    if (!state._locSeeded) {
      state._locSeeded = true;
      if (locDefault && P.LOCATIONS.includes(locDefault)) state.locationFilter = locDefault;
    }
    recompute();
    cacheSnapshot(text, etag);
    render();
  } catch (e) {
    if (!state.loaded) {
      const snap = readSnapshot();
      if (snap) {
        state.model = P.parse(snap.text);
        state.etag = snap.etag;
        state.loaded = true;
        recompute();
      }
    }
    state.offline = true;
    render();
  }
}

let saveTimer = null;
function scheduleSave() {
  state.dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 450);
  render();
}

async function save() {
  if (state.saving) return scheduleSave();
  state.saving = true;
  render();
  P.ensureIds(state.model.items);
  const text = P.serialize(state.model);
  try {
    const r = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, etag: state.etag }),
    });
    if (r.status === 401) {
      state.saving = false;
      return gotoLogin();
    }
    const j = await r.json();
    if (r.status === 412) {
      state.etag = j.etag;
      state.dirty = false;
      state.saving = false;
      toast("reloaded — edited elsewhere");
      await load();
      return;
    }
    if (!r.ok) throw new Error("http " + r.status);
    state.etag = j.etag;
    state.dirty = false;
    state.offline = false;
    cacheSnapshot(text, state.etag);
  } catch (e) {
    state.offline = true; // stay dirty; flush on next poll / reconnect
  } finally {
    state.saving = false;
    render();
  }
}

// one-level undo — snapshot before the mutation, restore on demand
function mutate(fn, undoLabel) {
  const before = P.serialize(state.model);
  fn();
  recompute();
  if (undoLabel) {
    state.undo = { text: before, label: undoLabel };
    clearTimeout(state._undoTimer);
    state._undoTimer = setTimeout(() => {
      state.undo = null;
      render();
    }, 6000);
  }
  scheduleSave();
}

function doUndo() {
  if (!state.undo) return;
  state.model = P.parse(state.undo.text);
  recompute();
  state.undo = null;
  clearTimeout(state._undoTimer);
  scheduleSave();
}

function toast(msg) {
  state.toastMsg = msg;
  clearTimeout(state._toastTimer);
  state._toastTimer = setTimeout(() => {
    state.toastMsg = null;
    render();
  }, 3500);
  render();
}

// ---------- actions ----------

function shortTitle(t) {
  t = String(t || "").trim();
  return t.length > 32 ? t.slice(0, 31) + "…" : t;
}

function complete(it) {
  const label = `done · ${shortTitle(it.title)}`;
  mutate(() => P.toggleDone(state.model, it.id, todayISO()), label);
  state.expanded = null;
}

function reopen(it) {
  mutate(() => P.toggleDone(state.model, it.id, todayISO()), `reopened · ${shortTitle(it.title)}`);
}

function snooze(it, when) {
  const to =
    when === "tomorrow"
      ? tomorrowISO()
      : when === "nextweek"
        ? P.iso(P.nextMonday())
        : when; // already ISO
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
  mutate(() => {
    it.sched = to;
  }, `${shortTitle(it.title)} → ${relDay(to)}`);
  state.expanded = null;
}

// turn "due:friday" / "sched:tomorrow" into ISO tokens before parsing (same as
// the desktop bulk-add)
function normalizeDates(text) {
  return text.replace(/\b(sched|due):(\S+)/g, (m, key, val) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return m;
    const d = P.parseDateInput(val, todayISO());
    return d ? `${key}:${d}` : m;
  });
}

function addTask(raw) {
  let line = String(raw || "").trim();
  line = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").replace(/^\[[ xX]\]\s*/, "");
  if (!line) return;
  line = normalizeDates(line);
  mutate(() => {
    const it = P.parse(`- [ ] ${line}`).items[0];
    if (!it.sched && !it.due && state.view === "today") it.sched = todayISO();
    // inbox / habits → leave undated
    if (!it.projects.length && state.projectFilter) it.projects = [state.projectFilter];
    if (!it.location && state.locationFilter) it.location = state.locationFilter;
    if (!it.created) it.created = todayISO();
    const items = state.model.items;
    const firstDone = items.findIndex((x) => x.done && x.depth === 0);
    items.splice(firstDone < 0 ? items.length : firstDone, 0, it);
    P.ensureIds(items);
  });
  state.adding = false;
  toast("added");
}

// ---------- view model ----------
// firstDate / anyDesc / allProjects / projColor and the view-match logic live in
// model.js now (shared with the desktop app, pure, tested).

const firstDate = M.firstDate;
const anyDesc = M.anyDesc;
const allProjects = () => M.allProjects(state.model);
const projColor = (name) => M.projColor(state.model, name);
const matches = (it, view) => M.viewMatch(it, view, { today: todayISO(), tomorrow: tomorrowISO() });

function rootsFor(view, ignoreFilter) {
  const pf = ignoreFilter ? null : state.projectFilter;
  const lf = ignoreFilter ? null : state.locationFilter;
  const locOK = (x) => x._effLocation === lf; // a real filter — untagged tasks are hidden until you clear it
  return P.buildTrees(state.model.items).filter(
    (r) =>
      !r.done &&
      matches(r, view) &&
      (!pf || anyDesc(r, (x) => x.projects.includes(pf))) &&
      (!lf || anyDesc(r, locOK))
  );
}

function countFor(view) {
  if (view === "habits") return activeHabits().filter((h) => (h._thisWeek || 0) < (h._goal || 0)).length;
  return rootsFor(view, true).length; // tab counts ignore the project filter
}

function relDay(isoStr) {
  if (!isoStr) return "";
  const t = P.parseISO(todayISO());
  const d = P.parseISO(isoStr);
  const n = Math.round((d - t) / 86400000);
  if (n === 0) return "today";
  if (n === 1) return "tmr";
  if (n === -1) return "yest";
  if (n < 0) return `${-n}d late`;
  if (n < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ---------- render ----------

function render() {
  const app = $("#app");
  app.innerHTML = "";

  if (!state.loaded) {
    const b = document.createElement("div");
    b.className = "boot";
    b.textContent = state.offline ? "offline — no cached data yet" : "loading…";
    app.append(b);
    return;
  }

  app.append(topEl());

  const main = document.createElement("main");
  paintList(main);
  app.append(main);

  if (state.view !== "habits") {
    const fab = document.createElement("button");
    fab.className = "fab";
    fab.textContent = "+";
    fab.setAttribute("aria-label", "add task");
    fab.onclick = () => {
      state.adding = true;
      render();
    };
    app.append(fab);
  }

  if (state.undo) app.append(toastEl(state.undo.label, "Undo", doUndo));
  else if (state.toastMsg) app.append(toastEl(state.toastMsg));

  if (state.adding) app.append(addSheetEl());
  if (state.filterOpen) app.append(filterSheetEl());
}

const LOC_LABEL = { home: "🏠 home", work: "🏢 work", transit: "🚌 in transit", out: "🛒 out" };

function filterSheetEl() {
  const isLoc = state.filterOpen === "location";
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.filterOpen = false;
      render();
    }
  };
  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const h = document.createElement("h2");
  h.textContent = isLoc ? "Filter by location" : "Filter by project";
  sheet.append(h);

  const pick = (v) => {
    if (isLoc) state.locationFilter = v;
    else state.projectFilter = v;
    state.filterOpen = false;
    render();
  };

  const cur = isLoc ? state.locationFilter : state.projectFilter;
  const all = document.createElement("button");
  all.className = "projrow" + (cur ? "" : " on");
  all.textContent = isLoc ? "Anywhere" : "All tasks";
  all.onclick = () => pick(null);
  sheet.append(all);

  const opts = isLoc ? P.LOCATIONS : allProjects();
  for (const name of opts) {
    const row = document.createElement("button");
    row.className = "projrow" + (cur === name ? " on" : "");
    if (isLoc) {
      row.textContent = LOC_LABEL[name] || name;
    } else {
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = projColor(name);
      row.append(dot, document.createTextNode(name));
    }
    row.onclick = () => pick(name);
    sheet.append(row);
  }

  wrap.append(sheet);
  return wrap;
}

function topEl() {
  const top = document.createElement("div");
  top.className = "top";

  const tabs = document.createElement("div");
  tabs.className = "tabs";
  for (const [key, label] of VIEWS) {
    const b = document.createElement("button");
    b.className = "tab" + (state.view === key ? " on" : "");
    const n = countFor(key);
    b.innerHTML = `${label}${n ? `<span class="n">${n}</span>` : ""}`;
    b.onclick = () => {
      state.view = key;
      state.expanded = null;
      render();
    };
    tabs.append(b);
  }
  top.append(tabs);

  const status = document.createElement("div");
  status.className = "statusline";
  const sync = document.createElement("span");
  if (state.saving || state.dirty) {
    const d = document.createElement("span");
    d.className = "dotpulse";
    sync.append(d);
    sync.append(document.createTextNode(state.offline ? "waiting to sync" : "saving…"));
  } else if (!state.offline) {
    sync.textContent = "synced";
  }
  status.append(sync);

  if (state.view !== "habits") {
    const controls = document.createElement("span");
    controls.className = "filterctls";

    // project
    if (state.projectFilter) {
      const chip = document.createElement("button");
      chip.className = "filterchip";
      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = projColor(state.projectFilter);
      chip.append(dot, document.createTextNode(state.projectFilter + " ✕"));
      chip.onclick = () => {
        state.projectFilter = null;
        render();
      };
      controls.append(chip);
    } else {
      const b = document.createElement("button");
      b.className = "filterbtn";
      b.textContent = "⚑ project";
      b.onclick = () => {
        state.filterOpen = "project";
        render();
      };
      controls.append(b);
    }

    // location
    if (state.locationFilter) {
      const chip = document.createElement("button");
      chip.className = "filterchip";
      chip.textContent = (LOC_LABEL[state.locationFilter] || state.locationFilter) + " ✕";
      chip.onclick = () => {
        state.locationFilter = null;
        render();
      };
      controls.append(chip);
    } else {
      const b = document.createElement("button");
      b.className = "filterbtn";
      b.textContent = "📍 location";
      b.onclick = () => {
        state.filterOpen = "location";
        render();
      };
      controls.append(b);
    }

    status.append(controls);
  }
  top.append(status);

  if (state.offline) {
    const ban = document.createElement("div");
    ban.className = "banner";
    ban.textContent = state.dirty
      ? "Offline — your change is saved on this phone and will sync when you reconnect."
      : "Offline — showing the last version. Changes won't sync until you reconnect.";
    top.append(ban);
  }

  return top;
}

function paintList(main) {
  const t = todayISO();

  if (state.view === "habits") return paintHabits(main);

  const roots = rootsFor(state.view);

  if (!roots.length) {
    const e = document.createElement("div");
    e.className = "empty";
    const filt = [
      state.projectFilter && `+${state.projectFilter}`,
      state.locationFilter && `@${state.locationFilter}`,
    ].filter(Boolean).join(" · ");
    e.textContent = filt
      ? `Nothing in ${filt} ${state.view === "today" ? "due today" : "here"}.`
      : state.view === "today"
        ? "Nothing due today. 🎉"
        : "Inbox is empty.";
    main.append(e);
    return;
  }

  if (state.view === "today") {
    const overdue = roots.filter((r) => firstDate(r) < t);
    const now = roots.filter((r) => firstDate(r) >= t);
    if (overdue.length && now.length) {
      main.append(sechead(`overdue · ${overdue.length}`));
      overdue.forEach((r) => main.append(cardEl(r)));
      main.append(sechead("today"));
      now.forEach((r) => main.append(cardEl(r)));
    } else {
      roots.forEach((r) => main.append(cardEl(r)));
    }
    return;
  }

  roots.forEach((r) => main.append(cardEl(r)));
}

// ---------- habits ----------

function paintHabits(main) {
  const habits = activeHabits();
  if (!habits.length) {
    const e = document.createElement("div");
    e.className = "empty";
    e.textContent = "No habits. Set them up on the desktop app.";
    main.append(e);
    return;
  }
  for (const h of habits) main.append(habitCardEl(h));
}

function habitCardEl(h) {
  const goal = h._goal || 0;
  const done = h._thisWeek || 0;
  const met = goal > 0 && done >= goal;

  const card = document.createElement("div");
  card.className = "card habit" + (met ? " met" : "");

  const head = document.createElement("div");
  head.className = "hhead";
  const name = document.createElement("span");
  name.className = "hname";
  name.textContent = h.name;
  head.append(name);
  if (h.location) {
    const c = document.createElement("span");
    c.className = "chip loc";
    c.textContent = "@" + h.location;
    head.append(c);
  }
  const count = document.createElement("span");
  count.className = "hcount";
  count.textContent = goal ? `${done} / ${goal}` : `${done}`;
  head.append(count);
  card.append(head);

  if (goal) {
    const bar = document.createElement("div");
    bar.className = "hbar";
    const fill = document.createElement("span");
    fill.style.width = Math.min(100, Math.round((done / goal) * 100)) + "%";
    if (met) fill.classList.add("met");
    bar.append(fill);
    card.append(bar);
  }

  const streak = document.createElement("div");
  streak.className = "hsub";
  streak.textContent = `streak ${h._streak || 0}w · best ${h._best || 0}w`;
  card.append(streak);

  const spark = document.createElement("div");
  spark.className = "hspark";
  for (const wk of h._spark || []) {
    const c = document.createElement("span");
    c.className = "hcell" + (wk.hit ? " hit" : wk.n ? " partial" : "") + (wk.current ? " cur" : "");
    spark.append(c);
  }
  card.append(spark);

  const btn = document.createElement("button");
  btn.className = "hlog";
  btn.textContent = met ? "✓ done this week — log another" : "＋ log a rep";
  btn.onclick = () => logRep(h);
  card.append(btn);

  return card;
}

function logRep(h) {
  const day = todayISO();
  mutate(() => {
    const it = P.parse(`- [x] ${h.name} +${h.name} created:${day} done:${day}`).items[0];
    state.model.items.push(it);
    P.ensureIds(state.model.items);
  }, `logged ${h.name} · ${(h._thisWeek || 0) + 1}/${h._goal || "–"} this week`);
}

function sechead(text) {
  const h = document.createElement("div");
  h.className = "sechead";
  h.textContent = text;
  return h;
}

function cardEl(it) {
  const card = document.createElement("div");
  card.className = "card";

  const row = document.createElement("div");
  row.className = "row";

  const kids = (it.children || []).filter((c) => !c._virtual);
  const openKids = kids.filter((c) => !c.done);

  const check = document.createElement("button");
  check.className = "check";
  check.textContent = "✓";
  check.setAttribute("aria-label", "complete");
  check.onclick = (e) => {
    e.stopPropagation();
    complete(it);
  };
  row.append(check);

  const body = document.createElement("div");
  body.className = "rowbody";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = it.title || "(untitled)";
  body.append(title);

  const meta = document.createElement("div");
  meta.className = "meta";
  const fd = firstDate(it);
  if (fd && (state.view !== "today" || fd < todayISO())) {
    const c = document.createElement("span");
    c.className = "chip" + (fd < todayISO() ? " late" : "");
    c.textContent = relDay(fd);
    meta.append(c);
  }
  for (const p of it.projects) {
    const c = document.createElement("span");
    c.className = "chip proj";
    c.textContent = "+" + p;
    meta.append(c);
  }
  if (it._effLocation) {
    const c = document.createElement("span");
    c.className = "chip loc" + (it.location ? "" : " inherited");
    c.textContent = "@" + it._effLocation;
    meta.append(c);
  }
  if (it.repeat) {
    const c = document.createElement("span");
    c.className = "chip rep";
    c.textContent = "↻";
    meta.append(c);
  }
  if (kids.length) {
    const c = document.createElement("span");
    c.className = "chip sub";
    c.textContent = `${kids.length - openKids.length}/${kids.length}`;
    meta.append(c);
  }
  if (meta.childNodes.length) body.append(meta);
  row.append(body);

  const hasDetail = it.notes.length || it.link || kids.length;
  const caret = document.createElement("div");
  caret.className = "caret";
  caret.textContent = state.expanded === it.id ? "▾" : hasDetail ? "▸" : "⋯";
  row.append(caret);

  row.onclick = () => {
    state.expanded = state.expanded === it.id ? null : it.id;
    render();
  };
  card.append(row);

  if (state.expanded === it.id) card.append(detailEl(it, kids));
  return card;
}

function detailEl(it, kids) {
  const d = document.createElement("div");
  d.className = "detail";

  for (const n of it.notes) {
    const p = document.createElement("div");
    p.className = "note";
    p.textContent = n;
    d.append(p);
  }

  if (it.link) {
    const a = document.createElement("a");
    a.className = "linkbtn";
    a.href = it.link;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "↗ " + it.link.replace(/^https?:\/\//, "");
    d.append(a);
  }

  if (kids.length) {
    const wrap = document.createElement("div");
    wrap.className = "subs";
    for (const c of kids) {
      const srow = document.createElement("div");
      srow.className = "sub";
      const sc = document.createElement("button");
      sc.className = "check" + (c.done ? " done" : "");
      sc.textContent = "✓";
      sc.onclick = (e) => {
        e.stopPropagation();
        c.done ? reopen(c) : complete(c);
      };
      srow.append(sc);
      const st = document.createElement("span");
      st.className = "stitle" + (c.done ? " sdone" : "");
      st.textContent = c.title || "(untitled)";
      srow.append(st);
      wrap.append(srow);
    }
    d.append(wrap);
  }

  const actions = document.createElement("div");
  actions.className = "actions";

  const mk = (label, fn, cls = "") => {
    const b = document.createElement("button");
    b.className = "act " + cls;
    b.textContent = label;
    b.onclick = (e) => {
      e.stopPropagation();
      fn();
    };
    return b;
  };

  actions.append(mk("Tomorrow", () => snooze(it, "tomorrow")));
  actions.append(mk("Next week", () => snooze(it, "nextweek")));

  const pick = document.createElement("label");
  pick.className = "act pick";
  pick.textContent = "Pick day";
  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.min = todayISO();
  dateInput.value = it.sched || it.due || todayISO();
  dateInput.onclick = (e) => e.stopPropagation();
  dateInput.onchange = (e) => {
    e.stopPropagation();
    if (dateInput.value) snooze(it, dateInput.value);
  };
  pick.append(dateInput);
  actions.append(pick);

  d.append(actions);
  return d;
}

function toastEl(msg, actionLabel, actionFn) {
  const t = document.createElement("div");
  t.className = "toast";
  const m = document.createElement("span");
  m.className = "msg";
  m.textContent = msg;
  t.append(m);
  if (actionLabel) {
    const b = document.createElement("button");
    b.className = "undo";
    b.textContent = actionLabel;
    b.onclick = actionFn;
    t.append(b);
  }
  return t;
}

function addSheetEl() {
  const wrap = document.createElement("div");
  wrap.className = "sheet-wrap";
  wrap.onclick = (e) => {
    if (e.target === wrap) {
      state.adding = false;
      render();
    }
  };

  const sheet = document.createElement("div");
  sheet.className = "sheet";
  const h = document.createElement("h2");
  h.textContent = state.view === "today" ? "New task — today" : "New task — inbox";
  sheet.append(h);

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "buy milk +life due:friday";
  input.autocapitalize = "sentences";
  input.enterKeyHint = "done";
  sheet.append(input);

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "inline: +project, due:friday, sched:2026-09-20, pri:A";
  sheet.append(hint);

  const row = document.createElement("div");
  row.className = "row2";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  cancel.onclick = () => {
    state.adding = false;
    render();
  };
  const ok = document.createElement("button");
  ok.className = "primary";
  ok.textContent = "Add";
  ok.onclick = () => addTask(input.value);
  row.append(cancel, ok);
  sheet.append(row);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTask(input.value);
    }
  });

  wrap.append(sheet);
  setTimeout(() => input.focus(), 50);
  return wrap;
}

// ---------- lifecycle ----------

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  if (state.dirty) save();
  else load();
});

window.addEventListener("online", () => {
  if (state.dirty) save();
  else load();
});

setInterval(() => {
  if (!document.hidden) load();
}, 30000);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/mobile-sw.js").catch(() => {});
}

load();
