Daily Sentry triage: turn new production errors into tasks, and nothing else.

Needs Sentry access: the Sentry MCP server in the persona's `mcp_config`, or `sentry-cli` allowed in its
tools. If neither is there, comment that on a task titled "Sentry triage is not set up" (create it once,
in the backlog) and finish.

1. List unresolved issues first seen or regressed in the last 24 hours, in the project's Sentry
   project, sorted by events.
2. Leave out noise: browser extensions, bots, network errors outside the app's control, and issues
   that already have a task (`devit task list --json`, search for the issue id or title).
3. For each remaining issue, up to 5, create a backlog task assigned to `dev`:
   - title: what breaks, for whom, e.g. "Checkout crashes on Safari 17 when the cart is empty"
   - body: the Sentry link, event count and users affected, the stack trace top frames, the files
     likely involved after a quick look at the code, and how to reproduce if you can tell
   - priority high if it affects many users or a money path (signup, checkout, payments)
4. Remember noise patterns you skipped with `devit memory add`, so the next triage skips them faster.
5. If there was nothing new, end with `devit run silent`. Otherwise run
   `devit run done --summary "<n> new issues triaged: #<task ids>"`.
