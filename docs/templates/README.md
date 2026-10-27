# Templates

Shapes for the records this project keeps, so each one reads the same and
whoever comes later, a person or an agent, knows where to look.

| Template | For |
| --- | --- |
| [commit-message.txt](commit-message.txt) | Every commit: subject, why, and a test plan (what, how, expected), the checks run and what they do not cover. Set it as git's template with `git config commit.template "$PWD/docs/templates/commit-message.txt"` from the repository's top folder. |
| [hand-over.md](hand-over.md) | Saying a branch is ready to try: where it is, how to start it, the test plan, the checks, what is not covered. |
| [evidence-readme.md](evidence-readme.md) | The `README.md` of a folder of evidence behind a measurement or review: each file, what it shows, the command that made it. |
| [task-entry.md](task-entry.md) | A task in the task record and its entry in the status file. |
| [story.md](story.md) | An issue as a story: the report, then an acceptance list adjusted as the story is worked. |
| [release-checklist.md](release-checklist.md) | A build: the standing items plus each included story's acceptance list. |
