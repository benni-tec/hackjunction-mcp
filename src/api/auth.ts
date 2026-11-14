/**
 * Clerk session tokens for hackjunction.app.
 *
 * Session JWTs live 60 s, so they are minted from the long-lived Clerk client the same way the website does:
 * `POST https://clerk.hackjunction.app/v1/client/sessions/{sid}/tokens` with the `__client` cookie.
 */

export const CLERK_FAPI_URL = "https://clerk.hackjunction.app";
const SITE_ORIGIN = "https://hackjunction.app";
/** Mint a new token this long before the current one expires. */
const REFRESH_MARGIN_MS = 10_000;

export type TokenProvider = () => Promise<string>;

export interface ClerkSessionOptions {
  /** Value of the `__client` cookie on clerk.hackjunction.app. */
  clientToken: string;
  /** Clerk session id (`sess_…`), e.g. `Clerk.session.id` in a logged-in tab. */
  sessionId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export function clerkSessionTokens(options: ClerkSessionOptions): TokenProvider {
  const { clientToken, sessionId, fetch = globalThis.fetch, now = Date.now } = options;
  let current: { jwt: string; refreshAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const mint = async (): Promise<string> => {
    const response = await fetch(`${CLERK_FAPI_URL}/v1/client/sessions/${encodeURIComponent(sessionId)}/tokens`, {
      method: "POST",
      headers: {
        cookie: `__client=${clientToken}`,
        origin: SITE_ORIGIN,
        "content-type": "application/x-www-form-urlencoded",
      },
    });
    if (!response.ok) {
      throw new Error(
        `Clerk refused to mint a session token (HTTP ${response.status}). ` +
          "Sign in on hackjunction.app again and update JUNCTION_CLERK_CLIENT / JUNCTION_CLERK_SESSION.",
      );
    }
    const { jwt } = (await response.json()) as { jwt?: string };
    if (!jwt) throw new Error("Clerk's token response had no `jwt`");
    current = { jwt, refreshAt: jwtExpiry(jwt) - REFRESH_MARGIN_MS };
    return jwt;
  };

  return () => {
    if (current && now() < current.refreshAt) return Promise.resolve(current.jwt);
    pending ??= mint().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}

/** A fixed session JWT. It expires after 60 s, so this only suits a quick manual check. */
export function staticToken(token: string): TokenProvider {
  return () => Promise.resolve(token);
}

/** `exp` of a JWT, in ms. */
export function jwtExpiry(jwt: string): number {
  const payload = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof payload.exp !== "number") throw new Error("Session JWT has no `exp` claim");
  return payload.exp * 1000;
}
