# Todos

- [ ] Welcome — press ? to see every keyboard shortcut +welcome sched:2026-08-26 id:t01
  Everything here is a live example. Edit it, bump it, complete it, press u to undo. Nothing is saved — reload to reset.
- [ ] This task is overdue, so it shows in the red section at the top of Today +welcome sched:2026-08-20 id:t02
- [ ] Select me and press w — I jump to next Monday and my bump count ticks up +welcome sched:2026-08-26 id:t03
- [ ] Bumped once — the up-arrow chip stays quiet +work sched:2026-08-27 bumps:1 id:t04
- [ ] Bumped 3 times — the chip turns amber +work sched:2026-08-28 bumps:3 id:t05
- [ ] Bumped 6 times — the chip turns red +work sched:2026-08-28 bumps:6 id:t06
- [ ] I have two dates: a scheduled day and a hard deadline +work sched:2026-08-27 due:2026-08-29 id:t07
- [ ] High priority +work sched:2026-08-27 pri:A id:t08
- [ ] I carry a link — click the chip, or press l to change it +work sched:2026-08-28 id:t09
  link: https://example.com/the-spec
- [ ] I carry a note — press n to edit it +home sched:2026-08-28 id:t10
  buy the nice kind, not the cheap one
- [ ] Water the plants — repeats 3 days after you check it off +garden repeat:.3d sched:2026-08-26 id:t11
- [ ] Weekly review — repeats every Monday whether or not you did it +work repeat:+1w sched:2026-08-31 due:2026-09-01 id:t12
- [ ] Ship the release — a parent task shows its subtask progress +work due:2026-09-05 id:t13
  - [ ] Write the changelog +work id:t14
  - [ ] Tag the version +work id:t15
  - [ ] Post the announcement +work id:t16
- [ ] Book the venue — this has to happen first +home sched:2026-08-27 id:t17
- [ ] Send the invitations — blocked until the venue is booked, so it's hidden from Today and listed under Blocked +home needs:t17 id:t18
- [ ] Order the cake — its blocker is already done, so it shows under Blocked as "ready" +home needs:t19 id:t20
- [ ] Broken dependency — I point at a task that doesn't exist (see the red flag, and the Problems section under Blocked) +work sched:2026-08-28 needs:ghost id:t21
- [ ] Dependency cycle, half one +work needs:t23 id:t22
- [ ] Dependency cycle, half two +work needs:t22 id:t23
- [ ] Someday: learn to make sourdough — no date, so I live in Inbox +home id:t24
- [ ] Read that long article +welcome sched:2026-09-15 id:t25

## Done

- [x] The blocker for "order the cake" +home created:2026-08-10 done:2026-08-24 id:t19
- [x] Finished despite being bumped 4 times — see the badge +work created:2026-08-01 done:2026-08-25 bumps:4 id:d01
- [x] This one took 20 days from start to finish +work created:2026-08-05 done:2026-08-25 id:d02
- [x] Water the plants +garden repeat:.3d created:2026-08-20 done:2026-08-23 id:d03
- [x] A win from yesterday +home created:2026-08-24 done:2026-08-25 id:d04
- [x] Another from yesterday +work created:2026-08-24 done:2026-08-25 id:d05
- [x] Done today +work created:2026-08-25 done:2026-08-26 id:d06
- [x] Also done today +welcome created:2026-08-26 done:2026-08-26 id:d07
- [x] From last week +home created:2026-08-14 done:2026-08-18 id:d08
- [x] Also last week +work created:2026-08-12 done:2026-08-17 id:d09

## Projects

### welcome
Start here — the orientation tasks live in this project.
color: #6ea8fe

### work
The current sprint and the pending release.
color: #e5844d
link: https://example.com/board
lead: you
status: in progress

### home
Errands, chores, and life admin.
color: #5ec26b

### garden
Recurring outdoor chores.
color: #a5c261
