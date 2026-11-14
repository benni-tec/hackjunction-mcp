/**
 * In-memory TTL cache for query results. Stores the pending promise, so concurrent callers share one request;
 * failures are evicted so the next call can try again.
 */
export class TtlCache {
  readonly #entries = new Map<string, { expires: number; value: Promise<unknown> }>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.#entries.get(key);
    if (hit && hit.expires > this.#now()) return hit.value as Promise<T>;

    const value = load();
    this.#entries.set(key, { expires: this.#now() + ttlMs, value });
    value.catch(() => {
      if (this.#entries.get(key)?.value === value) this.#entries.delete(key);
    });
    return value;
  }

  clear(): void {
    this.#entries.clear();
  }
}
