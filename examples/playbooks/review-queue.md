Review every task in Review that has a PR and no review of its latest commit yet.

1. `devit task list --status review --json`: keep the tasks with a `pr_url`.
2. For each one, check its comments. If your last review comment is newer than the PR's last commit
   (`gh pr view <url> --json commits`), skip it.
3. Review it as your instructions say, and comment on the task.
4. If no task needed a review, end with `devit run silent`. Otherwise run
   `devit run done --summary "Reviewed #<ids>: <n> LGTM, <n> with changes"`.
