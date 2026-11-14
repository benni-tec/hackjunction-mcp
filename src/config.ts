import { clerkSessionTokens, staticToken, type TokenProvider } from "./api/auth.ts";

export type AuthMode = "clerk" | "static" | "none";

/**
 * Picks the token source from the environment:
 * - `JUNCTION_CLERK_CLIENT` + `JUNCTION_CLERK_SESSION`: mint fresh tokens from the Clerk session (normal use).
 * - `JUNCTION_TOKEN`: one fixed session JWT; it expires after 60 s.
 * - neither: public procedures only.
 */
export function tokenProviderFromEnv(
  env: NodeJS.ProcessEnv,
  fetch: typeof globalThis.fetch,
): { mode: AuthMode; getToken?: TokenProvider } {
  const clientToken = env.JUNCTION_CLERK_CLIENT;
  const sessionId = env.JUNCTION_CLERK_SESSION;
  if (clientToken && sessionId) return { mode: "clerk", getToken: clerkSessionTokens({ clientToken, sessionId, fetch }) };
  if (clientToken || sessionId) throw new Error("Set both JUNCTION_CLERK_CLIENT and JUNCTION_CLERK_SESSION");
  if (env.JUNCTION_TOKEN) return { mode: "static", getToken: staticToken(env.JUNCTION_TOKEN) };
  return { mode: "none" };
}
