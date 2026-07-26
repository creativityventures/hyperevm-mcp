/**
 * In-memory TTL cache with single-flight de-duplication and a stale fallback.
 *
 * Three jobs:
 *  - a demo gets run repeatedly and must never hit a rate limit mid-show;
 *  - yields.llama.fi/pools is 11 MB, so two tools asking at once make one call;
 *  - when a refresh fails but a previous answer exists, that answer is served
 *    and clearly labelled as stale. A live demo should degrade, not die —
 *    and silently serving old data would be the dishonest version of that.
 *
 * Nothing is written to disk.
 */

const DEFAULT_TTL_MS = 60_000;
/** Wallet lookups are keyed by address, so the map needs a ceiling. */
const MAX_ENTRIES = 128;

export interface Fetched<T> {
  value: T;
  /** When the underlying network call actually happened, not when it was read. */
  fetchedAt: number;
  /** True when a refresh failed and this is the previous answer. */
  stale: boolean;
}

interface Entry {
  value: unknown;
  fetchedAt: number;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<Fetched<unknown>>>();

export async function cached<T>(
  key: string,
  load: () => Promise<T>,
  ttlMs: number = DEFAULT_TTL_MS,
): Promise<Fetched<T>> {
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) {
    return { value: hit.value as T, fetchedAt: hit.fetchedAt, stale: false };
  }

  const running = inflight.get(key);
  if (running) return running as Promise<Fetched<T>>;

  const promise = load().then(
    (value) => {
      const fetchedAt = Date.now();
      remember(key, { value, fetchedAt, expiresAt: fetchedAt + ttlMs });
      inflight.delete(key);
      return { value, fetchedAt, stale: false };
    },
    (err: unknown) => {
      inflight.delete(key);
      // Expired entries are kept precisely for this moment.
      const previous = store.get(key);
      if (previous) {
        return { value: previous.value as T, fetchedAt: previous.fetchedAt, stale: true };
      }
      throw err;
    },
  );

  inflight.set(key, promise as Promise<Fetched<unknown>>);
  return promise;
}

function remember(key: string, entry: Entry): void {
  if (!store.has(key) && store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, entry);
}

/** Whole minutes since a fetch — used to label stale data honestly. */
export function ageMinutes(fetchedAt: number): number {
  return Math.max(0, Math.round((Date.now() - fetchedAt) / 60_000));
}

/** Test seam. Not used at runtime. */
export function clearCache(): void {
  store.clear();
  inflight.clear();
}
