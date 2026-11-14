# hackjunction-mcp

An MCP server for participants of Junction hackathons. It lets an agent such as Claude Code read your event, challenges and team on [hackjunction.app](https://hackjunction.app), and fill in and submit your team's projects. Every change waits for your OK first.

It talks to the platform's participant API (tRPC + superjson, Clerk auth) with your own session. [docs/API.md](docs/API.md) maps that API; it was reverse-engineered from the website.

## Tools

Read-only:

| Tool | What it returns |
|---|---|
| `list_my_events` | Events you're registered to, with key dates and your status |
| `get_schedule` | The event schedule, in order |
| `get_announcements` | Organiser announcements, newest first |
| `list_challenges` / `get_challenge` | Main and side challenges, and a challenge's full brief |
| `get_my_team` | Your team, its members (names and roles, no emails) and its challenge interests |
| `list_teams` | Teams in the event, filterable by name |
| `get_my_projects` | Your team's projects with links, side challenges and submission state |

Writes:

| Tool | What it changes |
|---|---|
| `save_project_draft` | Creates or updates a project draft. Updates need the project's `updatedAt` from `get_my_projects`, so a stale edit can't overwrite a teammate's newer one (the server answers `CONFLICT`) |
| `submit_project` / `unsubmit_project` | Submits a draft as a final entry, or withdraws it back to draft |
| `edit_team` | Team name, subtitle, description and contact |
| `set_table_number` | Your team's table |
| `set_team_interests` | The main challenges your team is interested in |

Before every write, the server shows you what it's about to send and asks you to accept (MCP elicitation). If you decline or cancel, nothing is sent. If your MCP client can't show the prompt, writes are refused. Set `JUNCTION_ALLOW_WRITES=0` to leave the write tools out entirely. Deleting teams, kicking members and leaving a team are deliberately not exposed.

`eventId` is optional everywhere and defaults to your only registered event.

## Setup

Requires Node ≥ 22.18 (it runs the TypeScript directly).

```sh
git clone https://github.com/benni-tec/hackjunction-mcp.git
cd hackjunction-mcp
npm install
```

Sign in on hackjunction.app in a browser, then copy two values:

- `JUNCTION_CLERK_CLIENT`: the `__client` cookie of `clerk.hackjunction.app` (DevTools → Application → Cookies).
- `JUNCTION_CLERK_SESSION`: the session id, `Clerk.session.id` in the DevTools console (`sess_…`).

The server mints the 60-second session tokens from these, the way the website does. Treat both like a password.

Add it to Claude Code. Run this in your own terminal, so the cookie doesn't end up in a chat transcript:

```sh
claude mcp add junction \
  -e JUNCTION_CLERK_CLIENT='…' -e JUNCTION_CLERK_SESSION='sess_…' \
  -- node "$PWD/src/main.ts"
```

Restart Claude Code; `/mcp` should list `junction` as connected.

For a quick manual check you can instead set `JUNCTION_TOKEN` to a session JWT (`await Clerk.session.getToken()`), which expires after 60 s.

## Don't get your account flagged

Short bursts of automated calls are enough for Vercel to put a Security Checkpoint (`403`, `x-vercel-mitigated: challenge`) in front of your IP. So the server:

- sends one HTTP request at a time, at least 1 s apart, and caches results (minutes for events and challenges, 30 s for projects);
- never prefetches, and batches lookups that happen together (listing projects costs the same few requests however many there are);
- stops all traffic for 15 minutes on a checkpoint or `429`, and never retries on its own. Open the site in a normal browser instead.

## Development

```sh
npm test            # offline: fake platform, real network disabled
npm run typecheck
npm run test:live   # LIVE: read-only calls with your account
```

`test:live` checks the DTOs in `src/api/dto.ts` against real responses. It only runs from an interactive terminal and asks you to type `send` first, so agents and CI can't trigger it.
