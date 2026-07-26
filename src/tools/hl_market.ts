import { z } from "zod";
import {
  getPerps,
  getPredictedFundings,
  getSpot,
  SOURCE as HL,
  type Perp,
  type SpotPair,
} from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure, type Source } from "../format/envelope.js";
import { changePct, fundingApr, fundingHourly, price, qty, signedPct, usd } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize, sanitizeOr } from "../format/sanitize.js";
import { facts, section, subsection, table } from "../format/table.js";

/**
 * Hyperliquid market data: perps and spot.
 *
 * Perp contexts are aligned with the universe by index. Spot contexts are not —
 * they are joined by name, because the two arrays have different lengths and
 * the universe has gaps where pairs were delisted.
 */

export const name = "hl_market";

export const description =
  "Prices and market state on Hyperliquid right now: perp mark and oracle price, 24h move, funding " +
  "(hourly and annualised), open interest, volume and max leverage, plus spot pair prices. Pass a " +
  "symbol for one market with predicted funding on Hyperliquid, Binance and Bybit side by side. " +
  "This is the current snapshot; for how funding behaved over past days use hl_funding. " +
  "Read-only, public data, no API key.";

export const inputSchema = {
  symbol: z.string().max(24).optional().describe("Market symbol, e.g. BTC or PURR. Omitted = top by volume."),
  market: z.enum(["perp", "spot"]).optional().describe("Which book to read. Default perp."),
  limit: z.number().int().min(1).max(50).optional().describe("Rows in the list. Default 10."),
};

type Args = { symbol?: string; market?: "perp" | "spot"; limit?: number };

export async function run(args: Args): Promise<string> {
  const market = args.market ?? "perp";
  const limit = args.limit ?? 10;
  const symbol = args.symbol?.trim().toUpperCase() ?? "";

  return market === "spot" ? spot(symbol, limit) : perp(symbol, limit);
}

async function perp(symbol: string, limit: number): Promise<string> {
  let rows: Perp[];
  let warning: string | null;
  const sources: Source[] = [];
  const notes: Safe[] = [];

  try {
    const res = await getPerps();
    rows = res.value.rows;
    warning = res.value.warning;
    sources.push({
      label: "Hyperliquid perps",
      host: "api.hyperliquid.xyz",
      fetchedAt: res.fetchedAt,
      stale: res.stale,
    });
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }
  if (warning) notes.push(lit(warning));

  if (symbol === "") {
    const shown = [...rows].sort((a, b) => (b.dayNtlVlm ?? 0) - (a.dayNtlVlm ?? 0)).slice(0, limit);
    notes.push(lit(`${rows.length} live perp markets. Pass symbol="BTC" for one market in detail.`));
    return envelope({
      sources,
      body: section(
        `Hyperliquid perps — top ${shown.length} by 24h volume`,
        table(
          ["Market", "Price", "24h", "Funding/h", "Funding APR", "Open interest", "24h volume"],
          shown.map((p) => [
            sanitizeOr(p.name, "?", 12),
            price(p.markPx),
            signedPct(changePct(p.markPx, p.prevDayPx)),
            fundingHourly(p.funding),
            fundingApr(p.funding),
            usd(oiUsd(p)),
            usd(p.dayNtlVlm),
          ]),
          ["left", "right", "right", "right", "right", "right", "right"],
        ),
      ),
      notes,
      data: shown.map(serialise),
    });
  }

  const found = rows.find((p) => p.name.toUpperCase() === symbol);
  if (!found) {
    const near = rows
      .filter((p) => p.name.toUpperCase().startsWith(symbol.slice(0, 2)))
      .slice(0, 8)
      .map((p) => sanitizeOr(p.name, "?", 12));
    return envelope({
      sources,
      body: cat(lit('No perp market named "'), sanitize(symbol, 24), lit('" on Hyperliquid.')),
      notes:
        near.length > 0
          ? [cat(lit("Closest symbols: "), joinSafe(near, ", "), lit("."))]
          : [lit("Call without a symbol to list markets.")],
    });
  }

  const market = sanitizeOr(found.name, "?", 12);
  const pairs: Array<[string, Safe]> = [
    ["Market", cat(market, lit(" perp"))],
    ["Mark price", price(found.markPx)],
    ["Oracle price", price(found.oraclePx)],
    ["24h change", signedPct(changePct(found.markPx, found.prevDayPx))],
    ["Funding", cat(fundingHourly(found.funding), lit(" · "), fundingApr(found.funding))],
    ["Open interest", cat(usd(oiUsd(found)), lit(" ("), qty(found.openInterest), lit(" "), market, lit(")"))],
    ["24h volume", usd(found.dayNtlVlm)],
    ["Max leverage", found.maxLeverage === null ? lit("n/a") : lit(`${found.maxLeverage}x`)],
  ];

  // Predicted funding across venues is optional context: if it fails, the
  // market card is still correct and complete on its own.
  let venueBlock: Safe = lit("");
  try {
    const predicted = await getPredictedFundings();
    const venues = predicted.value.get(found.name);
    if (venues && venues.length > 0) {
      sources.push({
        label: "Hyperliquid predicted funding",
        host: "api.hyperliquid.xyz",
        fetchedAt: predicted.fetchedAt,
        stale: predicted.stale,
      });
      venueBlock = cat(
        lit("\n\n"),
        subsection(
          "Predicted funding by venue",
          table(
            ["Venue", "Rate", "Interval", "Annualised"],
            venues.map((v) => [
              sanitizeOr(v.venue, "?", 16),
              v.rate === null ? lit("n/a") : lit(`${(v.rate * 100).toFixed(4)}%`),
              v.intervalHours === null ? lit("n/a") : lit(`${v.intervalHours}h`),
              v.rate === null || v.intervalHours === null
                ? lit("n/a")
                : lit(`${(v.rate * (8760 / v.intervalHours) * 100).toFixed(2)}%`),
            ]),
            ["left", "right", "right", "right"],
          ),
        ),
      );
    }
  } catch (err) {
    notes.push(lit(`predicted funding unavailable (${err instanceof SourceError ? err.message : HL})`));
  }

  return envelope({
    sources,
    body: cat(lit("## "), market, lit(" perp\n\n"), facts(pairs), venueBlock),
    notes,
    data: { ...serialise(found), oracle_px: found.oraclePx, max_leverage: found.maxLeverage },
  });
}

async function spot(symbol: string, limit: number): Promise<string> {
  let rows: SpotPair[];
  let warning: string | null;
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getSpot();
    rows = res.value.rows;
    warning = res.value.warning;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  const sources: Source[] = [{ label: "Hyperliquid spot", host: "api.hyperliquid.xyz", fetchedAt, stale }];
  const notes: Safe[] = [];
  if (warning) notes.push(lit(warning));

  const selected =
    symbol === ""
      ? [...rows].sort((a, b) => (b.dayNtlVlm ?? 0) - (a.dayNtlVlm ?? 0)).slice(0, limit)
      : rows.filter((p) => p.name.toUpperCase().startsWith(`${symbol}/`) || p.name.toUpperCase() === symbol);

  if (selected.length === 0) {
    return envelope({
      sources,
      body: cat(lit('No spot pair matching "'), sanitize(symbol, 24), lit('" on Hyperliquid.')),
      notes: [lit("Call without a symbol to list the most traded pairs.")],
    });
  }

  notes.push(lit(`${rows.length} spot pairs have live market data.`));

  return envelope({
    sources,
    body: section(
      symbol === "" ? `Hyperliquid spot — top ${selected.length} by 24h volume` : "Hyperliquid spot",
      table(
        ["Pair", "Price", "24h", "24h volume", "Circulating"],
        selected.map((p) => [
          sanitizeOr(p.name, "?", 20),
          price(p.midPx ?? p.markPx),
          signedPct(changePct(p.midPx ?? p.markPx, p.prevDayPx)),
          usd(p.dayNtlVlm),
          qty(p.circulatingSupply, 0),
        ]),
        ["left", "right", "right", "right", "right"],
      ),
    ),
    notes,
    data: selected.map((p) => ({
      pair: sanitizeOr(p.name, "?", 20),
      price: p.midPx ?? p.markPx,
      change_24h_pct: changePct(p.midPx ?? p.markPx, p.prevDayPx),
      volume_24h_usd: p.dayNtlVlm,
      circulating_supply: p.circulatingSupply,
    })),
  });
}

function serialise(p: Perp) {
  return {
    market: sanitizeOr(p.name, "?", 12),
    mark_px: p.markPx,
    change_24h_pct: changePct(p.markPx, p.prevDayPx),
    funding_hourly: p.funding,
    funding_apr: p.funding === null ? null : p.funding * 24 * 365,
    open_interest_usd: oiUsd(p),
    volume_24h_usd: p.dayNtlVlm,
  };
}

/** Open interest is reported in base units; dollars are what people mean. */
function oiUsd(p: Perp): number | null {
  if (p.openInterest === null || p.markPx === null) return null;
  return p.openInterest * p.markPx;
}
