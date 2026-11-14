#!/usr/bin/env node
/**
 * Junction MCP server over stdio.
 *
 *   JUNCTION_CLERK_CLIENT=<__client cookie> JUNCTION_CLERK_SESSION=<sess_…> node src/main.ts
 *
 * The tools that change data on the platform ask the user to confirm each call through MCP elicitation.
 * Set JUNCTION_ALLOW_WRITES=0 to leave them out entirely.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createJunctionClient } from "./api/client.ts";
import { createGuardedFetch } from "./api/guard.ts";
import { tokenProviderFromEnv } from "./config.ts";
import { createJunctionServer } from "./server.ts";

const { mode, getToken } = tokenProviderFromEnv(process.env, createGuardedFetch());
const api = createJunctionClient({ getToken, fetch: createGuardedFetch() });
const allowWrites = process.env.JUNCTION_ALLOW_WRITES !== "0";

const server = createJunctionServer({ api, allowWrites });
await server.connect(new StdioServerTransport());
console.error(`junction-mcp ready (auth: ${mode}, writes: ${allowWrites ? "on" : "off"})`);
