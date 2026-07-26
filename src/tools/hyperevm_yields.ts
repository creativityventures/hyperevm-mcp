import { z } from "zod";
import {
  getBorrowRows,
  getPools,
  getProtocols,
  SOURCE as LLAMA,
  type BorrowRow,
  type Pool,
  type Protocol,
} from "../clients/defillama.js";
import {
  getValidators,
  getVault,
  HLP_VAULT,
  SOURCE as HL,
  stakingAprRange,
  type Vault,
} from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure, type Source } from "../format/envelope.js";
import { fraction, pct, signedPct, signedPp, usd } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize, sanitizeOr } from "../format/sanitize.js";
import { section, table } from "../format/table.js";

/**
 * The reason this server exists.
 *
 * Every yield on HYPE in one table: liquid staking, lending, and everything
 * else built on top. Three details make it correct where a naive integration
 * is not:
 *
 *  - lending rates come from /lendBorrow joined on the pool uuid, because
 *    /pools alone reports 0.00% for collateral markets;
 *  - liquid staking protocols with no published pool (stHYPE at $170M,
 *    beHYPE) are shown with an explicit n/a rather than dropped or invented;
 *  - the network staking APR is printed as a baseline, so a number far above
 *    it is visibly a reward, not magic.
 */

export const name = "hyperevm_yields";

export const description =
  "Every way to earn on Hyperliquid / HyperEVM, ranked in one table: liquid staking tokens " +
  "(kHYPE, stHYPE, beHYPE), lending markets with supply and borrow rates, utilisation and max LTV, " +
  "and LP or looping pools. Separates yield a pool earns from yield paid in emitted tokens, and " +
  "anchors everything against what the network itself pays for staking. Start here for " +
  "\"where is the best yield\"; use hyperevm_pool_history to see whether one of these rates has held. " +
  "Read-only, public data, no API key.";

export const inputSchema = {
  category: z
    .enum(["lst", "lending", "other", "all"])
    .optional()
    .describe("lst = liquid staking, lending = money markets, other = LP/looping/PT, all = everything (default)"),
  min_tvl: z
    .number()
    .min(0)
    .max(1e12)
    .optional()
    .describe("Minimum pool TVL in USD. Default 1000000."),
  limit: z.number().int().min(1).max(50).optional().describe("Rows per section. Default 10."),
};

type Args = {
  category?: "lst" | "lending" | "other" | "all";
  min_tvl?: number;
  limit?: number;
};

interface Row {
  project: Safe;
  label: Safe;
  apy: number | null;
  /** The part that is earned rather than emitted. The distinction matters. */
  apyBase: number | null;
  apyReward: number | null;
  apy7d: number | null;
  tvl: number | null;
  supplyApy?: number | null;
  borrowApy?: number | null;
  utilization?: number | null;
  /** Max loan-to-value for this collateral. "Is it safe to borrow" is mostly this number. */
  ltv?: number | null;
  ilRisk: Safe;
}

/**
 * The HLP vault, rendered from returns computed here rather than from the
 * source's own APR field.
 *
 * The response carries `apr`. It is not printed: read as an annual fraction it
 * says 0.07%, read as a daily one it says 25.8% a year, and the vault's own
 * history — which puts the last month between -0.3% and +1.7% annualised —
 * supports the first without confirming it. Printing either would be guessing
 * at a unit, which is how the audit code and the weekly delta both went wrong.
 *
 * What is printed instead is realised PnL per window, divided here, labelled
 * with the window it covers and not annualised. Nobody has to trust a
 * convention for that number to mean what it says.
 */
async function vaultSection(): Promise<
  { body: Safe; data: unknown; notes: Safe[]; fetchedAt: number; stale: boolean } | null
> {
  let vault: Vault;
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getVault(HLP_VAULT);
    vault = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch {
    // The vault is an addition to this table, not its subject. If it cannot be
    // read, the rest of the answer still stands.
    return null;
  }

  if (vault.accountValue === null && vault.windows.length === 0) return null;

  const byPeriod = new Map(vault.windows.map((w) => [w.period, w]));
  const cell = (period: string): Safe => {
    const w = byPeriod.get(period);
    if (!w || w.returnFraction === null) return lit("n/a");
    return signedPct(w.returnFraction * 100, 3);
  };

  const rows = [
    [
      sanitizeOr(vault.name, "Hyperliquidity Provider (HLP)", 30),
      usd(vault.accountValue),
      cell("day"),
      cell("week"),
      cell("month"),
    ],
  ];

  return {
    fetchedAt,
    stale,
    body: section(
      "Protocol vaults",
      table(["Vault", "TVL", "24h", "7d", "30d"], rows, ["left", "right", "right", "right", "right"]),
    ),
    notes: [
      lit(
        "Vault columns are realised profit and loss over that window, as a share of the capital the window started with — not an annualised rate. They are computed here from the vault's own account history.",
      ),
      // Deliberately without the candidate values. Quoting them to explain the
      // omission would put a number in front of a reader who is looking for
      // exactly that number, which defeats leaving it out.
      lit(
        "The source also publishes an APR figure for this vault. It is not shown: the field means very different things depending on whether it is an annual or a daily rate, and the vault's own history does not settle which. An unconfirmed unit is not printed.",
      ),
      lit("HLP has no yield pool on DefiLlama, so it is absent from the tables above and read separately from Hyperliquid."),
    ],
    data: [
      {
        vault: sanitizeOr(vault.name, "HLP", 30),
        tvl_usd: vault.accountValue,
        realised_return_pct: Object.fromEntries(
          vault.windows.map((w) => [w.period, w.returnFraction === null ? null : w.returnFraction * 100]),
        ),
        apr_field_not_shown_reason: "source unit unconfirmed",
      },
    ],
  };
}

/**
 * The provider's own 7-day delta, with one failure mode filtered out.
 *
 * `apyPct7D` is usually right — checked against the daily series for the same
 * pools, it agrees to the second decimal. But its reference point is a single
 * sample from a week ago, and when that sample is bad the field is badly wrong:
 * for kHYPE it reported +1.93pp against a true move of +0.00pp, because the
 * stored value for that day was near zero.
 *
 * The signature of that failure is specific — the delta accounts for almost the
 * entire current APY, implying the pool paid nothing a week ago. Where that
 * holds, the number is dropped rather than printed. A pool that genuinely
 * started from zero loses a true figure to n/a, which is the direction this
 * project errs in on purpose. `hyperevm_pool_history` recomputes the move from
 * the daily series when the answer matters.
 */
function trusted7d(apy: number | null, change: number | null): number | null {
  if (change === null || apy === null) return change;
  if (apy <= 0.1) return change;
  const impliedBefore = apy - change;
  return impliedBefore <= apy * 0.01 ? null : change;
}

/**
 * A pool whose yield is mostly token emissions is a different product from one
 * that earns its rate. Emissions stop when a team decides they stop.
 */
function emissionDriven(row: Row): boolean {
  if (row.apy === null || row.apy <= 0) return false;
  const reward = row.apyReward ?? 0;
  return reward / row.apy >= 0.5;
}

export async function run(args: Args): Promise<string> {
  const category = args.category ?? "all";
  const minTvl = args.min_tvl ?? 1_000_000;
  const limit = args.limit ?? 10;

  let pools: Pool[];
  let borrow: Map<string, BorrowRow>;
  let protocols: Protocol[];
  const sources: Source[] = [];
  const notes: Safe[] = [];

  try {
    const [poolsRes, borrowRes, protocolsRes] = await Promise.all([
      getPools(),
      getBorrowRows(),
      getProtocols(),
    ]);
    pools = poolsRes.value;
    borrow = borrowRes.value;
    protocols = protocolsRes.value;
    sources.push({ label: "DefiLlama yields", host: "yields.llama.fi", fetchedAt: poolsRes.fetchedAt, stale: poolsRes.stale });
    sources.push({ label: "DefiLlama protocols", host: "api.llama.fi", fetchedAt: protocolsRes.fetchedAt, stale: protocolsRes.stale });
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${LLAMA}: ${describe(err)}`);
  }

  // Baseline: what plain staking pays. Optional — a failure here must not take
  // the whole tool down, it only removes one line of context.
  let baseline: Safe = lit("");
  try {
    const validators = await getValidators();
    const range = stakingAprRange(validators.value);
    if (range) {
      baseline = cat(
        lit("Network HYPE staking APR: "),
        pct(range.min * 100),
        lit("–"),
        pct(range.max * 100),
        lit(` across ${range.count} active validators. Anything far above this is a reward or a risk premium.`),
      );
      sources.push({ label: "Hyperliquid validators", host: "api.hyperliquid.xyz", fetchedAt: validators.fetchedAt, stale: validators.stale });
    }
  } catch (err) {
    notes.push(lit(`network staking APR unavailable (${err instanceof SourceError ? err.message : HL})`));
  }

  // DefiLlama pools carry project slugs ("hyperlend-pooled"); the protocol list
  // carries the names people actually use. Readability of the output is the
  // whole point of this tool, so the slug is only a fallback.
  const nameBySlug = new Map<string, string>();
  for (const p of protocols) if (p.slug !== "" && p.name !== "") nameBySlug.set(p.slug, p.name);
  const displayProject = (slug: string): Safe =>
    sanitizeOr(nameBySlug.get(slug) ?? slug, "?", 24);

  const lst = buildLst(pools, protocols, minTvl);
  const lstRows = lst.rows;
  const lendingRows = buildLending(pools, borrow, minTvl, displayProject);
  const otherRows = buildOther(pools, borrow, lst.usedPoolIds, minTvl, displayProject);

  const sections: Safe[] = [];
  const data: Record<string, unknown> = {};

  if (category === "lst" || category === "all") {
    const shown = lstRows.slice(0, limit);
    if (shown.length > 0) {
      sections.push(
        section(
          "Liquid staking (HYPE LSTs)",
          table(
            ["Protocol", "Token", "APY", "7d", "TVL"],
            shown.map((r) => [r.project, r.label, pct(r.apy), signedPp(r.apy7d), usd(r.tvl)]),
            ["left", "left", "right", "right", "right"],
          ),
        ),
      );
      data["liquid_staking"] = shown.map((r) => ({
        protocol: r.project,
        token: r.label,
        apy_pct: r.apy,
        apy_base_pct: r.apyBase,
        apy_reward_pct: r.apyReward,
        apy_change_7d_pp: r.apy7d,
        tvl_usd: r.tvl,
        apy_published: r.apy !== null,
      }));
    }
    const unpublished = lstRows.filter((r) => r.apy === null).map((r) => r.project);
    if (unpublished.length > 0) {
      notes.push(
        cat(
          joinSafe(unpublished, ", "),
          lit(" publish no yield pool on DefiLlama — TVL is theirs, APY is shown as n/a rather than guessed."),
        ),
      );
    }
    if (lstRows.length > shown.length) {
      notes.push(lit(`${lstRows.length - shown.length} more liquid staking rows hidden by limit=${limit}.`));
    }
  }

  if (category === "lending" || category === "all") {
    const shown = lendingRows.slice(0, limit);
    if (shown.length > 0) {
      sections.push(
        section(
          "Lending markets",
          table(
            ["Protocol", "Asset", "Supply", "Borrow", "Util", "Max LTV", "TVL"],
            shown.map((r) => [
              r.project,
              r.label,
              pct(r.supplyApy ?? null),
              pct(r.borrowApy ?? null),
              fraction(r.utilization ?? null),
              fraction(r.ltv ?? null),
              usd(r.tvl),
            ]),
            ["left", "left", "right", "right", "right", "right", "right"],
          ),
        ),
      );
      data["lending"] = shown.map((r) => ({
        protocol: r.project,
        asset: r.label,
        supply_apy_pct: r.supplyApy ?? null,
        borrow_apy_pct: r.borrowApy ?? null,
        utilization: r.utilization ?? null,
        max_ltv: r.ltv ?? null,
        tvl_usd: r.tvl,
      }));
    }
    if (lendingRows.length > shown.length) {
      notes.push(lit(`${lendingRows.length - shown.length} more lending rows hidden by limit=${limit}.`));
    }
  }

  if (category === "other" || category === "all") {
    const shown = otherRows.slice(0, limit);
    if (shown.length > 0) {
      sections.push(
        section(
          "Other HYPE yield (LP, looping, fixed-term)",
          table(
            ["Protocol", "Pool", "APY", "Base", "7d", "TVL", "IL"],
            shown.map((r) => [
              r.project,
              r.label,
              pct(r.apy),
              pct(r.apyBase),
              signedPp(r.apy7d),
              usd(r.tvl),
              r.ilRisk,
            ]),
            ["left", "left", "right", "right", "right", "right", "left"],
          ),
        ),
      );
      data["other"] = shown.map((r) => ({
        protocol: r.project,
        pool: r.label,
        apy_pct: r.apy,
        apy_base_pct: r.apyBase,
        apy_reward_pct: r.apyReward,
        apy_change_7d_pp: r.apy7d,
        mostly_emissions: emissionDriven(r),
        tvl_usd: r.tvl,
        il_risk: r.ilRisk ?? null,
      }));

      // The single most misleading thing this table could do is present token
      // emissions as if they were earned yield. Base is a column; this is the
      // sentence that makes sure it is not skimmed past.
      const emitters = shown.filter(emissionDriven);
      if (emitters.length > 0) {
        notes.push(
          cat(
            lit(`${emitters.length} of the rows above are mostly token emissions rather than earned yield (`),
            joinSafe(emitters.map((r) => cat(r.project, lit(" "), r.label)), ", "),
            lit("). Compare the APY and Base columns — emissions stop when the issuing team decides they stop."),
          ),
        );
      }
    }
    if (otherRows.length > shown.length) {
      notes.push(
        lit(`${otherRows.length - shown.length} more rows in Other HYPE yield hidden by limit=${limit}.`),
      );
    }
  }

  // HLP is the fifth-largest thing on this chain and the canonical "deposit and
  // earn" product of Hyperliquid itself — and DefiLlama publishes no yield pool
  // for it, so a table built only from /pools omits it entirely. A tool that
  // claims to list every way to earn here cannot skip it.
  if (category === "lst" || category === "other" || category === "all") {
    const vault = await vaultSection();
    if (vault) {
      sections.push(vault.body);
      data["vaults"] = vault.data;
      notes.push(...vault.notes);
      sources.push({ label: "Hyperliquid vault", host: "api.hyperliquid.xyz", fetchedAt: vault.fetchedAt, stale: vault.stale });
    }
  }

  if (sections.length === 0) {
    notes.push(cat(lit("No pools matched. Try lowering min_tvl (currently "), usd(minTvl), lit(') or category="all".')));
  }

  // Provenance for the one column here that is not a current reading.
  const showed7d = category === "lst" || category === "other" || category === "all";
  if (showed7d && sections.length > 0) {
    notes.push(
      lit(
        "The 7d column is the source's own weekly delta, measured against a single sample from a week ago. Where that sample looks unusable the cell reads n/a instead of a number; hyperevm_pool_history recomputes the move from the daily series.",
      ),
    );
  }

  const header = baseline === "" ? lit("") : cat(baseline, lit("\n\n"));
  notes.push(cat(lit(`Filters: category=${category}, min_tvl=`), usd(minTvl), lit(`, limit=${limit}.`)));

  return envelope({
    sources,
    body: cat(header, joinSafe(sections, "\n\n")),
    notes,
    data,
  });
}

/**
 * Liquid staking. Driven by DefiLlama's own categorisation rather than a
 * hand-kept list, so a protocol that starts publishing a pool tomorrow stops
 * being an n/a row without anyone editing this file.
 */
function buildLst(
  pools: Pool[],
  protocols: Protocol[],
  minTvl: number,
): { rows: Row[]; usedPoolIds: Set<string> } {
  const stakingProtocols = protocols.filter((p) => p.category === "Liquid Staking");
  const rows: Row[] = [];
  const usedPoolIds = new Set<string>();

  for (const protocol of stakingProtocols) {
    const own = pools.filter(
      (pool) => pool.project === protocol.slug && pool.symbol.toUpperCase().includes("HYPE"),
    );
    if (own.length > 0) {
      for (const pool of own) {
        usedPoolIds.add(pool.id);
        if ((pool.tvlUsd ?? 0) < minTvl) continue;
        rows.push({
          project: sanitizeOr(protocol.name, pool.project, 24),
          label: sanitizeOr(pool.symbol, "?", 16),
          apy: pool.apy,
          apyBase: pool.apyBase,
          apyReward: pool.apyReward,
          apy7d: trusted7d(pool.apy, pool.apyPct7D),
          tvl: pool.tvlUsd,
          ilRisk: sanitizeOr(pool.ilRisk, "?", 8),
        });
      }
      continue;
    }
    if ((protocol.hlTvl ?? 0) < minTvl) continue;
    rows.push({
      project: sanitizeOr(protocol.name, "?", 24),
      label: lit("—"),
      apy: null,
      apyBase: null,
      apyReward: null,
      apy7d: null,
      tvl: protocol.hlTvl,
      ilRisk: lit("—"),
    });
  }

  return { rows: sortByApyThenTvl(rows), usedPoolIds };
}

/** Lending. Membership in /lendBorrow is the signal — no hardcoded project list. */
function buildLending(
  pools: Pool[],
  borrow: Map<string, BorrowRow>,
  minTvl: number,
  displayProject: (slug: string) => Safe,
): Row[] {
  const rows: Row[] = [];
  for (const pool of pools) {
    const b = borrow.get(pool.id);
    if (!b) continue;
    if ((pool.tvlUsd ?? 0) < minTvl) continue;
    const utilization =
      b.totalSupplyUsd && b.totalSupplyUsd > 0 && b.totalBorrowUsd !== null
        ? b.totalBorrowUsd / b.totalSupplyUsd
        : null;
    rows.push({
      project: displayProject(pool.project),
      label: sanitizeOr(pool.symbol, "?", 18),
      ilRisk: sanitizeOr(pool.ilRisk, "?", 8),
      apy: pool.apy,
      apyBase: pool.apyBase,
      apyReward: pool.apyReward,
      apy7d: trusted7d(pool.apy, pool.apyPct7D),
      supplyApy: pool.apy,
      borrowApy: b.apyBaseBorrow,
      utilization,
      ltv: b.ltv,
      tvl: pool.tvlUsd,
    });
  }
  return rows.sort((a, b) => {
    const byApy = (b.supplyApy ?? -1) - (a.supplyApy ?? -1);
    if (byApy !== 0) return byApy;
    return (b.tvl ?? 0) - (a.tvl ?? 0);
  });
}

/** Everything else denominated in HYPE: LP positions, looping vaults, PT tokens. */
function buildOther(
  pools: Pool[],
  borrow: Map<string, BorrowRow>,
  usedPoolIds: Set<string>,
  minTvl: number,
  displayProject: (slug: string) => Safe,
): Row[] {
  const rows: Row[] = [];
  for (const pool of pools) {
    if (borrow.has(pool.id)) continue;
    if (usedPoolIds.has(pool.id)) continue;
    if (!pool.symbol.toUpperCase().includes("HYPE")) continue;
    if ((pool.tvlUsd ?? 0) < minTvl) continue;
    rows.push({
      project: displayProject(pool.project),
      label: sanitizeOr(poolLabel(pool), "?", 28),
      apy: pool.apy,
      apyBase: pool.apyBase,
      apyReward: pool.apyReward,
      apy7d: trusted7d(pool.apy, pool.apyPct7D),
      tvl: pool.tvlUsd,
      ilRisk: sanitizeOr(pool.ilRisk, "?", 8),
    });
  }
  return sortByApyThenTvl(rows);
}

function poolLabel(pool: Pool): string {
  return pool.poolMeta ? `${pool.symbol} (${pool.poolMeta})` : pool.symbol;
}

/** Known APYs first, descending. Unknown APYs last, largest TVL first. */
function sortByApyThenTvl(rows: Row[]): Row[] {
  return rows.sort((a, b) => {
    if (a.apy === null && b.apy === null) return (b.tvl ?? 0) - (a.tvl ?? 0);
    if (a.apy === null) return 1;
    if (b.apy === null) return -1;
    if (b.apy !== a.apy) return b.apy - a.apy;
    return (b.tvl ?? 0) - (a.tvl ?? 0);
  });
}
