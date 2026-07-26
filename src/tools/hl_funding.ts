import { z } from "zod";
import {
  getFundingHistory,
  getPerps,
  getPredictedFundings,
  SOURCE as HL,
  type FundingPoint,
} from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { fundingApr, fundingHourly, pct } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize } from "../format/sanitize.js";
import { facts, section, table } from "../format/table.js";

/**
 * How funding has actually behaved, rather than what it happens to be now.
 *
 * `hl_market` answers "what is funding on BTC" with a single number. That
 * number is close to useless for the decision people actually make with it —
 * holding spot against a short perp — because one hour is noise. What matters
 * is whether the sign has held and how wide the swings were, and the API
 * returns one point per hour, so a week is 168 of them.
 *
 * Nothing here is a recommendation. The tool reports how the rate behaved and
 * what it would have paid; whether that is worth the risk is not its business.
 */

export const name = "hl_funding";

export const description =
  "Funding rate history for one Hyperliquid perp — how the rate actually behaved over the past days, " +
  "not just its value right now: average, range, how much of the time it stayed positive, and what " +
  "holding the position would have paid. Includes the current predicted rate on Binance and Bybit for " +
  "comparison. Use this when the question is whether a funding spread is durable rather than what it " +
  "is this hour. Read-only, public data, no API key.";

export const inputSchema = {
  symbol: z.string().max(24).describe('Perp symbol, e.g. BTC or HYPE.'),
  days: z
    .number()
    .int()
    .min(1)
    .max(14)
    .optional()
    .describe("How far back to look. Default 7, maximum 14."),
};

type Args = { symbol: string; days?: number };

interface DayBucket {
  label: string;
  points: FundingPoint[];
}

export async function run(args: Args): Promise<string> {
  const days = args.days ?? 7;
  const wanted = args.symbol.trim().toUpperCase();

  // The symbol is checked against the market list first, because asking for
  // funding on a coin that does not exist returns HTTP 500 rather than an
  // empty series — which the retry then dutifully repeats, and which surfaces
  // to the reader as "the source is broken" instead of "no such market".
  let listed: string[] = [];
  try {
    const perps = await getPerps();
    listed = perps.value.rows.map((p) => p.name);
  } catch {
    // If the list is unreachable, fall through and let the history call decide.
  }
  if (listed.length > 0 && !listed.includes(wanted)) {
    const near = listed.filter((s) => s.startsWith(wanted.slice(0, 2))).slice(0, 6);
    return envelope({
      sources: [{ label: "Hyperliquid perps", host: "api.hyperliquid.xyz", fetchedAt: Date.now() }],
      body: cat(lit('No perp market named "'), sanitize(wanted, 24), lit('" on Hyperliquid.')),
      notes:
        near.length > 0
          ? [cat(lit("Closest symbols: "), joinSafe(near.map((s) => sanitize(s, 12)), ", "), lit("."))]
          : [lit("Pass a perp symbol such as BTC, ETH or HYPE.")],
    });
  }

  let history: FundingPoint[];
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getFundingHistory(wanted, days * 24, Date.now());
    history = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  const sources = [
    { label: "Hyperliquid funding history", host: "api.hyperliquid.xyz", fetchedAt, stale },
  ];

  if (history.length === 0) {
    return envelope({
      sources,
      body: cat(lit("No funding recorded for "), sanitize(wanted, 24), lit(` in the last ${days} day(s).`)),
      notes: [lit("A market listed very recently has no history yet.")],
    });
  }

  const rates = history.map((p) => p.rate);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const positiveHours = rates.filter((r) => r > 0).length;
  const latest = history[history.length - 1]!;

  // What one unit of exposure would have paid over the window. Funding accrues
  // hourly, so this is the sum, not the mean annualised over the period.
  const paid = rates.reduce((a, b) => a + b, 0);

  const summary = facts([
    ["Market", cat(sanitize(wanted, 24), lit(" perp"))],
    ["Latest hourly", cat(fundingHourly(latest.rate), lit(" · "), fundingApr(latest.rate))],
    [`Average over ${days}d`, cat(fundingHourly(mean), lit(" · "), fundingApr(mean))],
    ["Range", cat(fundingHourly(min), lit(" to "), fundingHourly(max))],
    [
      "Positive hours",
      lit(
        `${positiveHours} of ${rates.length} (${((positiveHours / rates.length) * 100).toFixed(0)}%)`,
      ),
    ],
    ["Total over window", pct(paid * 100, 3)],
  ]);

  const buckets = bucketByDay(history);
  const daily = table(
    ["Day (UTC)", "Avg hourly", "Annualised", "Low", "High", "Hours +"],
    buckets.map((b) => {
      const r = b.points.map((p) => p.rate);
      const avg = r.reduce((a, x) => a + x, 0) / r.length;
      return [
        lit(b.label),
        fundingHourly(avg),
        fundingApr(avg),
        fundingHourly(Math.min(...r)),
        fundingHourly(Math.max(...r)),
        lit(`${r.filter((x) => x > 0).length}/${r.length}`),
      ];
    }),
    ["left", "right", "right", "right", "right", "right"],
  );

  const notes: Safe[] = [
    lit(
      "Positive funding means longs pay shorts. Holding spot against a short perp collects it; the sign flipping is what turns that trade against you.",
    ),
    lit(
      `Total over window is the sum of ${rates.length} hourly rates — what one unit of exposure would have paid or received, before fees and slippage.`,
    ),
    lit("Hyperliquid settles funding hourly. Binance and Bybit settle every 8 hours, so their rates are not directly comparable without the interval."),
  ];

  const venues = await venueTable(wanted);
  const blocks = [section(`${sanitizeLabel(wanted)} funding`, summary), daily];
  if (venues) blocks.push(venues);
  const body = joinSafe(blocks, "\n\n");

  return envelope({
    sources,
    body,
    notes,
    data: {
      market: sanitize(wanted, 24),
      window_days: days,
      hours: rates.length,
      latest_hourly: latest.rate,
      mean_hourly: mean,
      mean_apr: mean * 24 * 365,
      min_hourly: min,
      max_hourly: max,
      positive_hours: positiveHours,
      total_over_window_pct: paid * 100,
    },
  });
}

/** Group hourly points into UTC days, newest last. */
function bucketByDay(points: FundingPoint[]): DayBucket[] {
  const byDay = new Map<string, FundingPoint[]>();
  for (const p of points) {
    const label = new Date(p.time).toISOString().slice(0, 10);
    const list = byDay.get(label);
    if (list) list.push(p);
    else byDay.set(label, [p]);
  }
  return [...byDay.entries()].map(([label, list]) => ({ label, points: list }));
}

/** The same cross-venue block `hl_market` shows, because the comparison belongs here too. */
async function venueTable(symbol: string): Promise<Safe | null> {
  try {
    const { value } = await getPredictedFundings();
    const venues = value.get(symbol);
    if (!venues || venues.length === 0) return null;
    return section(
      "Predicted funding by venue",
      table(
        ["Venue", "Rate", "Interval", "Annualised"],
        venues.map((v) => [
          sanitize(v.venue, 16),
          fundingHourly(v.rate),
          v.intervalHours === null ? lit("n/a") : lit(`${v.intervalHours}h`),
          v.rate === null || v.intervalHours === null
            ? lit("n/a")
            : pct((v.rate / v.intervalHours) * 24 * 365 * 100),
        ]),
        ["left", "right", "right", "right"],
      ),
    );
  } catch {
    // A missing comparison is not a reason to lose the history above it.
    return null;
  }
}

function sanitizeLabel(symbol: string): string {
  return symbol.replace(/[^A-Z0-9]/g, "").slice(0, 12);
}
