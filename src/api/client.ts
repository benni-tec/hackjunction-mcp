import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { JunctionRouter } from "./router.ts";

export const JUNCTION_BASE_URL = "https://hackjunction.app";

export interface JunctionClientOptions {
  /**
   * Returns a Clerk session JWT for hackjunction.app. Tokens live only 60 s, so mint a fresh one per call.
   * Leave it out to call the public procedures only (e.g. `event.getAllFutureEvents`).
   */
  getToken?: () => string | null | Promise<string | null>;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createJunctionClient(options: JunctionClientOptions = {}) {
  const { getToken, baseUrl = JUNCTION_BASE_URL, fetch } = options;
  return createTRPCClient<JunctionRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        fetch,
        async headers() {
          const token = await getToken?.();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}

export type JunctionClient = ReturnType<typeof createJunctionClient>;
