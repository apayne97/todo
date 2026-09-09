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
(macOS); [`deploy/todo.service`](deploy/todo.service) is the systemd equivalent
for an always-on Linux box. Install per the comment at the top of the file. With
Tailscale the phone reaches it at `http://<host>:4444/m` from anywhere; add to
the home screen for an app-like shell. The `pantheon` `preview_start todo` config
just attaches to the running server. **Run it on every machine you edit from** —
otherwise edits made there sit unpushed (`cd ~/life/todo && git push` to recover
them). For a phone you actually rely on, run it on a box that's always up (the
Linux server) rather than a laptop that sleeps.

**Open it as a real app (no more fishing through Chrome tabs):** the page ships a
web manifest + icon, so it's installable as a standalone window.

- **Chrome/Edge:** open <http://localhost:4444>, then ⋮ menu → *Cast, save, and
  share* → *Install page as app…* (older Chrome: *More tools* → *Create
  shortcut…* → check *Open as window*). It gets a Dock icon and its own window —
  launch it from Spotlight/Raycast/Dock like any app.
- **Global hotkey:** Shortcuts.app → new shortcut → *Open App* → the installed
  "todo" app → assign a keyboard shortcut in the shortcut's info panel. One chord
  focuses-or-opens the single window from anywhere.
- **iPhone:** open **`/m`** (the mobile app — see below), Safari → Share → *Add
  to Home Screen*.

## Mobile app (`/m`)

`http://<host>:4444/m` is a separate, touch-first front-end — not the desktop app
squeezed onto a phone. Three tabs (**Today / Upcoming / Inbox**), and that's the
whole surface: tap the circle to complete (recurring rolls forward, with a 6s
**Undo**), tap a row to expand its note / link / subtasks and a snooze row
(**Tomorrow · Next week · Pick day**), and a **+** button to add one task through
the same parser as desktop `a` (`buy milk +life due:friday` works). Everything
heavier — projects, dependencies, habits, bulk edit, reordering — stays on the
desktop app.

It's a PWA: *Add to Home Screen* gives it its own icon and window. The last
loaded list is kept in `localStorage`, so reopening it shows that immediately
while the fresh copy loads; when a request fails it says "offline" and holds your
change until the connection's back. The service worker that caches the app shell
for a true cold-start-offline needs a **secure context** — `https://` or
`localhost` — so it only kicks in if you reach the server over HTTPS (e.g.
`tailscale serve` in front of port 4444, which mints a cert for the `*.ts.net`
name). Over plain `http://<host>:4444` the app still works, it just needs the
server reachable to start.

**Auth.** Set `TODO_PASSWORD` in the environment and every data request needs a
password (entered once at `/login`, then a year-long cookie). Unset = no auth
(fine for localhost / same-LAN). Turn it on before the server is reachable from
outside your network. The desktop app respects the same gate with no changes.

**Autosave to git — on by default.** The server commits `todos.md` ~8s after the
last edit and pushes. A burst of edits (checking off three things, adding two)
becomes one `todo: autosave 2026-08-26 14:32` commit; filter them out with
`git log --grep autosave --invert-grep`. It rebases onto any concurrent push
first, so a code commit from another session is never clobbered.

- `TODO_AUTOPUSH=0` — commit locally but don't push.
- `TODO_AUTOCOMMIT=0` — don't touch git at all (implies no push).

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

Manage them on the Projects view (`8`): **click a project** (or `↵`) to open a
full editable task list for it — buckets by date, "show done" toggle. Inside,
`⌃1`–`⌃9` swaps to another project and `\` goes back to the card list. To
highlight a card without opening it, use `j`/`k` — then `J`/`K` reorder it (this
writes an `order:` line and renumbers `⌃N`), or `e`/`r`/`n`/`l`/`C` edit it.

Weekly **habit goals** go in a `## Habits` section:

```markdown
## Habits

### hackerrank
30 min HackerRank / LeetCode
goal: 3/week
best: 6
```

On the Habits view (`7`), each habit shows `X / Y this week`, current streak
(consecutive weeks the goal was met — a missed week resets it), the all-time
best streak, and an 8-week sparkline. `j`/`k` to select, then `x` (or `↵`) logs
a rep now (a `- [x] … +<name>` line under `## Done`), `e` description, `g` goal,
`r` rename, `a` new. `#` **archives** a habit (adds an `archived:` line, moves it
to a muted section at the bottom, stops it counting toward the goal — history is
kept); on an archived habit, `↵` restores it and `#` deletes it and its logged
reps for good. Recurring (`repeat:`) tasks are listed below the habit cards.

## Keys

Views `1`–`9`: Today · Tomorrow · Upcoming (rest of week / next week / later) ·
Inbox · Done · Blocked · Habits · Projects · Shortcuts.

Press `?` in the app for the full list. Highlights: `j` up / `k` down, `x` done,
`T` today, `t` tomorrow, `w` next Monday, `s`/`d` dates, `S` push dates to subtasks,
`]`/`[` ±1 day · `}`/`{` ±1 week · `)`/`(` ±1 month, `e` edit title, `E` whole line,
`n` note, `l` link, `.`/`b` dependency overlay, `p` set project,
`⌃1`–`⌃9` Nth project — swaps the drill-in, or toggles the list filter (numbered
in the sidebar); `P` for the picker, `\` clear filters / leave drill-in,
`a` add, `A` bulk add (paste, one task per line), `c` quick-capture,
`F` follow-up task (blocked on this, +3d), `u` undo.

Most keys are **rebindable** on the Shortcuts view (`9`) — click a key to remove
it, `＋` to add one, "Reset all to defaults". Overrides are saved on the server
(`todo.config.json`), so they follow you to the installed app and your phone —
not just the browser you set them in.

## Demo

Open `http://localhost:4444/?demo` for a read-only sandbox loaded from
[tutorial.md](tutorial.md) — a self-guided example where each task title explains
a feature. Changes stay in memory; reload to reset. There's a link to it on the
Shortcuts view.

## Capturing job postings

Open `http://localhost:4444/bookmarklet.html` (also linked from the Shortcuts
view) and drag the button to your bookmarks bar. On any job posting, click it: it
reads the page's `schema.org` `JobPosting` structured data — most ATSs (Greenhouse,
Workday, Lever, LinkedIn) embed this for Google Jobs — confirms the role/company
with you, and adds `apply to <company> — <role>` to `todos.md`, tagged
`+industry-job-application`, with the posting link, location, salary, and closing
date (as `due:`) in the note. Falls back to asking by hand if a page has no
structured data.

This works from **any site**, not just the app itself: `server.mjs` exposes a
CORS-open `POST /capture` endpoint (`{ title, url?, due?, note? }`) that the
bookmarklet's `fetch()` calls — see [bookmarklet.js](bookmarklet.js) for the source.
`bookmarklet.html` is generated from it; after editing the source, run
`npm run build:bookmarklet` to regenerate the draggable link.

## Tests

```bash
npm test
```

Covers the parser round-trip, date math, recurrence, and dependency blocking.
