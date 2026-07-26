import { z } from "zod";
import { getPoolHistory, getPools, getProtocols, type Pool, type PoolPoint } from "../clients/defillama.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { pct, signedPct, signedPp, usd } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize, sanitizeOr } from "../format/sanitize.js";
import { facts, section, table } from "../format/table.js";

/**
 * One pool over time.
 *
 * Every other tool here reports a rate as of now, which a reader has to take
 * on trust. This one shows the series behind it, split into what the pool
 * earns and what it emits. That split is the whole point: a 46% headline made
 * of emissions and a 46% headline made of fees are different products, and the
 * only way to tell them apart from the outside is to watch the reward
 * component over a few weeks.
 */

export const name = "hyperevm_pool_history";

export const description =
  "How one pool's APY and TVL moved over the past weeks, separating yield the pool earned from yield " +
  "paid out in emitted tokens. Answers whether a headline rate is stable, decaying, or propped up by " +
  "rewards that can stop, and lets a number from hyperevm_yields be checked against its own history. " +
  "Pass a pool by symbol, e.g. kHYPE or WHYPE-USDC. Read-only, public data, no API key.";

export const inputSchema = {
  pool: z
    .string()
    .max(48)
    .describe('Pool symbol, optionally with the project, e.g. "kHYPE" or "hyperlend USDC".'),
  days: z
    .number()
    .int()
    .min(7)
    .max(180)
    .optional()
    .describe("How far back to look. Default 30, maximum 180."),
};

type Args = { pool: string; days?: number };

export async function run(args: Args): Promise<string> {
  const days = args.days ?? 30;

  let pools: Pool[];
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getPools();
    pools = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `DefiLlama: ${describe(err)}`);
  }

  const sources = [{ label: "DefiLlama yields", host: "yields.llama.fi", fetchedAt, stale }];
  const match = resolve(pools, args.pool);

  if (match.kind === "none") {
    return envelope({
      sources,
      body: cat(lit('No pool on Hyperliquid matches "'), sanitize(args.pool, 32), lit('".')),
      notes: [lit("Run hyperevm_yields first to see the pools that exist, then pass one of those symbols.")],
    });
  }

  if (match.kind === "ambiguous") {
    // The same symbol on the same project happens — Morpho lists four separate
    // KHYPE markets — so the list has to carry TVL and the pool label, or it
    // shows four identical lines and the reader cannot pick one.
    const shownCandidates = match.candidates.slice(0, 8);
    const list = shownCandidates.map((p) =>
      cat(
        lit("- "),
        sanitizeOr(p.symbol, "?", 24),
        lit(" · "),
        sanitize(p.project, 28),
        p.poolMeta === null ? lit("") : cat(lit(" · "), sanitize(p.poolMeta, 28)),
        lit(" · "),
        usd(p.tvlUsd),
      ),
    );
    const notes: Safe[] = [
      lit('Include the project name to narrow it, e.g. "hyperlend USDC".'),
    ];
    if (match.candidates.length > shownCandidates.length) {
      notes.push(
        lit(`${match.candidates.length - shownCandidates.length} further matches not listed; narrow the query.`),
      );
    }
    return envelope({
      sources,
      body: cat(
        lit('"'),
        sanitize(args.pool, 32),
        lit(`" matches ${match.candidates.length} pools:\n\n`),
        joinSafe(list, "\n"),
      ),
      notes,
    });
  }

  const pool = match.pool;
  let points: PoolPoint[];
  try {
    const res = await getPoolHistory(pool.id);
    points = res.value;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `DefiLlama: ${describe(err)}`);
  }

  const window = points.slice(-days);
  if (window.length < 2) {
    return envelope({
      sources,
      body: cat(lit("History for "), sanitizeOr(pool.symbol, "?", 24), lit(" is too short to show a trend.")),
      notes: [lit(`The source returned ${points.length} point(s). Pools listed recently have little history.`)],
    });
  }

  const now = window[window.length - 1]!;
  const then = window[0]!;
  const weekAgo = window.length > 7 ? window[window.length - 8]! : then;

  const projectName = await displayName(pool.project);

  const summary = facts([
    ["Pool", sanitizeOr(pool.symbol, "?", 28)],
    ["Project", projectName],
    ["APY now", pct(now.apy)],
    ["APY 7d ago", pct(weekAgo.apy)],
    [`APY ${window.length}d ago`, pct(then.apy)],
    ["Change over window", signedPp(delta(now.apy, then.apy))],
    ["Earned vs emitted now", split(now)],
    ["TVL now", usd(now.tvlUsd)],
    // A TVL move is a percentage change; only the APY line is in points.
    ["TVL change over window", signedPct(deltaPct(now.tvlUsd, then.tvlUsd))],
  ]);

  // Roughly ten rows whatever the window, so a 180-day request stays readable.
  const step = Math.max(1, Math.ceil(window.length / 10));
  const sampled = window.filter((_, i) => i % step === 0 || i === window.length - 1);

  const series = table(
    ["Date (UTC)", "APY", "Earned", "Emitted", "TVL"],
    sampled.map((p) => [
      lit(p.timestamp.slice(0, 10)),
      pct(p.apy),
      pct(p.apyBase),
      pct(p.apyReward),
      usd(p.tvlUsd),
    ]),
    ["left", "right", "right", "right", "right"],
  );

  const notes: Safe[] = [
    lit("Earned is apyBase — fees and interest the pool produced. Emitted is apyReward — tokens paid out by the protocol, which stop whenever the issuing team decides they stop."),
  ];

  const emissionShare = share(now);
  if (emissionShare !== null && emissionShare > 0.5) {
    notes.push(
      lit(
        `Right now ${(emissionShare * 100).toFixed(0)}% of this pool's APY is emissions rather than earned yield.`,
      ),
    );
  }
  if (now.apyBase === null && now.apy !== null) {
    notes.push(lit("The source does not split this pool into earned and emitted, so both columns read n/a."));
  }
  if (points.length > window.length) {
    notes.push(lit(`${points.length} days available; showing the last ${window.length}. Raise days to see more.`));
  }
  notes.push(lit(`Sampled every ${step} day(s) to keep the table readable; the summary above uses every point.`));

  return envelope({
    sources,
    body: joinSafe([section("Pool history", summary), series], "\n\n"),
    data: {
      pool: sanitizeOr(pool.symbol, "?", 28),
      project: projectName,
      window_days: window.length,
      apy_now_pct: now.apy,
      apy_7d_ago_pct: weekAgo.apy,
      apy_window_start_pct: then.apy,
      apy_base_now_pct: now.apyBase,
      apy_reward_now_pct: now.apyReward,
      tvl_now_usd: now.tvlUsd,
      tvl_window_start_usd: then.tvlUsd,
    },
  });
}

type Match =
  | { kind: "one"; pool: Pool }
  | { kind: "ambiguous"; candidates: Pool[] }
  | { kind: "none" };

/**
 * Resolve a human string to one pool.
 *
 * Symbols repeat across projects — "USDC" exists on four lending markets — so
 * an ambiguous query lists the candidates rather than picking the largest and
 * hoping. Guessing here would attach a real history chart to the wrong pool.
 */
function resolve(pools: Pool[], query: string): Match {
  const q = query.trim().toLowerCase();
  if (q === "") return { kind: "none" };

  const words = q.split(/\s+/).filter(Boolean);
  const score = (p: Pool): boolean => {
    const hay = `${p.symbol} ${p.project} ${p.poolMeta ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  };

  const exact = pools.filter((p) => p.symbol.toLowerCase() === q);
  const candidates = exact.length > 0 ? exact : pools.filter(score);

  if (candidates.length === 0) return { kind: "none" };
  if (candidates.length === 1) return { kind: "one", pool: candidates[0]! };

  // One pool holding most of the TVL is the one a person means; a close field
  // is a genuine question and gets asked back.
  const sorted = [...candidates].sort((a, b) => (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0));
  const total = sorted.reduce((sum, p) => sum + (p.tvlUsd ?? 0), 0);
  const leader = sorted[0]!;
  if (total > 0 && (leader.tvlUsd ?? 0) / total >= 0.8) return { kind: "one", pool: leader };
  return { kind: "ambiguous", candidates: sorted };
}

async function displayName(slug: string): Promise<Safe> {
  try {
    const { value } = await getProtocols();
    const hit = value.find((p) => p.slug === slug);
    if (hit) return sanitizeOr(hit.name, slug, 32);
  } catch {
    // The slug is a fine fallback; a failed lookup is not worth losing the tool over.
  }
  return sanitize(slug, 32);
}

function delta(now: number | null, then: number | null): number | null {
  if (now === null || then === null) return null;
  return now - then;
}

function deltaPct(now: number | null, then: number | null): number | null {
  if (now === null || then === null || then === 0) return null;
  return ((now - then) / then) * 100;
}

function share(p: PoolPoint): number | null {
  if (p.apy === null || p.apy <= 0 || p.apyReward === null) return null;
  return p.apyReward / p.apy;
}

function split(p: PoolPoint): Safe {
  if (p.apyBase === null && p.apyReward === null) return lit("n/a");
  return cat(pct(p.apyBase), lit(" earned · "), pct(p.apyReward), lit(" emitted"));
}
