// Pure view-model helpers shared by the desktop (app.js) and mobile (mobile.js)
// front-ends. No DOM, no module-level state — everything takes what it needs as
// an argument, so it also runs under node for model.test.mjs. Anything here used
// to live (and drift) in both front-ends.

// ---------- trees ----------

// does `it` or any descendant satisfy `pred`?
export function anyDesc(it, pred) {
  return pred(it) || (it.children || []).some((c) => anyDesc(c, pred));
}

// ---------- projects ----------

// deterministic colour from a name (dark-theme tuned)
export function autoColor(name) {
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${h} 50% 58%)`;
}

export function projectEntry(model, name) {
  return (model.projects || []).find((p) => p.name === name) || null;
}

export function projColor(model, name) {
  return projectEntry(model, name)?.color || autoColor(name);
}

// Active (non-archived) project names in display order: the explicit `order:`
// list first, then the rest alphabetically. Habit names and archived projects
// are excluded — this drives the sidebar / ⌃N / pickers / filter sheets.
export function allProjects(model) {
  const s = new Set();
  for (const it of model.items) for (const p of it.projects) s.add(p);
  for (const p of model.projects || []) s.add(p.name);
  for (const h of model.habits || []) s.delete(h.name);
  for (const p of model.projects || []) if (p.archived) s.delete(p.name);
  const ord = model.projectOrder || [];
  const pos = (n) => {
    const i = ord.indexOf(n);
    return i < 0 ? 1e6 : i;
  };
  return [...s].sort((a, b) => pos(a) - pos(b) || a.localeCompare(b));
}

// ---------- task predicates ----------

// earliest date that puts a task on the ladder — effective (parent-floored) first
export function firstDate(it) {
  const s = it._effSched ?? it.sched;
  const d = it._effDue ?? it.due;
  return [s, d].filter(Boolean).sort()[0] || null;
}

// sort key for a list view: first date, else far future (keeps file order within a day)
export function sortKey(it) {
  return firstDate(it) || "9999-99-99";
}

// blockers all satisfied but it still carries a needs: — was gated, now free
export function isReady(it) {
  return (
    !it.done &&
    it.needs.length > 0 &&
    it._blockedBy.length === 0 &&
    !it._cycle &&
    it._dangling.length === 0
  );
}

export function isOverdue(it, today) {
  const s = it._effSched ?? it.sched;
  const d = it._effDue ?? it.due;
  return !it.done && Boolean((s && s < today) || (d && d < today));
}

// Does `it` belong in `view`? `ctx` = { today, tomorrow }. Pure — the same
// function backs the desktop views and the two mobile tabs (today / inbox).
export function viewMatch(it, view, ctx) {
  if (view === "done") return it.done;
  if (it.done) return false;
  if (view === "archive") return it._archived; // parked tasks live only here
  if (it._archived) return false;
  if (it._archivedProject) return false; // only its project drill-in shows it
  const s = it._effSched ?? it.sched;
  const d = it._effDue ?? it.due;
  const fd = [s, d].filter(Boolean).sort()[0] || null;
  if (view === "today") return !it.isBlocked && !!fd && fd <= ctx.today;
  if (view === "tomorrow") return !it.isBlocked && fd === ctx.tomorrow;
  if (view === "upcoming") return !!fd && fd > ctx.tomorrow;
  if (view === "inbox") return !s && !d && !it.isBlocked;
  if (view === "blocked") {
    if (it.isBlocked || it._dangling.length > 0) return true;
    return isReady(it); // dated ready items show here too — you just cleared the blocker
  }
  return false;
}
