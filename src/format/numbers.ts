import { lit, type Safe } from "./safe.js";

/**
 * Numbers are never echoed back as the strings the API sent. Everything is
 * parsed, checked for finiteness and re-rendered here.
 *
 * "n/a" means we do not know. A zero is printed only when the source actually
 * said zero — a silent zero standing in for "unknown" is the most expensive
 * lie this tool could tell.
 */

export const NA = lit("n/a");

/** Parse a value that may arrive as a number or as a string (Hyperliquid sends strings). */
export function num(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 12.43% — input is already in percent units, as DefiLlama sends it. */
export function pct(value: number | null | undefined, digits = 2): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  return lit(`${value.toFixed(digits)}%`);
}

/** +1.2% / -0.5% — for day-over-day changes. */
export function signedPct(value: number | null | undefined, digits = 1): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const sign = value > 0 ? "+" : "";
  return lit(`${sign}${value.toFixed(digits)}%`);
}

/**
 * Change in a rate, in percentage points. "+0.04pp" rather than "+0.04%",
 * because a change of an APY is not a percentage of anything.
 */
export function signedPp(value: number | null | undefined, digits = 2): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const sign = value > 0 ? "+" : "";
  return lit(`${sign}${value.toFixed(digits)}pp`);
}

/** A fraction in [0,1] rendered as a percentage: 0.612 -> 61.2% */
export function fraction(value: number | null | undefined, digits = 1): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  return lit(`${(value * 100).toFixed(digits)}%`);
}

/** $827.2M */
export function usd(value: number | null | undefined): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e9) return lit(`${sign}$${(abs / 1e9).toFixed(2)}B`);
  if (abs >= 1e6) return lit(`${sign}$${(abs / 1e6).toFixed(1)}M`);
  if (abs >= 1e3) return lit(`${sign}$${(abs / 1e3).toFixed(1)}K`);
  return lit(`${sign}$${abs.toFixed(0)}`);
}

/**
 * $2,999,971.78 — full precision.
 * Used where the reader is looking at their own money: rounding someone's
 * balance to "$3.0M" is the wrong kind of tidy.
 */
export function usdExact(value: number | null | undefined): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const sign = value < 0 ? "-" : "";
  return lit(`${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`);
}

/** 36,614.01 — plain quantity, not a dollar amount. */
export function qty(value: number | null | undefined, digits = 2): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  return lit(
    value.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }),
  );
}

/** Price with a sensible number of digits for its magnitude. */
export function price(value: number | null | undefined): Safe {
  if (value === null || value === undefined || !Number.isFinite(value)) return NA;
  const abs = Math.abs(value);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.001 ? 6 : 8;
  return lit(`$${value.toFixed(digits)}`);
}

/**
 * Hyperliquid funding is an hourly rate expressed as a fraction.
 * Both forms are printed because both are asked for in practice.
 */
export function fundingHourly(rate: number | null): Safe {
  if (rate === null || !Number.isFinite(rate)) return NA;
  return lit(`${(rate * 100).toFixed(4)}%/h`);
}

export function fundingApr(rate: number | null): Safe {
  if (rate === null || !Number.isFinite(rate)) return NA;
  return lit(`${(rate * 24 * 365 * 100).toFixed(2)}%/yr`);
}

/** Percentage change between two prices, as a percent value. */
export function changePct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / before) * 100;
}

/** 12:03 UTC — the moment the data was actually fetched. */
export function utcTime(ms: number): Safe {
  const d = new Date(ms);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return lit(`${hh}:${mm} UTC`);
}

/** 2026-07-26 */
export function utcDate(ms: number): Safe {
  return lit(new Date(ms).toISOString().slice(0, 10));
}
