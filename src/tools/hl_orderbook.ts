import { z } from "zod";
import {
  getOrderBook,
  getPerps,
  getSpot,
  SOURCE as HL,
  type BookLevel,
  type OrderBook,
} from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { price, qty, usd } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize } from "../format/sanitize.js";
import { facts, section, table } from "../format/table.js";

/**
 * How much can actually be traded, and where the data stops.
 *
 * "Can I get out of a $500k position" is a question about execution, not about
 * price, and no other tool here touches it. The catch is that the API returns
 * twenty levels per side — for HYPE, roughly $100–200k of visible size. Walking
 * those twenty levels and reporting a fill price for $500k would mean inventing
 * the liquidity past the last one.
 *
 * So the tool answers the honest half: it walks the book for as long as the
 * book lasts, and when a requested size runs past the end it says so and stops.
 * A refusal that names its own limit is worth more here than a number that
 * reads like an answer.
 */

export const name = "hl_orderbook";

export const description =
  "Resting order book depth for one Hyperliquid market: spread, top of book, and how much size sits " +
  "on each side. Pass size_usd to walk the book for that trade and get the average fill price and " +
  "slippage — or a clear statement that the visible book is not deep enough to answer, which is " +
  "common for large sizes. Answers \"can I actually get in or out at this size\", which price and " +
  "volume alone do not. Read-only, public data, no API key.";

export const inputSchema = {
  symbol: z.string().max(24).describe("Market symbol, e.g. HYPE or BTC. For spot pass the pair, e.g. PURR/USDC."),
  size_usd: z
    .number()
    .min(0)
    .max(1e12)
    .optional()
    .describe("Trade size in USD to simulate against the book. Omitted = depth summary only."),
  market: z.enum(["perp", "spot"]).optional().describe("Which book to read. Default perp."),
};

type Args = { symbol: string; size_usd?: number; market?: "perp" | "spot" };

export async function run(args: Args): Promise<string> {
  const market = args.market ?? "perp";
  const wanted = args.symbol.trim().toUpperCase();

  // Resolved against the market list first: an unknown coin makes the book
  // endpoint answer with an error rather than an empty book, and a typo should
  // read as a typo.
  let coin: string | null = null;
  let label = wanted;
  let known: string[] = [];
  try {
    if (market === "perp") {
      const perps = await getPerps();
      known = perps.value.rows.map((p) => p.name);
      coin = known.includes(wanted) ? wanted : null;
    } else {
      const spot = await getSpot();
      known = spot.value.rows.map((p) => p.name);
      const hit = spot.value.rows.find((p) => p.name.toUpperCase() === wanted);
      coin = hit?.key ?? null;
      if (hit) label = hit.name;
    }
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  if (coin === null) {
    const near = known.filter((s) => s.toUpperCase().startsWith(wanted.slice(0, 2))).slice(0, 6);
    return envelope({
      sources: [{ label: `Hyperliquid ${market}s`, host: "api.hyperliquid.xyz", fetchedAt: Date.now() }],
      body: cat(lit(`No ${market} market named "`), sanitize(wanted, 24), lit('" on Hyperliquid.')),
      notes:
        near.length > 0
          ? [cat(lit("Closest symbols: "), joinSafe(near.map((s) => sanitize(s, 16)), ", "), lit("."))]
          : [lit(market === "spot" ? "Spot markets are named as pairs, e.g. HYPE/USDC." : "Pass a perp symbol such as BTC or HYPE.")],
    });
  }

  let book: OrderBook;
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getOrderBook(coin);
    book = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  const sources = [{ label: "Hyperliquid order book", host: "api.hyperliquid.xyz", fetchedAt, stale }];

  if (book.bids.length === 0 || book.asks.length === 0) {
    return envelope({
      sources,
      body: cat(lit("The book for "), sanitize(label, 24), lit(" is empty on at least one side.")),
      notes: [lit("A market with no resting orders cannot be traded at any size right now.")],
    });
  }

  const bestBid = book.bids[0]!;
  const bestAsk = book.asks[0]!;
  const mid = (bestBid.px + bestAsk.px) / 2;
  const spread = bestAsk.px - bestBid.px;
  const spreadBps = mid > 0 ? (spread / mid) * 10_000 : null;

  const bidDepth = notional(book.bids);
  const askDepth = notional(book.asks);

  const summary = facts([
    ["Market", cat(sanitize(label, 24), lit(` ${market}`))],
    ["Mid price", price(mid)],
    ["Best bid / ask", cat(price(bestBid.px), lit(" / "), price(bestAsk.px))],
    // The spread is shown at the precision of the price it belongs to. Sizing
    // the digits to the difference itself turns a one-tick spread on a $58
    // asset into "$0.00100000", which is accurate and unreadable.
    ["Spread", cat(spreadAt(spread, mid), lit(" · "), spreadBps === null ? lit("n/a") : lit(`${spreadBps.toFixed(1)} bps`))],
    ["Visible bid depth", cat(usd(bidDepth), lit(` across ${book.bids.length} levels`))],
    ["Visible ask depth", cat(usd(askDepth), lit(` across ${book.asks.length} levels`))],
  ]);

  const ladder = table(
    ["Bid size", "Bid", "Ask", "Ask size"],
    book.bids.slice(0, 8).map((b, i) => {
      const a = book.asks[i];
      return [
        qty(b.sz, 2),
        price(b.px),
        a ? price(a.px) : lit("—"),
        a ? qty(a.sz, 2) : lit("—"),
      ];
    }),
    ["right", "right", "left", "left"],
  );

  const notes: Safe[] = [
    lit(
      `The API returns at most 20 levels per side, so the depth above is what is visible, not the whole book. Resting orders beyond the last level are not published and are not guessed at here.`,
    ),
    lit("Depth is a snapshot of resting orders. It says nothing about what would be added or pulled once a large order started filling."),
  ];

  const blocks: Safe[] = [section(`${sanitizeLabel(label)} order book`, summary), ladder];

  if (args.size_usd !== undefined && args.size_usd > 0) {
    blocks.push(walk(args.size_usd, book, mid));
  }

  return envelope({
    sources,
    body: joinSafe(blocks, "\n\n"),
    notes,
    data: {
      market: sanitize(label, 24),
      kind: market,
      mid_price: mid,
      best_bid: bestBid.px,
      best_ask: bestAsk.px,
      spread_bps: spreadBps,
      visible_bid_depth_usd: bidDepth,
      visible_ask_depth_usd: askDepth,
      levels_per_side: Math.min(book.bids.length, book.asks.length),
    },
  });
}

function notional(levels: BookLevel[]): number {
  return levels.reduce((sum, l) => sum + l.px * l.sz, 0);
}

/** A difference rendered at the precision of the price it was taken from. */
function spreadAt(diff: number, reference: number): Safe {
  const abs = Math.abs(reference);
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 4 : abs >= 0.001 ? 6 : 8;
  return lit(`$${diff.toFixed(digits)}`);
}

/**
 * Walk the book for a given size, in both directions.
 *
 * The result is deliberately allowed to be "cannot answer". Filling the gap by
 * extending the last level, or by quoting the average of what did fill as if it
 * were the whole trade, would turn a limit of the data into a wrong number.
 */
function walk(sizeUsd: number, book: OrderBook, mid: number): Safe {
  const rows: Safe[][] = [];
  for (const [side, levels] of [
    ["Sell into bids", book.bids],
    ["Buy from asks", book.asks],
  ] as const) {
    let remaining = sizeUsd;
    let filledUsd = 0;
    let filledUnits = 0;
    for (const level of levels) {
      if (remaining <= 0) break;
      const levelUsd = level.px * level.sz;
      const take = Math.min(remaining, levelUsd);
      filledUsd += take;
      filledUnits += take / level.px;
      remaining -= take;
    }
    const complete = remaining <= 0.000001;
    const avg = filledUnits > 0 ? filledUsd / filledUnits : null;
    const slipBps = avg !== null && mid > 0 ? (Math.abs(avg - mid) / mid) * 10_000 : null;
    rows.push([
      lit(side),
      complete ? lit("fills") : lit("does NOT fill"),
      complete && avg !== null ? price(avg) : lit("n/a"),
      complete && slipBps !== null ? lit(`${slipBps.toFixed(1)} bps`) : lit("n/a"),
      usd(filledUsd),
    ]);
  }

  const both = rows.every((r) => r[1] === "fills");
  const note = both
    ? lit("Both sides fill inside the visible book. The average price above is what those levels imply, before fees and before anyone reacts to the order.")
    : lit(
        "At least one side does not fill within the twenty published levels. The tool stops there rather than extending the book: how much size waits beyond the last level is not public data, and inventing it is how a slippage estimate becomes a wrong number.",
      );

  return cat(
    section(
      `Walking the book for ${usd(sizeUsd)}`,
      table(
        ["Direction", "Result", "Avg fill", "Slippage", "Filled"],
        rows,
        ["left", "left", "right", "right", "right"],
      ),
    ),
    lit("\n\n"),
    note,
  );
}

function sanitizeLabel(symbol: string): string {
  return symbol.replace(/[^A-Za-z0-9/]/g, "").slice(0, 16);
}
