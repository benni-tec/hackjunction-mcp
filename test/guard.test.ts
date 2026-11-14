import assert from "node:assert/strict";
import { test } from "node:test";
import { PlatformBlockedError, createGuardedFetch } from "../src/api/guard.ts";

function clock() {
  let now = 0;
  const sleeps: number[] = [];
  return {
    now: () => now,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      now += ms;
    },
    advance: (ms: number) => {
      now += ms;
    },
    sleeps,
  };
}

test("sends one request at a time, spaced out", async () => {
  const time = clock();
  let inFlight = 0;
  let maxInFlight = 0;
  const guarded = createGuardedFetch({
    minIntervalMs: 1000,
    now: time.now,
    sleep: time.sleep,
    fetch: async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight--;
      return new Response("ok");
    },
  });

  await Promise.all([guarded("https://x"), guarded("https://x"), guarded("https://x")]);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(time.sleeps, [1000, 1000]);
});

test("a checkpoint blocks every later request until the cooldown ends", async () => {
  const time = clock();
  let requests = 0;
  let challenge = true;
  const guarded = createGuardedFetch({
    minIntervalMs: 0,
    cooldownMs: 60_000,
    now: time.now,
    sleep: time.sleep,
    fetch: async () => {
      requests++;
      return challenge
        ? new Response("", { status: 403, headers: { "x-vercel-mitigated": "challenge" } })
        : new Response("ok");
    },
  });

  await assert.rejects(guarded("https://x"), PlatformBlockedError);
  challenge = false;
  await assert.rejects(guarded("https://x"), PlatformBlockedError);
  assert.equal(requests, 1);

  time.advance(60_000);
  assert.equal(await (await guarded("https://x")).text(), "ok");
  assert.equal(requests, 2);
});

test("a 429 trips the breaker, an ordinary 403 doesn't", async () => {
  const statuses = [403, 429, 200];
  const guarded = createGuardedFetch({
    minIntervalMs: 0,
    fetch: async () => new Response("", { status: statuses.shift() }),
  });
  assert.equal((await guarded("https://x")).status, 403);
  await assert.rejects(guarded("https://x"), /Rate limited/);
  await assert.rejects(guarded("https://x"), PlatformBlockedError);
});
