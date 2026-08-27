# todo

A local, keyboard-driven todo app. The ground truth is [`todos.md`](todos.md) — a
plain Markdown file you can read, edit by hand, port to Notion, or keep forever.
The app is just a fast view over it. Full design notes in [SPEC.md](SPEC.md).

## Run

```bash
cd ~/life/todo && npm start
```

Then open <http://localhost:4444>.

**Always-on (and phone access):** [`deploy/com.apayne.todo.plist`](deploy/com.apayne.todo.plist)
is a launchd agent that keeps the server running whenever you're logged in
(`TODO_AUTOPUSH=1`). Install per the comment at the top of that file. With
Tailscale, the phone reaches it at `http://<mac-name>:4444` from anywhere; add to
the home screen for an app-like shell. The `pantheon` `preview_start todo` config
just attaches to the running server.

**Open it as a real app (no more fishing through Chrome tabs):** the page ships a
web manifest + icon, so it's installable as a standalone window.

- **Chrome/Edge:** open <http://localhost:4444>, then ⋮ menu → *Cast, save, and
  share* → *Install page as app…* (older Chrome: *More tools* → *Create
  shortcut…* → check *Open as window*). It gets a Dock icon and its own window —
  launch it from Spotlight/Raycast/Dock like any app.
- **Global hotkey:** Shortcuts.app → new shortcut → *Open App* → the installed
  "todo" app → assign a keyboard shortcut in the shortcut's info panel. One chord
  focuses-or-opens the single window from anywhere.
- **iPhone:** Safari → Share → *Add to Home Screen*.

**Autosave to git:**

- `TODO_AUTOCOMMIT=1` — commit `todos.md` ~8s after the last edit. A burst of
  edits (checking off three things, adding two) becomes one
  `todo: autosave 2026-08-26 14:32` commit. Filter with
  `git log --grep autosave --since "3 days ago"`.
- `TODO_AUTOPUSH=1` — also push (implies autocommit). Rebases onto any concurrent
  push first, so a code commit from another session is never clobbered.

```bash
TODO_AUTOPUSH=1 npm start
```

Storage isn't a concern — git delta-compresses these tiny diffs to almost nothing.

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

Press `?` in the app for the full list. Highlights: `j` up / `k` down, `x` done,
`T` today, `t` tomorrow, `w` next Monday, `s`/`d` dates, `S` push dates to subtasks,
`e` edit title, `E` whole line, `n` note, `l` link, `.`/`b` dependency overlay,
`p` set project, `P` filter by project, `\` clear filters, `a` add,
`c` quick-capture, `u` undo.
Both project pickers are numbered — the letter then a digit jumps straight there.

Most keys are **rebindable** on the Shortcuts view (`9`) — click a key to remove
it, `＋` to add one, "Reset all to defaults". Overrides are saved on the server
(`todo.config.json`), so they follow you to the installed app and your phone —
not just the browser you set them in.

## Demo

Open `http://localhost:4444/?demo` for a read-only sandbox loaded from
[tutorial.md](tutorial.md) — a self-guided example where each task title explains
a feature. Changes stay in memory; reload to reset. There's a link to it on the
Shortcuts view.

## Tests

```bash
npm test
```

Covers the parser round-trip, date math, recurrence, and dependency blocking.
