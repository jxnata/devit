Monday report: where the project stands and what this week should focus on.

1. Collect:
   - `devit task list --json`: the whole board
   - `devit runs --json -n 100`: what the personas did since last Monday, including failures and cost
   - `git log --since="8 days ago" --oneline` on the base branch
   - `gh pr list --state all --search "updated:>=<date 8 days ago>"` and `gh issue list` when the
     project has a GitHub repo
2. Create a task titled "Weekly report <YYYY-MM-DD>" with this body:
   - **Shipped last week**: merged PRs and tasks moved to done, one line each.
   - **Needs you**: tasks waiting in Review, questions personas asked in comments, failed runs.
     This is the most important section.
   - **Stuck**: tasks in Doing or To do for more than 3 days, and why if you can tell.
   - **Proposed for this week**: up to 5 tasks, in priority order, with the persona for each.
     Create the ones that don't exist yet in the backlog, and reference them by number.
   - **Cost**: the total spent on runs last week, and the most expensive persona.
3. Move the report task to Review.
4. Finish with `devit run done --summary "<the Needs you section in one line>"`.
