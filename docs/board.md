# The web board

`devit serve` also serves a kanban board at **http://127.0.0.1:7420** (`--port` or `DEVIT_PORT` to change
it, `--no-web` to turn it off).

- **Board:** one column per status, with a project picker. Drag cards between columns, or open a card
  to edit it, assign a persona, comment, and see its runs. A card a persona is working on shows a
  pulsing "working" label. Moving a card to **To do** when its persona has `autopickup: true` starts
  the work right away, without waiting for the next pass.
- **Runs:** every run in the project, with its status, time and cost. Open a run to see its summary,
  its final message and what the agent did.
- **Routines:** schedules, the next run and the last result.
- **Ask the lead:** a chat with the lead persona, like `devit ask`. It keeps the conversation going
  until you untick "Continue the conversation".

The page reloads its data every few seconds. Comments written on the board are signed `user`.

## Reaching it from another machine

By default the board only answers on 127.0.0.1, and with no token it only accepts requests whose
`Host` is `localhost`, `127.0.0.1` or a name you allow. This blocks DNS-rebinding tricks from other
sites. Writes must be JSON from the board's own origin. Choose one of these ways in:

**SSH tunnel** (nothing to set up):

```sh
ssh -L 7420:127.0.0.1:7420 my-server     # then open http://localhost:7420
```

**Cloudflare Tunnel + Access** (recommended for a server). Your identity provider handles the login,
and no port is opened:

```sh
cloudflared tunnel create devit
cloudflared tunnel route dns devit devit.example.com
# ~/.cloudflared/config.yml: ingress: - hostname: devit.example.com / service: http://127.0.0.1:7420
cloudflared tunnel run devit
devit serve --allowed-host devit.example.com
```

Then add a Cloudflare Access application for `devit.example.com` that only lets your email in. Without
Access, anyone who finds the hostname can use the board, so add a `--token` too if you skip Access.

**Tailscale:** run `tailscale serve 7420`, and allow the machine's tailnet name with
`--allowed-host`.

**Token** (for a plain public address):

```sh
DEVIT_TOKEN=$(openssl rand -hex 24) devit serve --host 0.0.0.0
```

Open `http://server:7420/?token=<token>` once. The board stores the token in an HttpOnly cookie for
30 days, and API clients can send `Authorization: Bearer <token>`. Devit refuses to listen on a
non-loopback address without a token. Put HTTPS in front of it (a reverse proxy or a tunnel), or the
token travels in the clear.

## GitHub sync

With the GitHub CLI installed and logged in (`gh auth login`), `devit serve` syncs every 15 minutes
(`--sync-minutes`, 0 turns it off). You can also sync by hand with `devit github sync [--all]`.

- Open issues labeled `devit` become backlog tasks that link to the issue. To use another label, set
  `issue_label: agents` in `.devit/project.yaml`.
- A task whose PR (`devit task link <id> --pr <url>`) was merged moves to done.
- A task whose issue was closed moves to done.

Devit only reads from GitHub. It never comments on, labels or closes anything there. Agents open PRs
with `gh` like any developer, and you merge them.
