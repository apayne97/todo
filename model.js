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

// "lab-work/openff-espaloma" is a subproject of "lab-work": the path is the tag.
export function parentOf(name) {
  const i = String(name).lastIndexOf("/");
  return i < 0 ? null : name.slice(0, i);
}

export function projDepth(name) {
  return String(name).split("/").length - 1;
}

// "lab-work/openff-espaloma" -> "openff-espaloma" (what the indented rows show)
export function leafName(name) {
  return String(name).slice(String(name).lastIndexOf("/") + 1);
}

// "a/b/c" -> ["a", "a/b", "a/b/c"]
export function chain(name) {
  const parts = String(name).split("/");
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

// is `name` this project or one of its descendants?
export function isWithin(name, project) {
  return name === project || name.startsWith(project + "/");
}

// does the task belong to `project`, directly or through a subproject?
export function inProject(it, project) {
  return it.projects.some((p) => isWithin(p, project));
}

// own colour, else the nearest ancestor's, else auto from the name
export function projColor(model, name) {
  for (const n of chain(name).reverse()) {
    const c = projectEntry(model, n)?.color;
    if (c) return c;
  }
  return autoColor(chain(name)[0]);
}

// Active (non-archived) project names in display order, as a tree flattened
// parent-first: siblings follow the explicit `order:` list, then alphabetical.
// A subproject implies its ancestors exist. Habit names are excluded, and so is
// anything archived or under an archived ancestor — this drives the sidebar /
// ⌃N / pickers / filter sheets.
export function allProjects(model) {
  const s = new Set();
  for (const it of model.items) for (const p of it.projects) for (const n of chain(p)) s.add(n);
  for (const p of model.projects || []) for (const n of chain(p.name)) s.add(n);
  for (const h of model.habits || []) s.delete(h.name);
  const archived = (model.projects || []).filter((p) => p.archived).map((p) => p.name);
  for (const n of [...s]) if (archived.some((a) => isWithin(n, a))) s.delete(n);
  const ord = model.projectOrder || [];
  const pos = (n) => {
    const i = ord.indexOf(n);
    return i < 0 ? 1e6 : i;
  };
  const cmp = (a, b) => {
    const ca = chain(a);
    const cb = chain(b);
    for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
      if (ca[i] !== cb[i]) return pos(ca[i]) - pos(cb[i]) || ca[i].localeCompare(cb[i]);
    }
    return ca.length - cb.length;
  };
  return [...s].sort(cmp);
}

// The flat order after moving `name` one place among its siblings (subprojects
// travel with their parent). null if it can't move that way.
export function movedProjectOrder(model, name, dir) {
  const flat = allProjects(model);
  const sibs = flat.filter((n) => parentOf(n) === parentOf(name));
  const i = sibs.indexOf(name);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sibs.length) return null;
  [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
  const out = [];
  const walk = (parent) => {
    const kids = parent === parentOf(name) ? sibs : flat.filter((x) => parentOf(x) === parent);
    for (const n of kids) {
      out.push(n);
      walk(n);
    }
  };
  walk(null);
  return out;
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
