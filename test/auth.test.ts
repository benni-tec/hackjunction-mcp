import assert from "node:assert/strict";
import { test } from "node:test";
import { clerkSessionTokens, jwtExpiry } from "../src/api/auth.ts";
import { tokenProviderFromEnv } from "../src/config.ts";

const jwt = (exp: number) =>
  ["e30", Buffer.from(JSON.stringify({ exp, sid: "sess_1" })).toString("base64url"), "sig"].join(".");

test("jwtExpiry reads exp in ms", () => {
  assert.equal(jwtExpiry(jwt(100)), 100_000);
});

test("mints a token with the Clerk client cookie and reuses it until shortly before expiry", async () => {
  let now = 0;
  const requests: { url: string; init?: RequestInit }[] = [];
  const getToken = clerkSessionTokens({
    clientToken: "client-jwt",
    sessionId: "sess_1",
    now: () => now,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ jwt: jwt(60 + requests.length * 60) });
    },
  });

  const [a, b] = await Promise.all([getToken(), getToken()]);
  assert.equal(a, b);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]!.url, "https://clerk.hackjunction.app/v1/client/sessions/sess_1/tokens");
  assert.equal(requests[0]!.init?.method, "POST");
  assert.equal((requests[0]!.init?.headers as Record<string, string>).cookie, "__client=client-jwt");

  now = 100_000; // 20 s before exp: still fine
  assert.equal(await getToken(), a);
  assert.equal(requests.length, 1);

  now = 115_000; // inside the refresh margin
  assert.notEqual(await getToken(), a);
  assert.equal(requests.length, 2);
});

test("explains a rejected Clerk session", async () => {
  const getToken = clerkSessionTokens({
    clientToken: "stale",
    sessionId: "sess_1",
    fetch: async () => new Response("", { status: 401 }),
  });
  await assert.rejects(getToken(), /Sign in on hackjunction.app again/);
});

test("tokenProviderFromEnv picks the auth mode", () => {
  const fetch = globalThis.fetch;
  assert.equal(tokenProviderFromEnv({}, fetch).mode, "none");
  assert.equal(tokenProviderFromEnv({ JUNCTION_TOKEN: "t" }, fetch).mode, "static");
  assert.equal(tokenProviderFromEnv({ JUNCTION_CLERK_CLIENT: "c", JUNCTION_CLERK_SESSION: "s" }, fetch).mode, "clerk");
  assert.throws(() => tokenProviderFromEnv({ JUNCTION_CLERK_CLIENT: "c" }, fetch), /both/);
});
