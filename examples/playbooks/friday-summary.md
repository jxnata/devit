Friday summary: a short close of the week, read in two minutes.

1. Collect what changed since Monday: tasks moved to done, merged PRs, runs (`devit runs --json -n 100`),
   and the open tasks in Review and Doing.
2. If nothing moved this week (no done tasks, no merges, no runs besides routines), end with
   `devit run silent`.
3. Otherwise create a task titled "Week summary <YYYY-MM-DD>" in Review with:
   - three to five bullets on what got done, linking tasks and PRs
   - what is still open and who has it
   - anything the human should decide before Monday
4. Finish with `devit run done --summary "<one line>"`.
