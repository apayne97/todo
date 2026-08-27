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

- **Ground truth:** `todos.md` in this repo (`~/life/todo`). Overflow archive (later): `todos-archive.md`.
- **App:** single static `index.html` + `app.js` + `app.css`, no build step.
- **Server:** ~30-line Node script (`server.mjs`, stdlib `http` only, zero deps).
  - `GET /todos` → file contents + ETag (mtime)
  - `PUT /todos` → atomic write (temp file + rename), rejects on stale ETag
  - auto `git commit` after each successful write (clean history; Claude always
    sees current state)
- **Run:** `npm start`, or a `.claude/launch.json` entry so it's one command.
- **Concurrency:** app re-fetches on window focus + every 10s; stale-ETag PUT
  makes the app reload and replay the pending change.
- **Sync with Claude:** Claude edits `todos.md` directly; the app picks it up on
  the next focus/poll.

## File format

### Structure

```markdown
# Todos

<active items — file order is manual priority; views re-sort by date>

## Done
<completed items appended here, `done:` dated; newest at the bottom>
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
| `sched:YYYY-MM-DD`| Day it surfaces on the list (org `SCHEDULED`)                  | user / bump |
| `due:YYYY-MM-DD`  | Hard deadline (org `DEADLINE`); shown even when unscheduled     | user        |
| `created:YYYY-MM-DD` | Creation date                                              | app         |
| `done:YYYY-MM-DD` | Completion date                                                | app         |
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

**Managing blockers** — press `b` on an item to open a picker: type to filter the
list of open tasks, Enter/click toggles one on or off as a blocker (✓), no ids to
remember. Two entries at the top spin up a *new* task and wire the link — same as
the standalone `B` / `D` keys: **blocks this** (`B`, inserted before, this item
`needs:` it) and **depends on this** (`D`, inserted after, it `needs:` this item)
— both drop straight into title-edit, inheriting project and the current view's date.

Blocked items render dimmed with 🔒, are hidden from Today / This Week / Inbox, and
always show in **Review**.

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
| 1 | Today      | not done & (`sched ≤ today` or `due ≤ today`), minus blocked — overdue items in a section at the top |
| 2 | This Week  | `sched` or `due` on or before Sunday                                  |
| 3 | Upcoming   | dated beyond this week                                                |
| 4 | Inbox      | no `sched`, no `due`                                                  |
| 5 | Done       | completed, grouped by day, newest first — plus the graph              |
| 6 | Blocked    | items waiting on a dependency, plus a "ready" and a "problems" section |
| 7 | Recurring  | every not-done item with a `repeat:` token, whatever its date          |
| 8 | Projects   | one card per project: description, info, live task counts             |
| 9 | Shortcuts  | full keyboard reference                                               |

Project filter (`p`) and text search (`/`) layer on top of any view.
Dates render relative: "Mon", "in 3d", "2d overdue" (red).

**Today** puts overdue items (`sched` or `due` in the past) in an "overdue"
section above the rest, so a slipping backlog is visible without a separate view.

**Blocked** groups not-done items into:
- **ready — blockers cleared** — a `needs:` list that's now fully satisfied, and
  not already showing in Today/This Week. "This was gated, now do it."
- **blocked** — an unfinished `needs:` task in the way. Shown with 🔒 and the
  blocker's title.
- **problems** — `needs:` points at a task that no longer exists, or a dependency
  cycle. Flagged red (`⚠ broken dep` / `⚠ cycle`) here *and* wherever else the
  item shows.

There's no separate "bumped" view — the `⤴N` chip escalates colour instead
(purple → amber at 3 → red at 5).

## Projects

Project descriptions and info live in a `## Projects` section at the end of
`todos.md`:

```markdown
## Projects

### grant
NIH R01 renewal. First draft to OSP by March 1.
color: #4da6e5
link: https://notion.so/grant-board
status: drafting
lead: me
```

`### name` starts a project; following lines are the description, except the
special `color:` / `link:` lines and `key: value` lines (structured info). A
project exists as soon as a task is tagged `+name` — the `## Projects` entry only
adds description / color / link / info, and entries with none of those are pruned
on save. `color:` overrides the name-hashed default and applies everywhere the
project's dot or chip shows; it accepts any CSS color (`#4da6e5`, `rebeccapurple`,
`hsl(...)`).

On the Projects view: `e` description (multi-line), `r` rename, `n` info lines,
`l` link, `C` color (swatch picker + native color input), `a` new project, click
the name to filter the list by it. **Rename** rewrites the `### heading`, every
`+tag` on tasks, the active filter and the selection in one step; it refuses a
name that already exists. Creating a new item while a project filter is active
tags it with that project; `P` on any item sets its project (with a "new project"
option).

## Done view + graph

- Bar chart: completions per day (last 30d) / per week (last 12w), toggle.
- Current streak (consecutive days with ≥1 completion); this-week vs last-week count.
- Stacked by `+project`.
- Cycle-time callouts for long-lived items (age at completion).
- "Finished despite N bumps" badge.
- **Recurring toggle: All / Only recurring / Only one-off.**

## Keyboard map

Most keys are **rebindable** — the Shortcuts view (`8`) has an inline editor
(click a key to drop it, `＋` to add one, "Reset all to defaults"). Overrides are
stored per-browser in `localStorage`. `ACTIONS` is the registry (name → label +
`run`); `DEFAULT_BINDINGS` is action → keys. The keydown handler dispatches via a
key→action lookup. The `?` overlay and Shortcuts view both render from the live
bindings.

Defaults:

**Navigate:** `j`/`k` move · `G` bottom · `/` search · `p` project filter ·
`\` clear filters · `?` help overlay

**Selected item:** `x` toggle done · `T` → today · `t` → tomorrow ·
`w` → next Monday (`bumps++`) · `s` sched · `d` due · `r` repeat · `b` blockers ·
`P` set project · `e`/`Enter` edit title · `E` edit whole line · `n` note ·
`l` link · `J`/`K` reorder · `#` delete · `u` undo

**Create:** `a` add here — inline, after the selection, prefills `sched:today` in
Today/Week (in Inbox it's dateless) · `c` quick-capture (modal, works from any
view, parses `+project` / `due:…` as you type) · `B` new task that blocks the
selected one · `D` new task that depends on it

**Not rebindable:** `1`–`8` switch view · `g g` top · `Tab`/`Shift-Tab` indent ·
`Esc` (graduated back-out: clear filters → deselect → close) · Projects view
`e`/`n`/`l`/`C`/`a`

**Pickers:** the project-filter picker is numbered — `p` then a digit jumps
straight to that project (`1` = All projects = clear filter). Filterable pickers
(blockers) take type-to-filter instead.

## Selection

`mutate()` records the selected row's list index before the change; if that row
leaves the view afterwards (bump, done, delete, reschedule, project change…) the
selection moves to the row that took its slot — the next one down — falling back
to the new last row if it was the last, and clearing only when the list is now
empty. Keeps you working straight down without scrolling back.

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

## Out of scope (v1)

Multi-user/sync · mobile-optimized UI · time-of-day scheduling · rich-text notes.
