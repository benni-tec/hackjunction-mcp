/**
 * A fetch wrapper that keeps traffic to the Junction platform gentle, so the participant's IP and account don't get flagged.
 * On 2026-11-13 a few bursts of ~20 calls were enough to trip Vercel's Security Checkpoint.
 *
 * - One request in flight at a time, started at least `minIntervalMs` apart.
 * - A Vercel challenge (403 with `x-vercel-mitigated`) or a 429 trips a breaker: every later call fails fast, without
 *   touching the network, until `cooldownMs` has passed. Nothing is ever retried automatically.
 */

export class PlatformBlockedError extends Error {
  readonly until: Date;

  constructor(reason: string, until: Date) {
    super(
      `${reason}. Paused all requests until ${until.toISOString()} so the block doesn't escalate. ` +
        "Check https://hackjunction.app in a normal browser; don't retry from here.",
    );
    this.name = "PlatformBlockedError";
    this.until = until;
  }
}

export interface GuardOptions {
  fetch?: typeof fetch;
  minIntervalMs?: number;
  cooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_MIN_INTERVAL_MS = 1_000;
export const DEFAULT_COOLDOWN_MS = 15 * 60_000;

export function createGuardedFetch(options: GuardOptions = {}): typeof fetch {
  const {
    fetch: baseFetch = globalThis.fetch,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;

  let queue: Promise<unknown> = Promise.resolve();
  let lastStart = -Infinity;
  let blocked: { until: number; reason: string } | undefined;

  const send = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (blocked && now() < blocked.until) throw new PlatformBlockedError(blocked.reason, new Date(blocked.until));

    const wait = lastStart + minIntervalMs - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();

    const response = await baseFetch(input, init);
    const reason = blockReason(response);
    if (reason) {
      blocked = { until: now() + cooldownMs, reason };
      throw new PlatformBlockedError(reason, new Date(blocked.until));
    }
    return response;
  };

  return (input, init) => {
    const result = queue.then(() => send(input, init));
    queue = result.catch(() => {});
    return result;
  };
}

function blockReason(response: Response): string | undefined {
  if (response.status === 403 && response.headers.has("x-vercel-mitigated")) {
    return `Vercel Security Checkpoint (x-vercel-mitigated: ${response.headers.get("x-vercel-mitigated")})`;
  }
  if (response.status === 429) return "Rate limited (HTTP 429)";
}
