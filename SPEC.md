# Personal Todo App — Spec

A local, keyboard-driven todo app over a plain-text Markdown ground truth.
Replaces day-to-day use of the Notion "2026 To-Do List".

## Goals

- Runs locally in the browser. No cloud dependency, no account.
- **Ground truth is a Markdown file** that stays readable and portable if the app
  or Claude goes away. Port back to Notion (or anywhere) with a mechanical mapping.
- Easy for Claude to read and update — it's just a file in this repo.
- Keyboard-first editing (org-mode agenda workflow, without Emacs).
- One keystroke to bump a task to next Monday.
- Two dates per task (`sched` + `due`), recurring tasks, dependencies.
- A "look what I got done" view with a graph.

## Architecture

- **Ground truth:** `todos.md` in its **own repo**, `apayne97/todo-data` (private),
  cloned at `~/life/todo-data`. Split out from the app repo 2026-09-08 so the
  autosave churn (dozens of commits/day) stays out of the code history. The
  server points at it via `TODO_FILE` and autosaves *that* repo. Overflow archive
  (later): `todos-archive.md` in the same data repo.
- **App:** single static `index.html` + `app.js` + `app.css`, no build step.
  Mobile is a separate front-end (`mobile.html` + `mobile.js` + `mobile.css`,
  served at `/m`) — see **Mobile** below. Both front-ends share two pure modules:
  `parse.js` (read/serialize `todos.md`, `computeStatus`) and `model.js`
  (view-model helpers — `viewMatch`, `allProjects`, `isReady`, `firstDate`, …).
  Anything DOM-free that both apps need lives in one of those, so it can't drift
  and it's covered by `parse.test.mjs` / `model.test.mjs` (`npm test`). A third
  shared module, `dom.js`, is the `el(tag, attrs, ...kids)` builder both
  front-ends use instead of hand-rolled `createElement` boilerplate (not a
  framework — no reactivity, `render()` still rebuilds the view).
- **Server:** Node script (`server.mjs`, stdlib `http` only, zero deps).
  - `GET /todos` → file contents + ETag (mtime)
  - `PUT /todos` → atomic write (temp file + rename), rejects on stale ETag
  - `GET`/`PUT /config` → `todo.config.json` (UI prefs — key bindings; gitignored)
  - `GET /` desktop app · `GET /m` mobile app
  - `TODO_PASSWORD` (env) → if set, `/todos` and `/config` require a signed cookie
    from `/login`; static assets and `/capture` stay open. Unset → no auth.
  - `POST /capture` → `{ title, url?, due?, note? }`, appends one task tagged
    `+industry-job-application` to the top of the active list. CORS-open (`Access-
    Control-Allow-Origin: *`) so the [job-posting bookmarklet](bookmarklet.js),
    running on whatever site the posting lives on, can call it; it can only ever
    add a well-formed line, never overwrite or delete.
  - auto `git commit` + push of the **data repo** (`dirname(TODO_FILE)`) after
    each successful write (Claude always sees current state)
- **Run:** `npm start`, or a `.claude/launch.json` entry so it's one command.
- **Concurrency:** app re-fetches on window focus + every 10s; stale-ETag PUT
  makes the app reload and replay the pending change. A header chip shows sync
  state — **saving…** (edit in flight) / **synced** (last PUT succeeded) /
  **save failed · retry** (server unreachable — auto-retries every 4s, click to
  retry now). "synced" means saved to the server file; the server's own git
  push runs in the background.
- **Sync with Claude:** Claude edits `~/life/todo-data/todos.md` directly; the
  app picks it up on the next focus/poll.

## File format

### Structure

```markdown
# Todos

<active items — file order is manual priority; views re-sort by date>

## Done
<completed items appended here, `done:` dated; newest at the bottom>

## Projects
<optional `order:` line, then `### name` blocks — see the Projects section>
```

Recurring instances keep their `repeat:` token when completed, which is how the
Done graph tells a recurring completion from a one-off.

### Item line

```
- [ ] <title text> <token> <token> ...
  link: <a URL>                      (optional, one per item — edit with `l`)
      <other indented non-checkbox lines = freeform note, edit with `n`)
  - [ ] <subtask> <token> ...
```

An item (and a project) can carry one `link:` line — a hyperlink, rendered as a
clickable 🔗 chip. It's stored like the note but held separately.

### Tokens

| Token             | Meaning                                                        | Set by      |
|-------------------|---------------------------------------------------------------|-------------|
| `+project`        | Area tag, repeatable                                           | user        |
| `@home` `@work` `@transit` `@out` | Location context — where you'd do it (see **Location**) | user  |
| `sched:YYYY-MM-DD`| Day it surfaces on the list (org `SCHEDULED`)                  | user / bump |
| `due:YYYY-MM-DD`  | Hard deadline (org `DEADLINE`); shown even when unscheduled     | user        |
| `created:YYYY-MM-DD` | Creation date                                              | app         |
| `done:YYYY-MM-DD` | Completion date                                                | app         |
| `archived:YYYY-MM-DD` | Parked — not done, not deleted (see **Archiving tasks**)    | app (`z`)   |
| `repeat:+Nu`      | Recur from the **scheduled** date                              | user        |
| `repeat:.Nu`      | Recur from the **completion** date                             | user        |
| `needs:id[,id…]`  | Blocked until those item ids are done                          | user        |
| `bumps:N`         | Times pushed forward — procrastination counter                 | app         |
| `id:xxxx`         | Stable 4-char base36 id                                        | app         |
| `pri:A\|B\|C`     | Priority, optional                                             | user        |

- `u` (repeat unit) ∈ `d w m y`.
- All dates stored ISO. Input accepts `today`, `tomorrow`, `fri`, `next tue`,
  `+3d` and is normalized to ISO on save.
- Unknown tokens are preserved verbatim (forward-compatible).

### Dependencies

Two mechanisms, matched to the two shapes dependencies take:

1. **Subtasks** — indented `- [ ]` under a parent. Parent is blocked and shows
   `n/m` progress until all children are checked. Children inherit the parent's
   `+project` unless they set their own.
2. **`needs:`** — cross-cutting links between non-nested items. App resolves ids
   to titles for display and warns on dangling refs and cycles.

Blocked items render dimmed with 🔒, are hidden from Today / This Week / Inbox, and
always show in **Blocked**.

**The dependency overlay.** `computeStatus` records both directions —
`it._blockedBy` (what it waits on) and `it._blocking` (what waits on it). A row
with N not-done dependents shows a green **`⛓ N`** chip — the counterpart to 🔒,
i.e. "N tasks are waiting on me." Press **`.`** or **`b`** (or click the chip) for
a two-column overlay centred on the selected task — it's both the viewer and the
editor for dependencies:

- **waiting on** — its `needs:` (✓ done / 🔒 itself blocked / ○ ready), with a
  search field to link an existing task as a blocker and a "＋ new task that
  blocks this" button
- **blocking** — its dependents (▸ = would be ready if this were done), with a
  search field to link an existing task and a "＋ new task that depends on this"

`✕` on any row unlinks it. Number keys walk into an entry (follow the chain),
Backspace walks back, the title selects that task in the list, Esc closes. The
`B` / `D` keys are the shortcut for the two "＋ new" buttons — spawn a blocking /
dependent task straight into title-edit without opening the overlay.

### Recurring — behavior on check-off

1. Current line gets `done:<today>` and moves under `## Done`.
2. A new instance is spawned: fresh `id:`, `bumps:0`, `created:<today>`, dates advanced:
   - `repeat:+Nu` → `sched += N·u`; `due` shifts by the same delta. Roll forward
     in whole steps until `sched ≥ today` (handles finishing late).
   - `repeat:.Nu` → `sched = today + N·u`; `due = new sched + (old due − old sched)`.
3. Instances spawned from a `repeat:` are marked internally so the Done graph can
   filter them.

## Views

| # | View       | Contents                                                              |
|---|------------|----------------------------------------------------------------------|
| 1 | Today      | not done & first date (`sched`/`due`) is today or past, minus blocked — overdue in a section at the top |
| 2 | Tomorrow   | not done & first date is exactly tomorrow, minus blocked              |
| 3 | Upcoming   | first date is after tomorrow — split into **rest of this week / next week / later** |
| 4 | Inbox      | no `sched`, no `due`                                                  |
| 5 | Done       | completed, grouped by day, newest first — plus the graph              |
| 6 | Blocked    | items waiting on a dependency, plus a "ready" and a "problems" section |
| 7 | Habits     | weekly habit goals (progress / streak / best / 8-week sparkline), with a recurring-tasks section below |
| 8 | Projects   | one card per project; click / `↵` opens a full editable task list for it |
| 9 | Shortcuts  | full keyboard reference                                               |
| 0 | Archive    | tasks parked with `z` — still searchable (`/`), `z` restores          |

The date ladder is Today → Tomorrow → Upcoming (no standalone "this week" —
it's the first section of Upcoming). "First date" = the earlier of `sched`/`due`.

Project filter (`P`, or `⌃1`–`⌃9` for the sidebar-numbered projects) and text
search (`/`) layer on top of any view. Dates render relative: "Mon", "in 3d",
"2d overdue" (red).

**Effective dates.** Views filter on an item's *effective* `sched`/`due`, which
for a subtask is floored by its parent's — a checklist item can't be actioned
before the task it's part of. So a subtask dated today under a parent scheduled
for next week stays in Upcoming with its parent, not scattered into Today. The
row still shows its own tokens; only the raw token is preserved on save
(`computeStatus` sets `_effSched` / `_effDue`).

**Today** puts overdue items (`sched` or `due` in the past) in an "overdue"
section above the rest, so a slipping backlog is visible without a separate view.
The schedule chip is hidden on rows dated *exactly* today (it'd be on every row)
but kept when overdue, so "3d over" still shows how far a task has slipped.

**Blocked** groups not-done items into:
- **ready — blockers cleared** — every not-done item whose `needs:` list is now
  fully satisfied. Dated ones also show in Today / Upcoming, but they're worth
  seeing here too — you just cleared their blocker.
- **blocked** — an unfinished `needs:` task in the way. Shown with 🔒 and the
  blocker's title.
- **problems** — `needs:` points at a task that no longer exists, or a dependency
  cycle. Flagged red (`⚠ broken dep` / `⚠ cycle`) here *and* wherever else the
  item shows.

There's no separate "bumped" view — the `⤴N` chip escalates colour instead
(purple → amber at 3 → red at 5).

## Archiving tasks

`z` on a task adds `archived:<today>` to its line. It stays in the active list in
the file (not moved under `## Done`, no `done:` date, so it never counts toward the
Done graph) but `viewMatch` returns false for it in every list view — Today,
Tomorrow, Upcoming, Inbox, Blocked, and both mobile tabs. It shows only in the
**Archive** view (key `0`), where `/` search works as usual; `z` there (or anywhere
it's visible) restores it. Archiving a parent parks its whole subtree
(`computeStatus` sets `_archived`, inherited like `_archivedProject`). Tasks that
`needs:` an archived task stay blocked — archiving is not completing. Completing
an archived task un-parks it.

## Projects

Project descriptions and info live in a `## Projects` section at the end of
`todos.md`:

```markdown
## Projects

order: grant, home, garden

### grant
NIH R01 renewal. First draft to OSP by March 1.
color: #4da6e5
link: https://notion.so/grant-board
location: work
status: drafting
lead: me
```

`### name` starts a project; following lines are the description, except the
special `color:` / `link:` / `location:` lines and `key: value` lines (structured
info). `location:` (one of `home` / `work` / `transit` / `out`) flows onto every
task in the project — see **Location**. A
project exists as soon as a task is tagged `+name` — the `## Projects` entry only
adds description / color / link / info, and entries with none of those are pruned
on save.

An optional `order:` line (comma-separated names, right after `## Projects`) sets
the project ordering — the sidebar, the `⌃1`–`⌃9` mapping, the `P` picker and the
cards all follow it. It's written only once you reorder (`J`/`K` on the Projects
view); the app then lists every project in it, named ones first, the rest
alphabetically, and reorders the `### blocks` to match. Tag-only projects can be
ordered too — they just need a name in the list, not a `### block`. `color:` overrides the name-hashed default and applies everywhere the
project's dot or chip shows; it accepts any CSS color (`#4da6e5`, `rebeccapurple`,
`hsl(...)`).

On the Projects view: **click a card** (or `↵` / `o` on the highlighted one) to
**open** the project. `j`/`k` highlights a card without opening it, then `J`/`K`
reorder it (writes/updates the `order:` line and renumbers `⌃N`), `e` description
(multi-line), `r` rename, `n` info lines, `l` link, `C` color (swatch picker +
native color input), `#` archive; `a` = new project. Clicking the description text edits it. **Rename** rewrites the `### heading`, every `+tag` on
tasks, the active filter and the selection in one step; it refuses a name that
already exists. Creating a new item while a project filter is active tags it with
that project; `P` on any item sets its project (with a "new project" option).

**Archiving a project** (`#` on a selected card) adds an `archived: <date>` line
to its `### block`. An archived project drops out of `allProjects()` — gone from
the sidebar, `⌃1`–`⌃9`, the `P` picker and the mobile filter sheet — and its
**open tasks vanish from every list view** (`viewMatch` returns false when
`it._archivedProject`, set in `computeStatus` for a task whose project tags are
*all* archived; subtasks inherit). They still show in that project's drill-in,
opened from the muted **archived** section at the bottom of the Projects view.
`#` again on an archived project restores it (open tasks reappear). The `### block`
and `+tag` history are always kept.

**Project drill-in** (`state.projectView`, a sub-mode of the Projects view — not
a numbered view): a full editable list of *every* task in that project — buckets
**overdue / today / tomorrow / upcoming / no date**, and a "show done" toggle.
Rows are normal rows: every key edits them in place. `a` adds a task already
tagged with the project. While you're in it:

- `⌃1`–`⌃9` (or a sidebar project) **swaps** which project you're viewing, same layout
- `\` (or `Esc`, or "\ all projects") returns to the card list

**Filtering by project** (from any *non*-drill-in view): `⌃1`–`⌃9` toggles the
list filter to the Nth project — the sidebar shows the number next to each, `\`
clears. `P` opens the same list as a numbered picker. So `⌃N` means "the Nth
project" everywhere; context decides whether that's a drill-in swap or a filter.

## Location

Where you'd do a task: **`@home` `@work` `@transit` `@out`** on the task line.
No tag = no location. A `location:` line on a `### project` block gives every task
in that project a location unless the task overrides with its own `@tag`;
subtasks inherit from their parent. `computeStatus` resolves all this into
`it._effLocation` (own tag → project → inherited); the row shows an `@loc` chip,
dashed when inherited. **Habits** can also carry a `location:` line (shown as a
solid chip).

It's a **filter axis**, separate from the project filter and independent of it:

- **Desktop:** `@` opens a location filter picker; the sidebar has a `location`
  row (`@` anywhere / home / work / transit / out); `\` clears all filters. `L`
  sets the location on the selected **task**, **project** (Projects view) or
  **habit** (Habits view).
- **Mobile:** a `📍 location` button next to `⚑ project`, its own sheet.
- **Tasks** filter strictly: with `@work` active you see only tasks whose
  `_effLocation` is `work` — untagged tasks are hidden until you clear it.
  **Habits** filter leniently: an untagged habit always shows; a located one
  hides unless it matches.
- Applies to the **date + inbox views** and the **Habits view** (not
  Blocked/Done/Projects). Task tab counts stay unfiltered; the Habits count
  follows the filter.
- A task created while a location filter is active inherits that location.
- **Per-machine default:** `TODO_LOCATION=work` (env) seeds the filter on load,
  so the work Mac starts filtered to `@work`, the home Mac to `@home`. Still
  clearable/changeable per session.

## Habits

Weekly habit goals live in a `## Habits` section at the end of `todos.md`:

```markdown
## Habits

### hackerrank
30 min HackerRank / LeetCode
goal: 3/week
best: 6
```

`### name` starts a habit; the following lines are the description, except
`goal: N/week` (the weekly target — bare `goal: N` is also accepted),
`best: N` (the all-time-high streak, maintained by the app), an optional
`location:` (see **Location**), and `archived: <date>`. Unlike projects, a
habit only exists as a `### block` — there's no tag-only form — and it's never
pruned.

A **rep** is any completed item tagged `+<habit name>` with a `done:` date.
Pressing `x` (or `↵`) on a selected habit logs one now — it appends
`- [x] <name> +<name> created:<today> done:<today>` under `## Done`, so reps
show up in the Done view and graph like any other completion. Delete a wrongly
logged rep from the Done view (`x` to un-complete).

Per habit the card shows, for the current ISO week (Monday start):

- **`X / Y this week`** + a progress bar (green once the goal is met).
- **streak** — consecutive weeks the goal was met, walking back from the last
  *completed* week; the in-progress week adds to it only once it's already met.
  A missed completed week resets it to 0.
- **best** — the highest streak ever. Recomputed from `## Done` history and also
  persisted as the `best:` line, so it survives even if old done items are later
  trimmed.
- **8-week sparkline** — one cell per week (oldest → this week); filled green for
  a met week, dim-blue for a partial week, the current week outlined.

Keys on the Habits view (not rebindable): `j`/`k` select · `x` / `↵` log a rep ·
`e` description · `g` goal · `r` rename · `a` new habit.

**Archiving.** `#` on an active habit **archives** it — an `archived: <date>`
line is added, the card drops to a muted **archived** section at the bottom, and
it stops counting toward its goal and toward `/start`'s "behind pace" check. The
`### block`, `best:`, and every logged rep in `## Done` are kept and frozen (no
new `best:` is ever written while archived). On an archived habit: `↵` (or `x`)
**restores** it to active; `#` again **deletes** it for good — the definition
*and* the reps it logged (a `## Done` line whose title and only `+tag` are the
habit name). Archive keeps history; delete removes it.

Below the habit cards, a **recurring tasks** section lists every not-done item
with a `repeat:` token (what the old Recurring view showed), so nothing is lost.

## Done view + graph

- Bar chart: completions per day (last 30d) / per week (last 12w), toggle.
- Current streak (consecutive days with ≥1 completion); this-week vs last-week count.
- Stacked by `+project`.
- Cycle-time callouts for long-lived items (age at completion).
- "Finished despite N bumps" badge.
- **Recurring toggle: All / Only recurring / Only one-off.**
- Rows are selectable — click the ✓ or select + press the toggle-done key to
  **un-complete** an item; it drops back into your active list wherever its
  dates put it (Inbox if it has none).

## Keyboard map

Most keys are **rebindable** — the Shortcuts view (`9`) has an inline editor
(click a key to drop it, `＋` to add one, "Reset all to defaults"). Overrides are
stored **server-side** in `todo.config.json` (`GET`/`PUT /config`), so a rebind
follows you to every browser — regular Chrome, the installed app, the phone.
`localStorage` is only a same-session cache so startup doesn't flash the defaults;
only entries that differ from the defaults are persisted. `ACTIONS` is the
registry (name → label + `run`); `DEFAULT_BINDINGS` is action → keys. The keydown
handler dispatches via a key→action lookup, so the same override reaches the list,
the project pickers and the overlays. The `?` overlay and Shortcuts view render
from the live bindings.

Defaults:

**Navigate:** `j` up · `k` down · `G` bottom · `/` search · `P` project-filter
picker · `⌃1`–`⌃9` Nth project (swap drill-in / toggle filter) · `\` leave
drill-in / clear filters · `?` help overlay

**Selected item:** `x` toggle done · `T` → today · `t` → tomorrow ·
`w` → next Monday (`bumps++`) · `s` sched · `d` due · `r` repeat ·
`S` copy this item's dates onto all its subtasks · `.` or `b` dependency overlay ·
`p` set project · `e`/`Enter` edit title · `E` edit whole line · `n` note ·
`l` link · `J` reorder up · `K` reorder down · `#` delete · `u` undo

**Nudge schedule** (relative to the item's current `sched`, or today if unset;
no `bumps++`): `]` / `[` ±1 day · `}` / `{` ±1 week · `)` / `(` ±1 month. The
selection sticks to the task through repeat presses even after it leaves the view
(watch the toast); a burst shares one undo step.

**Create:** `a` add here — inline, after the selection. Date context: Today →
`sched:today`, Tomorrow → `sched:tomorrow`, **Upcoming → the date of the section
you're in** (copied off the sibling you're next to; falls back to end of this
week), project drill-in → tagged with the project, Inbox → dateless · `A` **bulk
add** — a paste box, one task per line; each line is treated exactly like `a`
(same insertion point, date context, project), with list prefixes (`-`, `*`,
`1.`, `[ ]`) stripped and any tokens in the line (`+proj`, `due:…`, `pri:A`)
honored · `c` quick-capture (modal, works from any view, parses `+project` /
`due:…` as you type) · `B` new task that blocks the
selected one · `D` new task that depends on it · `F` follow-up: a dependent
"follow up on <title>" task (leading "follow up on/with" stripped so chains don't
stack), same project, `sched` +3 days — blocked until you've done the original, so
it surfaces only once you've actually reached out. `F` doesn't open it for
editing; after a brief beat the selection snaps back to the original task so you
can `x` it right away.

**Not rebindable:** `1`–`9` switch view · `⌃1`–`⌃9` Nth project · `g g` top ·
`Tab`/`Shift-Tab` indent · `Esc` and `\` (leave drill-in → clear filters →
deselect) · Projects view `↵`/`o`/click open, `j`/`k` then `J`/`K` reorder or
`e`/`n`/`l`/`C`/`r` edit or `a` new

**Pickers:** the project-filter (`P`) and set-project (`p`) pickers are numbered —
the letter then a digit jumps straight to that entry (filter: `1` = first
project, "All (clear)" is last; set-project: `1` = no project). The nav keys move
the highlight. Filterable pickers (blockers) take type-to-filter instead.

## Ordering & reorder

List views sort by date (earliest of `sched`/`due`), and `Array.sort` is stable,
so within a date your file order is the order shown. `J`/`K` (reorder up/down)
move the selected item's subtree past its nearest sibling that is both visible in the
current view *and* sorts to the same slot (same date) — so it nudges the list
you're actually looking at, and no-ops across a date boundary. Reorder skips
`computeStatus` and only repaints the list (`renderMain`), and a burst of moves
collapses into one undo step (`mutate(fn, { coalesce, reorderOnly })`).

## Selection

`mutate()` records the selected row's list index before the change; if that row
leaves the view afterwards (bump, done, delete, reschedule, project change…) the
selection moves to the row that took its slot — the next one down — falling back
to the new last row if it was the last, and clearing only when the list is now
empty. Keeps you working straight down without scrolling back.

On the **date-driven views** (Today, Tomorrow, Upcoming — `DATE_VIEWS`) the same
"hold the slot" rule also applies when a date edit only *shuffles* the row within
the view instead of removing it — e.g. `T` on an overdue Today item drops it into
the "today" section further down. The cursor stays where you were so you can keep
`T`-ing straight down the overdue list. Repeat-press actions that opt out with
`keepSel` (the `]`/`[` nudges) are unaffected — they still ride the item.

## Undo

In-memory stack of the last ~50 mutations, each storing the prior raw line(s).
`u` restores. Toast with an undo affordance after bump/delete.

## Migration (later, optional)

Notion "2026 To-Do List" fields map to tokens:

| Notion            | todos.md                    |
|-------------------|-----------------------------|
| Name              | title                       |
| Project           | `+project`                  |
| Date              | `due:`                      |
| Status            | `- [ ]` / `- [x]`           |
| Priority          | `pri:`                      |
| Blocked by        | `needs:`                    |
| Do This Week / Today | computed from `sched`    |

## Demo mode

`?demo` (or `#demo`) loads `tutorial.md` instead of `todos.md`, read-only —
`scheduleSave` and `pollDisk` no-op, a "DEMO · changes aren't saved" chip shows in
the header, and the Shortcuts view links into it. `tutorial.md` is a self-guided
example file: each task's title explains the feature it demonstrates (overdue
section, bump-chip colours, both recurrence kinds, subtask progress, a blocking
chain, a "ready" item, a broken ref, a cycle, notes, links) and the Done section
is dated across recent days to populate the graph.

Its dates never drift: a `<!-- demo-today: YYYY-MM-DD -->` marker on the file's
first line pins what `todayISO()` returns while `state.demo` is set, so every
overdue/today/upcoming/streak calculation is anchored to that date instead of
the real one — the example looks the same (one overdue task, etc.) no matter
when it's opened. **Editing `tutorial.md`'s dates? Update this marker to
match** — it's the file's own "as-of" date, not a separate constant to hunt
down. The header clock shows that frozen date instead of the wall clock while
in demo, as a hint of why things look overdue relative to it.

## Mobile (`/m`)

A separate, deliberately small touch front-end — `mobile.html` / `mobile.js` /
`mobile.css`, served at `/m`, its own `mobile.webmanifest` (`start_url: /m`,
standalone). Shares `parse.js` and the `/todos` API with the desktop app; the
desktop app is untouched.

**Scope.** Three tabs — **Today / Habits / Inbox** (counts in the tab; the Habits
count is habits *behind* their weekly goal).

Today / Inbox rows:

- Tap the circle → complete. Recurring rolls forward via the same `toggleDone`.
  A 6-second **Undo** toast (one level, snapshot-based).
- Tap the row → expand: notes, a link button, checkable subtasks (parent shows an
  `n/m` pill), and a snooze row — **Tomorrow**, **Next week** (`nextMonday`),
  **Pick day** (native `<input type=date>`).
- **+** (FAB, hidden on the Habits tab) → one text field, run through `parse` +
  `parseDateInput` exactly like desktop `a` (`buy milk +life due:friday`). Today
  tab → dated today, Inbox → undated. A task added while a project filter is
  active is tagged with that project.

Today splits **overdue** above **today** when both exist. Views filter on
effective dates (a subtask stays with its parent). Blocked items are hidden.

**Filters** — two independent controls in the top bar: `⚑ project` and
`📍 location`, each opening its own sheet. Picking one filters Today and Inbox
(`anyDesc` on `+tag` for project; strict `_effLocation === filter` for location —
untagged tasks are hidden); an active-filter chip with `✕` replaces the button.
Tab counts stay unfiltered. The Habits tab ignores both. Location seeds from the
server's `TODO_LOCATION`.
`projColor` / `allProjects` are ported into `mobile.js`.

**Habits tab** — one card per non-archived habit: `X / Y this week` + bar, current
streak / best, an 8-week sparkline, and a big **log a rep** button (appends
`- [x] <name> +<name> done:<today>`, with Undo). A met week turns the card green
and the button to "done this week — log another". No creating / editing /
archiving on mobile — that's desktop. Reuses `computeHabitStats`.

**Not on mobile:** an Upcoming list (dropped for Habits — snooze + Today cover
it; not coming back), dependencies, habit setup, bulk add, reordering, date
editing beyond snooze, the Done graph, keyboard shortcuts. (Later: swipe `[`/`]`
for snooze — deferred, it fights vertical scroll + the iOS edge gesture.)

**Offline.** The last `/todos` response is kept in `localStorage` and rendered on
a cold open before the network answers (or when it doesn't). A persistent banner
shows the offline state; a pending edit stays queued (the row stays `dirty`) and
flushes on the next successful poll / `online` event. `mobile-sw.js` precaches
the app shell for a fully offline cold start — but a service worker only
registers in a **secure context** (`https://` or `localhost`), so over plain
`http://<host>:4444` it silently no-ops and the shell needs the server reachable
to load. `tailscale serve` (auto HTTPS for the `*.ts.net` name) unlocks it.
`/todos` is never SW-cached regardless.

**Auth.** On a `401` from `/todos` the app redirects to `/login?next=/m`; after
sign-in the year-long cookie carries it. See the server's `TODO_PASSWORD` gate.

## Out of scope (v1)

Multi-user/sync · time-of-day scheduling · rich-text notes · editing dependencies
or projects from mobile.
