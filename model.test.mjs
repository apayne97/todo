import test from "node:test";
import assert from "node:assert/strict";
import * as P from "./parse.js";
import * as M from "./model.js";

// build a computed model from markdown
function model(md, today = "2026-09-10") {
  const m = P.parse(md);
  P.computeStatus(m, today);
  return m;
}
const byId = (m, id) => m.items.find((i) => i.id === id);

test("anyDesc walks the subtree", () => {
  const m = model("# Todos\n\n- [ ] p id:p1\n  - [ ] c id:c1\n\n## Done\n");
  P.buildTrees(m.items);
  const p = byId(m, "p1");
  assert.equal(M.anyDesc(p, (x) => x.id === "c1"), true);
  assert.equal(M.anyDesc(p, (x) => x.id === "zz"), false);
});

test("autoColor is deterministic and hsl", () => {
  assert.equal(M.autoColor("grant"), M.autoColor("grant"));
  assert.match(M.autoColor("grant"), /^hsl\(\d+ 50% 58%\)$/);
});

test("allProjects: order, habit + archived exclusion", () => {
  const md = [
    "# Todos",
    "",
    "- [ ] a +zeta +alpha id:a1",
    "- [ ] b +hackerrank id:b1", // habit-tag rep, not a project
    "- [ ] c +old id:c1",
    "",
    "## Done",
    "",
    "## Habits",
    "",
    "### hackerrank",
    "goal: 3/week",
    "",
    "## Projects",
    "",
    "order: alpha, zeta",
    "",
    "### old",
    "archived: 2026-09-01",
    "",
  ].join("\n");
  assert.deepEqual(M.allProjects(P.parse(md)), ["alpha", "zeta"]);
});

test("firstDate / sortKey use effective dates", () => {
  const m = model(
    "# Todos\n\n- [ ] parent sched:2026-10-01 id:p1\n  - [ ] child sched:2026-09-01 id:c1\n\n## Done\n"
  );
  assert.equal(M.firstDate(byId(m, "c1")), "2026-10-01"); // floored to the parent
  assert.equal(M.sortKey(byId(m, "p1")), "2026-10-01");
  assert.equal(M.sortKey(model("# Todos\n\n- [ ] x id:x1\n\n## Done\n").items[0]), "9999-99-99");
});

test("isReady: needs cleared, still carries needs:", () => {
  const m = model(
    "# Todos\n\n- [x] blocker id:b1\n- [ ] gated needs:b1 id:g1\n- [ ] plain id:p1\n\n## Done\n"
  );
  assert.equal(M.isReady(byId(m, "g1")), true);
  assert.equal(M.isReady(byId(m, "p1")), false); // no needs:
});

test("isOverdue keys off effective dates and today", () => {
  const m = model("# Todos\n\n- [ ] a sched:2026-09-09 id:a1\n- [ ] b sched:2026-09-11 id:b1\n\n## Done\n");
  assert.equal(M.isOverdue(byId(m, "a1"), "2026-09-10"), true);
  assert.equal(M.isOverdue(byId(m, "b1"), "2026-09-10"), false);
});

test("viewMatch: the date ladder", () => {
  const ctx = { today: "2026-09-10", tomorrow: "2026-09-11" };
  const m = model(
    [
      "# Todos",
      "- [ ] over sched:2026-09-08 id:o1",
      "- [ ] today sched:2026-09-10 id:t1",
      "- [ ] tom sched:2026-09-11 id:m1",
      "- [ ] later sched:2026-09-20 id:l1",
      "- [ ] undated id:u1",
      "- [ ] done sched:2026-09-10 id:d1",
      "",
      "## Done",
      "- [x] done2 sched:2026-09-10 created:2026-09-01 done:2026-09-09 id:d1",
    ].join("\n")
  );
  const mk = (id, v) => M.viewMatch(byId(m, id), v, ctx);
  assert.equal(mk("o1", "today"), true);
  assert.equal(mk("t1", "today"), true);
  assert.equal(mk("m1", "today"), false);
  assert.equal(mk("m1", "tomorrow"), true);
  assert.equal(mk("l1", "upcoming"), true);
  assert.equal(mk("t1", "upcoming"), false);
  assert.equal(mk("u1", "inbox"), true);
  assert.equal(mk("t1", "inbox"), false);
});

test("viewMatch: blocked view shows dated ready items; archived-project tasks vanish", () => {
  const ctx = { today: "2026-09-10", tomorrow: "2026-09-11" };
  const m = model(
    [
      "# Todos",
      "- [x] blk id:x1",
      "- [ ] readyDated needs:x1 sched:2026-09-10 id:r1",
      "- [ ] stillBlocked needs:r1 id:s1",
      "- [ ] arch +oa sched:2026-09-10 id:a1",
      "",
      "## Done",
      "",
      "## Projects",
      "",
      "### oa",
      "archived: 2026-09-01",
      "",
    ].join("\n")
  );
  assert.equal(M.viewMatch(byId(m, "r1"), "blocked", ctx), true); // dated, but ready — shows here
  assert.equal(M.viewMatch(byId(m, "s1"), "blocked", ctx), true);
  assert.equal(M.viewMatch(byId(m, "a1"), "today", ctx), false); // archived project — hidden
  assert.equal(M.viewMatch(byId(m, "a1"), "blocked", ctx), false);
});

test("archived tasks: round-trip, leave list views, appear only in archive (subtree too)", () => {
  const md = [
    "# Todos",
    "",
    "- [ ] parked sched:2026-09-10 archived:2026-09-01 id:a1",
    "  - [ ] child sched:2026-09-10 id:a2",
    "",
    "- [ ] live sched:2026-09-10 id:b1",
    "",
    "## Done",
    "",
  ].join("\n");
  const m = model(md);
  const ctx = { today: "2026-09-10", tomorrow: "2026-09-11" };
  assert.equal(P.serialize(m), md);
  assert.equal(byId(m, "a1").archived, "2026-09-01");
  for (const id of ["a1", "a2"]) {
    assert.equal(M.viewMatch(byId(m, id), "today", ctx), false);
    assert.equal(M.viewMatch(byId(m, id), "archive", ctx), true);
  }
  assert.equal(M.viewMatch(byId(m, "b1"), "today", ctx), true);
  assert.equal(M.viewMatch(byId(m, "b1"), "archive", ctx), false);
});
