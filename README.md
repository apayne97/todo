# todo

A local, keyboard-driven todo app. The ground truth is [`todos.md`](todos.md) — a
plain Markdown file you can read, edit by hand, port to Notion, or keep forever.
The app is just a fast view over it. Full design notes in [SPEC.md](SPEC.md).

## Run

```bash
cd ~/life/todo && npm start
```

Then open <http://localhost:4444>. In Claude Code (from the `pantheon` repo) you
can also `preview_start` the `todo` launch config.

Set `TODO_AUTOCOMMIT=1` to have the server `git commit` `todos.md` a few seconds
after each change:

```bash
TODO_AUTOCOMMIT=1 npm start
```

## How it works

- The browser app reads and writes `todos.md` through the tiny server in
  `server.mjs` (Node stdlib only, no dependencies).
- Claude edits `todos.md` directly; the app reloads it on window focus / every 10s.
- Writes are atomic and guarded by an mtime check, so the app and Claude editing
  at the same time can't clobber each other silently.

## The file format

One task per line. Free text first, then space-separated tokens:

```
- [ ] Draft the figure +grant sched:2026-08-28 due:2026-09-04 id:k3f9
  - [ ] sub-task, indent two spaces
```

| Token | Meaning |
|---|---|
| `+project` | area tag (repeatable) |
| `sched:YYYY-MM-DD` | when it shows up on your list |
| `due:YYYY-MM-DD` | hard deadline |
| `repeat:+1w` | recur from the scheduled date |
| `repeat:.3d` | recur from the completion date |
| `needs:id1,id2` | blocked until those items are done |
| `pri:A` | priority (A/B/C) |
| `bumps:N` | times pushed forward (auto) |
| `created:` / `done:` | dates (auto) |
| `id:xxxx` | stable id (auto) |

Completed tasks move under `## Done`. Unknown tokens are preserved untouched.

An item can also carry a `link:` line (a URL, rendered as a clickable chip) and a
freeform note line, both indented under it:

```markdown
- [ ] apply to the job +hunt due:2026-09-01
  link: https://careers.example.com/req/123
  ping the recruiter first
```

Project descriptions, info, and a link go in a `## Projects` section at the end:

```markdown
## Projects

### grant
NIH R01 renewal. First draft to OSP by March 1.
link: https://notion.so/grant-board
status: drafting
```

Edit them on the Projects view (`7`).

## Keys

Press `?` in the app for the full list, or open the Shortcuts view (`8`).
Highlights: `j`/`k` move, `x` done, `T` today, `t` tomorrow, `w` bump to next
Monday, `s`/`d` set dates, `e` edit title, `E` edit the whole line, `n` note,
`l` link, `P` set project, `p` project filter, `a` add, `c` quick-capture, `u` undo.

## Tests

```bash
npm test
```

Covers the parser round-trip, date math, recurrence, and dependency blocking.
