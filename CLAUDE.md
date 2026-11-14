# Agent rules for junction-mcp

- **Never contact the real platform yourself.** No curl, fetch, scripts or browser automation against hackjunction.app or clerk.hackjunction.app. The user needs this account for the hackathon, and bursts of calls already triggered a Vercel Security Checkpoint once. If something needs a live check, ask the user to run `npm run test:live` themselves. It refuses to run without an interactive terminal; don't try to get around that.
- Test offline with `npm test` (fake platform in `test/fake-platform.ts`; real network is disabled by `test/no-network.ts`).
- Request pacing, caching and checkpoint handling live in `src/api/guard.ts` and `src/cache.ts`. Keep every new tool behind them.
- Write tools are on by default (`JUNCTION_ALLOW_WRITES=0` turns them off), but every write must call `confirm()` in `src/server.ts` (MCP elicitation) right before its mutation, and fail closed when the client can't elicit. Keep destructive team actions (delete team, kick member, leave team) out of the MCP.
