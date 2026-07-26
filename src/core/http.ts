import { SourceError } from "./errors.js";

/**
 * The complete list of hosts this server may ever contact.
 * No tool takes a URL, host or chain as a parameter — this set is the whole
 * network surface of the process. scripts/audit.mjs fails the build if it changes.
 */
const ALLOWED_HOSTS = new Set([
  "api.hyperliquid.xyz",
  "api.llama.fi",
  "yields.llama.fi",
  "rpc.hyperliquid.xyz",
]);

const TIMEOUT_MS = 7_000;
/** The retry is deliberately shorter, so a bad network costs ~12s, not ~16s. */
const RETRY_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 300;
/** yields.llama.fi/pools is ~11 MB, so the usual 5 MB cap would break the flagship tool. */
const MAX_BYTES = 25 * 1024 * 1024;

export interface FetchOpts {
  /** Human label used in error messages, e.g. "DefiLlama". */
  source: string;
  method?: "GET" | "POST";
  body?: unknown;
}

/**
 * One retry on transient failures. A demo runs on hotel wifi; a single dropped
 * connection should not become a visible failure. Permanent errors — a bad
 * host, a 404, malformed JSON — are not retried.
 */
export async function fetchJson<T>(url: string, opts: FetchOpts): Promise<T> {
  try {
    return await attempt<T>(url, opts, TIMEOUT_MS);
  } catch (err) {
    if (err instanceof SourceError && err.transient) {
      await sleep(RETRY_DELAY_MS);
      return attempt<T>(url, opts, RETRY_TIMEOUT_MS);
    }
    throw err;
  }
}

async function attempt<T>(url: string, opts: FetchOpts, timeoutMs: number): Promise<T> {
  const u = new URL(url);
  if (u.protocol !== "https:") {
    throw new SourceError(opts.source, `refused a non-https URL (${u.protocol}//${u.hostname})`);
  }
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new SourceError(opts.source, `refused a host that is not on the allowlist (${u.hostname})`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(u, {
        method: opts.method ?? "GET",
        headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        redirect: "error",
        signal: controller.signal,
      });
    } catch {
      if (controller.signal.aborted) {
        throw new SourceError(
          opts.source,
          `${opts.source} timed out after ${timeoutMs / 1000}s (${u.hostname})`,
          true,
        );
      }
      throw new SourceError(opts.source, `${opts.source} is unreachable (${u.hostname})`, true);
    }

    if (!res.ok) {
      const transient = res.status === 429 || res.status >= 500;
      throw new SourceError(
        opts.source,
        `${opts.source} returned HTTP ${res.status} (${u.hostname}${u.pathname})`,
        transient,
      );
    }

    const text = await readCapped(res, opts.source, u.hostname, controller, timeoutMs);

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new SourceError(opts.source, `${opts.source} returned a body that is not valid JSON (${u.hostname})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function readCapped(
  res: Response,
  source: string,
  host: string,
  controller: AbortController,
  timeoutMs: number,
): Promise<string> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    throw new SourceError(source, `${source} response is larger than the ${mb(MAX_BYTES)} cap (${host})`);
  }
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new SourceError(source, `${source} response exceeded the ${mb(MAX_BYTES)} cap (${host})`);
      }
      chunks.push(value);
    }
  } catch (err) {
    if (err instanceof SourceError) throw err;
    if (controller.signal.aborted) {
      throw new SourceError(
        source,
        `${source} timed out after ${timeoutMs / 1000}s while reading the response (${host})`,
        true,
      );
    }
    throw new SourceError(source, `${source} connection dropped while reading the response (${host})`, true);
  }

  return Buffer.concat(chunks).toString("utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
