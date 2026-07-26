import { lit, type Safe } from "./safe.js";

/**
 * The only door through which third-party text reaches the model.
 *
 * Threat: this server is read-only and cannot itself do harm, but it carries
 * text written by strangers into an agent's context — an agent that may have a
 * wallet or a shell connected next to it. Hyperliquid validator names and
 * descriptions are free text written by whoever runs the validator; DefiLlama
 * protocol names come from pull requests; spot tickers are deployed by anyone
 * who wins an auction.
 *
 * Three layers, in order of strength:
 *
 *  1. Field whitelist. Descriptions are never read at all — see the clients.
 *  2. Character allowlist, below. Not a blacklist of bad sequences: a list of
 *     what may pass. Everything else is dropped, so `<|im_start|>`, `[INST]`,
 *     backticks, pipes, braces, angle brackets and every other way of opening a
 *     structure in a prompt or a table simply cannot survive.
 *  3. The `Safe` type in safe.ts, which makes it a compile error to print text
 *     that has not been through here.
 *
 * What this does not do: it cannot stop a plain English sentence. A validator
 * named "ignore previous instructions" still reads as those words. The answer
 * to that is the field whitelist, the 32-character cap, and the fact that this
 * server exposes no action for such a sentence to trigger — not a cleverer
 * filter. Claiming otherwise would be the dishonest version of this file.
 */

/**
 * Letters, digits and currency signs in any script, plus a small set of
 * punctuation that appears in real names: "Kinetiq kHYPE", "WHYPE-USDC (0.3%)",
 * "infinitefield.xyz", "USD₮0".
 *
 * Deliberately absent: < > { } [ ] | ` \ " # * ~ $ ^ and every control
 * character. Each of those is a way to start a structure rather than name a
 * thing, and no legitimate protocol name needs one.
 */
const ALLOWED = /[\p{L}\p{N}\p{Sc} .,_:/&+()'%@?!-]/u;

/** Zero-width and bidirectional overrides: invisible to a reader, not to a model. */
function isInvisible(code: number): boolean {
  return (
    (code >= 0x200b && code <= 0x200f) || // zero-width space .. right-to-left mark
    (code >= 0x202a && code <= 0x202e) || // embedding / override
    (code >= 0x2066 && code <= 0x2069) || // isolates
    code === 0xfeff // BOM used mid-string
  );
}

export function sanitize(raw: unknown, maxLen = 32): Safe {
  if (typeof raw !== "string" || raw.length === 0) return lit("");

  // NFKC folds full-width and other compatibility forms onto their plain
  // equivalents, so "ｉｇｎｏｒｅ" cannot slip past the allowlist as "letters".
  let normalised: string;
  try {
    normalised = raw.normalize("NFKC");
  } catch {
    normalised = raw;
  }

  let out = "";
  for (const ch of normalised) {
    const code = ch.codePointAt(0) ?? 0;
    if (isInvisible(code)) continue;
    if (code < 0x20 || code === 0x7f) {
      out += " ";
      continue;
    }
    if (!ALLOWED.test(ch)) continue;
    out += ch;
  }

  out = out.replace(/\s+/g, " ").trim();
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1).trimEnd()}…`;
  return lit(out);
}

/** Sanitize, falling back to a placeholder when the field is missing or empty. */
export function sanitizeOr(raw: unknown, fallback: string, maxLen = 32): Safe {
  const value = sanitize(raw, maxLen);
  return value === "" ? lit(fallback) : value;
}

/**
 * Protocol homepage, rebuilt from a parsed URL rather than echoed.
 * Query and hash are dropped, which also removes DefiLlama's referral tags.
 */
export function safeUrl(raw: unknown): Safe {
  if (typeof raw !== "string") return lit("");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return lit("");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return lit("");
  if (!/^[a-z0-9.-]+$/i.test(parsed.hostname)) return lit("");
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return sanitize(`${parsed.protocol}//${parsed.hostname}${path}`, 80);
}

/**
 * The same removals for values that will be serialised into the JSON block.
 * JSON.stringify escapes quotes and newlines, but it does not remove a code
 * fence, a chat-template marker or a bidi override — and the JSON block is an
 * output path like any other.
 */
export function sanitizeJson(raw: string, maxLen = 64): string {
  return sanitize(raw, maxLen);
}

/** Recursively sanitize every string in a structure before it is serialised. */
export function deepSanitize(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (typeof value === "string") return sanitizeJson(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map((v) => deepSanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[sanitizeJson(key, 48)] = deepSanitize(v, depth + 1);
    }
    return out;
  }
  return null;
}
