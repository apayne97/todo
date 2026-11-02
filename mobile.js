// Mobile todo — a small read/complete/snooze/capture front-end over the same
// todos.md + /todos API the desktop app uses. Shares parse.js. Keyboard-free.
import * as P from "./parse.js";
import * as M from "./model.js";
import { el } from "./dom.js";

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
const { inProject, projDepth, leafName } = M;
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
      (!pf || anyDesc(r, (x) => inProject(x, pf))) &&
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
    app.append(el("div", { class: "boot" }, state.offline ? "offline — no cached data yet" : "loading…"));
    return;
  }

  app.append(topEl());
  const main = el("main");
  paintList(main);
  app.append(main);

  if (state.view !== "habits") {
    app.append(
      el(
        "button",
        {
          class: "fab",
          "aria-label": "add task",
          onclick: () => {
            state.adding = true;
            render();
          },
        },
        "+"
      )
    );
  }

  if (state.undo) app.append(toastEl(state.undo.label, "Undo", doUndo));
  else if (state.toastMsg) app.append(toastEl(state.toastMsg));

  if (state.adding) app.append(addSheetEl());
  if (state.filterOpen) app.append(filterSheetEl());
}

const LOC_LABEL = { home: "🏠 home", work: "🏢 work", transit: "🚌 in transit", out: "🛒 out" };

function filterSheetEl() {
  const isLoc = state.filterOpen === "location";
  const pick = (v) => {
    if (isLoc) state.locationFilter = v;
    else state.projectFilter = v;
    state.filterOpen = false;
    render();
  };
  const cur = isLoc ? state.locationFilter : state.projectFilter;
  const opts = isLoc ? P.LOCATIONS : allProjects();

  const wrap = el(
    "div",
    {
      class: "sheet-wrap",
      onclick: (e) => {
        if (e.target === wrap) {
          state.filterOpen = false;
          render();
        }
      },
    },
    el(
      "div",
      { class: "sheet" },
      el("h2", null, isLoc ? "Filter by location" : "Filter by project"),
      el(
        "button",
        { class: "projrow" + (cur ? "" : " on"), onclick: () => pick(null) },
        isLoc ? "Anywhere" : "All tasks",
      ),
      opts.map((name) =>
        el(
          "button",
          { class: "projrow" + (cur === name ? " on" : ""), onclick: () => pick(name) },
          isLoc
            ? LOC_LABEL[name] || name
            : [
                el("span", { class: "dot", style: { background: projColor(name), marginLeft: projDepth(name) * 14 + "px" } }),
                leafName(name),
              ],
        ),
      ),
    ),
  );
  return wrap;
}

function topEl() {
  const syncing = state.saving || state.dirty;
  const sync = el(
    "span",
    null,
    syncing && el("span", { class: "dotpulse" }),
    syncing
      ? state.offline
        ? "waiting to sync"
        : "saving…"
      : !state.offline
        ? "synced"
        : null,
  );

  return el(
    "div",
    { class: "top" },
    el(
      "div",
      { class: "tabs" },
      VIEWS.map(([key, label]) => {
        const n = countFor(key);
        return el("button", {
          class: "tab" + (state.view === key ? " on" : ""),
          html: `${label}${n ? `<span class="n">${n}</span>` : ""}`,
          onclick: () => {
            state.view = key;
            state.expanded = null;
            render();
          },
        });
      }),
    ),
    el(
      "div",
      { class: "statusline" },
      sync,
      state.view !== "habits" &&
        el(
          "span",
          { class: "filterctls" },
          // project
          state.projectFilter
            ? el(
                "button",
                {
                  class: "filterchip",
                  onclick: () => {
                    state.projectFilter = null;
                    render();
                  },
                },
                el("span", { class: "dot", style: { background: projColor(state.projectFilter) } }),
                state.projectFilter + " ✕",
              )
            : el(
                "button",
                {
                  class: "filterbtn",
                  onclick: () => {
                    state.filterOpen = "project";
                    render();
                  },
                },
                "⚑ project",
              ),
          // location
          state.locationFilter
            ? el(
                "button",
                {
                  class: "filterchip",
                  onclick: () => {
                    state.locationFilter = null;
                    render();
                  },
                },
                (LOC_LABEL[state.locationFilter] || state.locationFilter) + " ✕",
              )
            : el(
                "button",
                {
                  class: "filterbtn",
                  onclick: () => {
                    state.filterOpen = "location";
                    render();
                  },
                },
                "📍 location",
              ),
        ),
    ),
    state.offline &&
      el(
        "div",
        { class: "banner" },
        state.dirty
          ? "Offline — your change is saved on this phone and will sync when you reconnect."
          : "Offline — showing the last version. Changes won't sync until you reconnect.",
      ),
  );
}

function paintList(main) {
  const t = todayISO();

  if (state.view === "habits") return paintHabits(main);

  const roots = rootsFor(state.view);

  if (!roots.length) {
    const filt = [
      state.projectFilter && `+${state.projectFilter}`,
      state.locationFilter && `@${state.locationFilter}`,
    ]
      .filter(Boolean)
      .join(" · ");
    main.append(
      el(
        "div",
        { class: "empty" },
        filt
          ? `Nothing in ${filt} ${state.view === "today" ? "due today" : "here"}.`
          : state.view === "today"
            ? "Nothing due today. 🎉"
            : "Inbox is empty."
      )
    );
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
    main.append(el("div", { class: "empty" }, "No habits. Set them up on the desktop app."));
    return;
  }
  for (const h of habits) main.append(habitCardEl(h));
}

function habitCardEl(h) {
  const goal = h._goal || 0;
  const done = h._thisWeek || 0;
  const met = goal > 0 && done >= goal;
  return el(
    "div",
    { class: "card habit" + (met ? " met" : "") },
    el(
      "div",
      { class: "hhead" },
      el("span", { class: "hname" }, h.name),
      h.location && chip("@" + h.location, "loc"),
      el("span", { class: "hcount" }, goal ? `${done} / ${goal}` : `${done}`)
    ),
    goal > 0 &&
      el(
        "div",
        { class: "hbar" },
        el("span", { class: met ? "met" : null, style: { width: Math.min(100, Math.round((done / goal) * 100)) + "%" } })
      ),
    el("div", { class: "hsub" }, `streak ${h._streak || 0}w · best ${h._best || 0}w`),
    el(
      "div",
      { class: "hspark" },
      ...(h._spark || []).map((wk) =>
        el("span", { class: "hcell" + (wk.hit ? " hit" : wk.n ? " partial" : "") + (wk.current ? " cur" : "") })
      )
    ),
    el("button", { class: "hlog", onclick: () => logRep(h) }, met ? "✓ done this week — log another" : "＋ log a rep")
  );
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
  return el("div", { class: "sechead" }, text);
}

const chip = (text, cls) => el("span", { class: "chip " + (cls || "") }, text);

function cardEl(it) {
  const kids = (it.children || []).filter((c) => !c._virtual);
  const openKids = kids.filter((c) => !c.done);
  const fd = firstDate(it);
  const late = fd && fd < todayISO();

  const meta = el(
    "div",
    { class: "meta" },
    fd && (state.view !== "today" || late) && chip(relDay(fd), late ? "late" : ""),
    ...it.projects.map((p) => chip("+" + p, "proj")),
    it._effLocation && chip("@" + it._effLocation, "loc" + (it.location ? "" : " inherited")),
    it.repeat && chip("↻", "rep"),
    kids.length > 0 && chip(`${kids.length - openKids.length}/${kids.length}`, "sub")
  );

  const hasDetail = it.notes.length || it.link || kids.length;

  return el(
    "div",
    { class: "card" },
    el(
      "div",
      {
        class: "row",
        onclick: () => {
          state.expanded = state.expanded === it.id ? null : it.id;
          render();
        },
      },
      el(
        "button",
        {
          class: "check",
          "aria-label": "complete",
          onclick: (e) => {
            e.stopPropagation();
            complete(it);
          },
        },
        "✓"
      ),
      el(
        "div",
        { class: "rowbody" },
        el("div", { class: "title" }, it.title || "(untitled)"),
        meta.childNodes.length ? meta : null
      ),
      el("div", { class: "caret" }, state.expanded === it.id ? "▾" : hasDetail ? "▸" : "⋯")
    ),
    state.expanded === it.id && detailEl(it, kids)
  );
}

function detailEl(it, kids) {
  const act = (label, fn, cls) =>
    el(
      "button",
      {
        class: "act " + (cls || ""),
        onclick: (e) => {
          e.stopPropagation();
          fn();
        },
      },
      label
    );

  const dateInput = el("input", {
    type: "date",
    min: todayISO(),
    value: it.sched || it.due || todayISO(),
    onclick: (e) => e.stopPropagation(),
    onchange: (e) => {
      e.stopPropagation();
      if (dateInput.value) snooze(it, dateInput.value);
    },
  });

  return el(
    "div",
    { class: "detail" },
    ...it.notes.map((n) => el("div", { class: "note" }, n)),
    it.link &&
      el(
        "a",
        { class: "linkbtn", href: it.link, target: "_blank", rel: "noopener" },
        "↗ " + it.link.replace(/^https?:\/\//, "")
      ),
    kids.length > 0 &&
      el(
        "div",
        { class: "subs" },
        ...kids.map((c) =>
          el(
            "div",
            { class: "sub" },
            el(
              "button",
              {
                class: "check" + (c.done ? " done" : ""),
                onclick: (e) => {
                  e.stopPropagation();
                  c.done ? reopen(c) : complete(c);
                },
              },
              "✓"
            ),
            el("span", { class: "stitle" + (c.done ? " sdone" : "") }, c.title || "(untitled)")
          )
        )
      ),
    el(
      "div",
      { class: "actions" },
      act("Tomorrow", () => snooze(it, "tomorrow")),
      act("Next week", () => snooze(it, "nextweek")),
      el("label", { class: "act pick" }, "Pick day", dateInput)
    )
  );
}

function toastEl(msg, actionLabel, actionFn) {
  return el(
    "div",
    { class: "toast" },
    el("span", { class: "msg" }, msg),
    actionLabel && el("button", { class: "undo", onclick: actionFn }, actionLabel)
  );
}

function addSheetEl() {
  const input = el("input", {
    type: "text",
    placeholder: "buy milk +life due:friday",
    autocapitalize: "sentences",
    enterKeyHint: "done",
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addTask(input.value);
      }
    },
  });

  const wrap = el(
    "div",
    {
      class: "sheet-wrap",
      onclick: (e) => {
        if (e.target === wrap) {
          state.adding = false;
          render();
        }
      },
    },
    el(
      "div",
      { class: "sheet" },
      el("h2", null, state.view === "today" ? "New task — today" : "New task — inbox"),
      input,
      el("div", { class: "hint" }, "inline: +project, due:friday, sched:2026-09-20, pri:A"),
      el(
        "div",
        { class: "row2" },
        el(
          "button",
          {
            onclick: () => {
              state.adding = false;
              render();
            },
          },
          "Cancel",
        ),
        el("button", { class: "primary", onclick: () => addTask(input.value) }, "Add"),
      ),
    ),
  );

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
