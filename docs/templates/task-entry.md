# Task and status entries

Two shapes: a task in the task record, and the short entry for the same work
in the status file. Keep both to what is so; the commit's test plan holds
the steps.

## Task

```markdown
### T<n>: <what it does, in a few words>

**Status: <planned | on branch `<branch>` | ready to try | merged into
`main`, <yyyy-mm-dd>>.** <Accepted on <date>, if so.>

Asked: <the request, briefly, and why>.

Changed: <the files and what each now does; any setting added and its
default; anything Safari may lack>.

Verified: <each check and its result; logs in `<report folder>`>.
Not verified by a check: <Safari, the panel, a real input, ...>.
```

## Status entry

```markdown
## <Merged | Ready to try | In progress>: `<branch>` (T<n>, <yyyy-mm-dd>)

Off `main` at `<commit>`. <One or two sentences on what it does.>
<Accepted on <date>; merged and pushed, branch removed.>
Report: <link, if any>; task T<n>. Checks pass; not seen <where>.
```
