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

- **Ground truth:** `life-management/todo/todos.md`. Overflow archive (later): `todos-archive.md`.
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
      <indented non-checkbox lines = freeform notes, preserved verbatim>
  - [ ] <subtask> <token> ...
```

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
   to titles for display, warns on dangling refs and cycles, and surfaces an item
   in **Review** the moment its last blocker clears.

Blocked items render dimmed with 🔒 and are hidden from Today (toggle to reveal).

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
| 1 | Today      | not done & (`sched ≤ today` or `due ≤ today`) + overdue, minus blocked |
| 2 | This Week  | `sched` or `due` on or before Sunday                                  |
| 3 | Upcoming   | dated beyond this week                                                |
| 4 | Inbox      | no `sched`, no `due`                                                  |
| 5 | Done       | completed, grouped by day, newest first — plus the graph              |
| 6 | Review     | overdue + `bumps ≥ 1` + Inbox + just-unblocked                        |
| 7 | Projects   | one card per project: description, info, live task counts             |
| 8 | Shortcuts  | full keyboard reference                                               |

Project filter (`p`) and text search (`/`) layer on top of any view.
Dates render relative: "Mon", "in 3d", "2d overdue" (red).

## Projects

Project descriptions and info live in a `## Projects` section at the end of
`todos.md`:

```markdown
## Projects

### grant
NIH R01 renewal. First draft to OSP by March 1.
status: drafting
lead: me
```

`### name` starts a project; following lines are the description, except
`key: value` lines which become structured info. A project exists as soon as a
task is tagged `+name` — the `## Projects` entry only adds description/info, and
empty entries are pruned on save. On the Projects view: `e` edits the description
(multi-line), `n` edits the info lines, `a` creates a project, clicking the name
filters the todo list by it. Creating a new item while a project filter is active
tags it with that project automatically; `P` on any item sets its project (with a
"new project" option).

## Done view + graph

- Bar chart: completions per day (last 30d) / per week (last 12w), toggle.
- Current streak (consecutive days with ≥1 completion); this-week vs last-week count.
- Stacked by `+project`.
- Cycle-time callouts for long-lived items (age at completion).
- "Finished despite N bumps" badge.
- **Recurring toggle: All / Only recurring / Only one-off.**

## Keyboard map

**Navigate:** `j`/`k` move · `g g`/`G` top/bottom · `1`–`8` jump to view ·
`/` search · `p` project filter (list picker)

**Selected item:** `x` toggle done · `T` → today · `t` → tomorrow ·
`w` → next Monday (`bumps++`) · `s` set sched · `d` set due · `r` set repeat ·
`b` set blocker (`needs:`) · `P` set project (or make a new one) ·
`Tab`/`Shift-Tab` indent/outdent as subtask ·
`e`/`Enter` edit title · `E` edit the whole line · `n` edit the note ·
`J`/`K` reorder · `#` delete · `u` undo

**Projects view:** `e`/`Enter` edit description · `n` edit info · `a` new project

**Create:** `a` add in current context (prefills e.g. `sched:today` in Today) ·
`A` add to Inbox · `c` quick-capture (global)

**Global:** `?` shortcuts overlay · `.` command palette · `Esc` close/deselect

All bindings live in one config object shared by the handler, the `?` overlay,
and the Shortcuts view.

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

## Out of scope (v1)

Multi-user/sync · mobile-optimized UI · time-of-day scheduling · rich-text notes.
