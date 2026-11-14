# junction-mcp

An MCP server for participants of Junction hackathons. It talks to the participant API of [hackjunction.app](https://hackjunction.app) (tRPC + superjson, Clerk auth) on your behalf. See [docs/API.md](docs/API.md) for the reverse-engineered API map.

## Tools

Read-only, always on:

| Tool | What it returns |
|---|---|
| `list_my_events` | Events you're registered to, with key dates and your status |
| `get_schedule` | The event schedule, in order |
| `get_announcements` | Organiser announcements, newest first |
| `list_challenges` / `get_challenge` | Main and side challenges, and a challenge's full brief |
| `get_my_team` | Your team, its members (names and roles, no emails) and its challenge interests |
| `list_teams` | Teams in the event, filterable by name |
| `get_my_projects` | Your team's projects with links, side challenges and submission state |

Writes: `save_project_draft`, `submit_project`, `unsubmit_project`, `edit_team`, `set_table_number`, `set_team_interests`. Each call first shows you what it's about to change and waits for your OK (MCP elicitation). If you decline, or your client can't show the prompt, nothing is sent. Set `JUNCTION_ALLOW_WRITES=0` to leave these tools out. Updating a draft needs the project's `updatedAt` from `get_my_projects`, so a stale edit can't overwrite a teammate's newer one (the server answers `CONFLICT`).

`eventId` is optional everywhere and defaults to your only registered event.

## Setup

```sh
npm install
```

Sign in on hackjunction.app in a browser, then copy two values:

- `JUNCTION_CLERK_CLIENT`: the `__client` cookie of `clerk.hackjunction.app` (DevTools → Application → Cookies).
- `JUNCTION_CLERK_SESSION`: the session id, `Clerk.session.id` in the DevTools console (`sess_…`).

The server mints the 60-second session tokens from these, the way the website does.
For a quick manual check you can instead set `JUNCTION_TOKEN` to a session JWT (`await Clerk.session.getToken()`), which expires after 60 s.

Claude Code:

```sh
claude mcp add junction \
  -e JUNCTION_CLERK_CLIENT=… -e JUNCTION_CLERK_SESSION=… \
  -- node /path/to/junction-mcp/src/main.ts
```

Requires Node ≥ 22.18 (runs the TypeScript directly).

## Don't get your account flagged

On 2026-11-13 a few bursts of ~20 automated calls were enough for Vercel to put a Security Checkpoint (`403`, `x-vercel-mitigated: challenge`) in front of this IP. So the server:

- sends one request at a time, at least 1 s apart, and caches results (minutes for events and challenges, 30 s for projects);
- never prefetches;
- stops all traffic for 15 minutes on a checkpoint or `429`, and never retries on its own. Open the site in a normal browser instead.

## Development

```sh
npm test            # offline: fake platform, real network disabled
npm run typecheck
npm run test:live   # LIVE: ~20 read-only calls with your account
```

`test:live` checks the DTOs in `src/api/dto.ts` against real responses. It only runs from an interactive terminal and asks you to type `send` first, so agents and CI can't trigger it.

### Live checks still outstanding

- Minting tokens from `JUNCTION_CLERK_CLIENT` / `JUNCTION_CLERK_SESSION` hasn't been tried against the real Clerk instance yet.
- `Project`, `ProjectLink`, `getProjectSubmission` and the mutation outputs are typed from the frontend code. No project existed when the API was mapped, because submissions open on 2026-11-14 at 12:00 Helsinki time.
