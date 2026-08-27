import test from "node:test";
import assert from "node:assert/strict";
import * as P from "./parse.js";

test("round-trips a file without losing data", () => {
  const src = [
    "# Todos",
    "",
    "- [ ] Finish grant figure +grant sched:2026-08-31 due:2026-09-02 id:k3f9",
    "- [ ] Parent task +proj id:p001",
    "  - [ ] child one id:c1",
    "  - [x] child two done:2026-08-20 id:c2",
    "- [ ] Weird one weirdtoken:xyz id:w1",
    "",
    "## Done",
    "",
    "- [x] shipped it +proj done:2026-08-24 id:d1",
    "",
  ].join("\n");
  const model = P.parse(src);
  assert.equal(model.items.length, 6);
  const again = P.parse(P.serialize(model));
  assert.equal(again.items.length, 6);
  assert.equal(again.items[0].sched, "2026-08-31");
  assert.equal(again.items[0].due, "2026-09-02");
  assert.deepEqual(again.items[4].extra, ["weirdtoken:xyz"]);
  assert.equal(again.items[2].depth, 1);
});

test("nextMonday semantics", () => {
  assert.equal(P.iso(P.nextMonday(new Date(2026, 7, 24))), "2026-08-31"); // Mon -> +7
  assert.equal(P.iso(P.nextMonday(new Date(2026, 7, 25))), "2026-08-31"); // Tue -> next Mon
  assert.equal(P.iso(P.nextMonday(new Date(2026, 7, 29))), "2026-08-31"); // Sat -> next Mon
  assert.equal(P.iso(P.nextMonday(new Date(2026, 7, 30))), "2026-08-31"); // Sun -> tomorrow
});

test("parseDateInput", () => {
  const base = "2026-08-26"; // Wednesday
  assert.equal(P.parseDateInput("today", base), "2026-08-26");
  assert.equal(P.parseDateInput("tomorrow", base), "2026-08-27");
  assert.equal(P.parseDateInput("+3d", base), "2026-08-29");
  assert.equal(P.parseDateInput("fri", base), "2026-08-28");
  assert.equal(P.parseDateInput("wed", base), "2026-09-02"); // not today
  assert.equal(P.parseDateInput("next mon", base), "2026-09-07");
  assert.equal(P.parseDateInput("2026-12-01", base), "2026-12-01");
});

test("recurring from schedule advances and keeps due offset", () => {
  const model = P.parse(
    "# Todos\n\n- [ ] report +lab repeat:+1w sched:2026-08-24 due:2026-08-26 id:r1\n\n## Done\n"
  );
  P.toggleDone(model, "r1", "2026-08-26");
  const active = model.items.filter((i) => !i.done);
  assert.equal(active.length, 1);
  assert.equal(active[0].sched, "2026-08-31");
  assert.equal(active[0].due, "2026-09-02");
  assert.equal(active[0].bumps, 0);
  assert.equal(active[0].created, "2026-08-26");
  assert.equal(model.items.find((i) => i.id === "r1").done, true);
});

test("recurring from completion counts off today", () => {
  const model = P.parse("# Todos\n\n- [ ] water +home repeat:.3d sched:2026-08-20 id:h1\n\n## Done\n");
  P.toggleDone(model, "h1", "2026-08-26");
  const active = model.items.filter((i) => !i.done);
  assert.equal(active[0].sched, "2026-08-29");
});

test("needs: makes an item blocked until its blocker is done", () => {
  const model = P.parse(
    "# Todos\n\n- [ ] blocker id:b1\n- [ ] dependent needs:b1 id:d2\n\n## Done\n"
  );
  P.computeStatus(model, "2026-08-26");
  const b1 = model.items.find((i) => i.id === "b1");
  const d2 = model.items.find((i) => i.id === "d2");
  assert.equal(d2.isBlocked, true);
  assert.deepEqual(d2._blockedBy.map((x) => x.id), ["b1"]);
  assert.deepEqual(b1._blocking.map((x) => x.id), ["d2"]); // reverse edge
  P.toggleDone(model, "b1", "2026-08-26");
  P.computeStatus(model, "2026-08-26");
  assert.equal(model.items.find((i) => i.id === "d2").isBlocked, false);
});

test("round-trips a Projects section", () => {
  const src = [
    "# Todos",
    "",
    "- [ ] do a thing +grant id:t1",
    "",
    "## Done",
    "",
    "## Projects",
    "",
    "### grant",
    "NIH R01 renewal.",
    "First draft to OSP by March 1.",
    "status: drafting",
    "lead: me",
    "",
    "### home",
    "Apartment and errands.",
    "",
  ].join("\n");
  const model = P.parse(src);
  assert.equal(model.projects.length, 2);
  assert.equal(model.projects[0].name, "grant");
  assert.equal(model.projects[0].desc, "NIH R01 renewal.\nFirst draft to OSP by March 1.");
  assert.deepEqual(model.projects[0].meta, [["status", "drafting"], ["lead", "me"]]);
  const out = P.serialize(model);
  assert.match(out, /## Projects/);
  const again = P.parse(out);
  assert.deepEqual(again.projects, model.projects);
  assert.equal(again.items.length, 1);
});

test("empty project entries are pruned on serialize", () => {
  const model = P.parse("# Todos\n\n- [ ] x id:a1\n\n## Done\n");
  model.projects.push({ name: "ghost", desc: "", meta: [], link: "", color: "" });
  assert.doesNotMatch(P.serialize(model), /ghost/);
});

test("project color round-trips and survives with nothing else", () => {
  const src = "# Todos\n\n- [ ] t +grant id:a1\n\n## Done\n\n## Projects\n\n### grant\ncolor: #e5484d\nlead: me\n";
  const model = P.parse(src);
  assert.equal(model.projects[0].color, "#e5484d");
  assert.deepEqual(model.projects[0].meta, [["lead", "me"]]);
  const again = P.parse(P.serialize(model));
  assert.equal(again.projects[0].color, "#e5484d");

  const colorOnly = P.parse("# Todos\n\n- [ ] t +p id:a1\n\n## Done\n");
  colorOnly.projects.push({ name: "p", desc: "", meta: [], link: "", color: "#4da6e5" });
  assert.match(P.serialize(colorOnly), /### p\ncolor: #4da6e5/);
});

test("link: lines round-trip on items and projects", () => {
  const src = [
    "# Todos",
    "",
    "- [ ] apply to the job +hunt id:j1",
    "  link: https://careers.example.com/req/123",
    "  ping the recruiter first",
    "",
    "## Done",
    "",
    "## Projects",
    "",
    "### hunt",
    "The job search.",
    "link: https://notion.so/hunt-board",
    "status: active",
    "",
  ].join("\n");
  const model = P.parse(src);
  assert.equal(model.items[0].link, "https://careers.example.com/req/123");
  assert.deepEqual(model.items[0].notes, ["ping the recruiter first"]);
  assert.equal(model.projects[0].link, "https://notion.so/hunt-board");
  assert.deepEqual(model.projects[0].meta, [["status", "active"]]);
  const again = P.parse(P.serialize(model));
  assert.equal(again.items[0].link, "https://careers.example.com/req/123");
  assert.deepEqual(again.items[0].notes, ["ping the recruiter first"]);
  assert.equal(again.projects[0].link, "https://notion.so/hunt-board");
});

test("a project with only a link still serializes", () => {
  const model = P.parse("# Todos\n\n- [ ] x +proj id:a1\n\n## Done\n");
  model.projects.push({ name: "proj", desc: "", meta: [], link: "https://x.com" });
  const out = P.serialize(model);
  assert.match(out, /### proj/);
  assert.match(out, /link: https:\/\/x\.com/);
});

test("parent completes when all children are checked", () => {
  const model = P.parse(
    "# Todos\n\n- [ ] parent id:p1\n  - [ ] a id:a1\n  - [ ] b id:b2\n\n## Done\n"
  );
  P.toggleDone(model, "a1", "2026-08-26");
  assert.equal(model.items.find((i) => i.id === "p1").done, false);
  P.toggleDone(model, "b2", "2026-08-26");
  assert.equal(model.items.find((i) => i.id === "p1").done, true);
});
