# Ready to try: <branch> (<task>)

<One or two sentences: what changed and why.>

## Where

- Branch `<branch>`, at `<commit>`, checked out in `<clone or worktree path>`.
- Start: `<exact command>`, or "already running; reload the page".
- Needs a server restart: yes / no (changes to `server.js` or `lib/` do).

## Test plan

| # | What is being tested | How | Expected |
| - | --- | --- | --- |
| 1 | <behaviour> | <steps> | <what you should see> |
| 2 | | | |

## Checks run

<Each check and its result, e.g. `npm test` 404 pass; `check-video-gamma`
pass. Logs: `<where they were saved>`.>

## Not covered

<What no check here can see: Safari, the panel, a real input, a long run.
Name anything that might behave differently in Safari.>

## After acceptance

The checks are run again, the branch is merged into `main` and `main` is
pushed; the branch is then deleted.
