import { cached, type Fetched } from "../core/cache.js";
import { fetchJson } from "../core/http.js";
import { num } from "../format/numbers.js";

/**
 * DefiLlama.
 *
 * Two things this module exists to get right:
 *
 * 1. The chain is called "Hyperliquid L1". Not "Hyperliquid", not "HyperEVM" —
 *    both of those match nothing. A loose /hyper/i match is also wrong: it
 *    picks up "BESC Hyperchain" and "BCHyper", which are different networks.
 *
 * 2. Lending rates are not in /pools. For collateral markets /pools reports
 *    apy 0.00 truthfully — the rate lives in /lendBorrow and is joined on the
 *    pool uuid. Without that join the flagship tool prints a table of zeros.
 *
 * Every function returns normalized objects containing only the fields the
 * tools display. Unused upstream text (notably `description`) never leaves
 * this file, which makes the whitelist structural rather than a habit.
 */

export const HL_CHAIN = "Hyperliquid L1";
export const SOURCE = "DefiLlama";

export interface Pool {
  id: string;
  project: string;
  symbol: string;
  poolMeta: string | null;
  tvlUsd: number | null;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  apyPct7D: number | null;
  ilRisk: string | null;
  exposure: string | null;
  stablecoin: boolean;
}

export interface BorrowRow {
  apyBaseBorrow: number | null;
  apyRewardBorrow: number | null;
  totalSupplyUsd: number | null;
  totalBorrowUsd: number | null;
  ltv: number | null;
  borrowable: boolean;
}

export interface Protocol {
  name: string;
  slug: string;
  category: string;
  url: string;
  twitter: string;
  chains: string[];
  hlTvl: number | null;
  hlBorrowed: number | null;
  hlStaking: number | null;
  totalTvl: number | null;
  change1d: number | null;
  change7d: number | null;
  audits: number | null;
  auditLinks: string[];
  mcap: number | null;
  listedAt: number | null;
}

export async function getPools(): Promise<Fetched<Pool[]>> {
  return cached("llama:pools", async () => {
    const raw = await fetchJson<{ data?: unknown[] } | unknown[]>("https://yields.llama.fi/pools", {
      source: SOURCE,
    });
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
    const out: Pool[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (r["chain"] !== HL_CHAIN) continue;
      if (typeof r["pool"] !== "string" || typeof r["project"] !== "string") continue;
      out.push({
        id: r["pool"],
        project: r["project"],
        symbol: typeof r["symbol"] === "string" ? r["symbol"] : "",
        poolMeta: typeof r["poolMeta"] === "string" ? r["poolMeta"] : null,
        tvlUsd: num(r["tvlUsd"]),
        apy: num(r["apy"]),
        apyBase: num(r["apyBase"]),
        apyReward: num(r["apyReward"]),
        apyPct7D: num(r["apyPct7D"]),
        ilRisk: typeof r["ilRisk"] === "string" ? r["ilRisk"] : null,
        exposure: typeof r["exposure"] === "string" ? r["exposure"] : null,
        stablecoin: r["stablecoin"] === true,
      });
    }
    return out;
  });
}

export async function getBorrowRows(): Promise<Fetched<Map<string, BorrowRow>>> {
  return cached("llama:lendBorrow", async () => {
    const raw = await fetchJson<{ data?: unknown[] } | unknown[]>("https://yields.llama.fi/lendBorrow", {
      source: SOURCE,
    });
    const rows = Array.isArray(raw) ? raw : Array.isArray(raw.data) ? raw.data : [];
    const map = new Map<string, BorrowRow>();
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (typeof r["pool"] !== "string") continue;
      map.set(r["pool"], {
        apyBaseBorrow: num(r["apyBaseBorrow"]),
        apyRewardBorrow: num(r["apyRewardBorrow"]),
        totalSupplyUsd: num(r["totalSupplyUsd"]),
        totalBorrowUsd: num(r["totalBorrowUsd"]),
        ltv: num(r["ltv"]),
        borrowable: r["borrowable"] === true,
      });
    }
    return map;
  });
}

export interface ChainTotals {
  tvl: number | null;
  tokenSymbol: string;
}

/** Chain-level TVL. Excludes the bridge, so it does not match the sum of the protocol list. */
export async function getChainTotals(): Promise<Fetched<ChainTotals>> {
  return cached("llama:chains", async () => {
    const rows = await fetchJson<unknown[]>("https://api.llama.fi/v2/chains", { source: SOURCE });
    for (const row of Array.isArray(rows) ? rows : []) {
      const r = row as Record<string, unknown>;
      if (r["name"] !== HL_CHAIN) continue;
      return { tvl: num(r["tvl"]), tokenSymbol: isString(r["tokenSymbol"]) ? r["tokenSymbol"] : "" };
    }
    return { tvl: null, tokenSymbol: "" };
  });
}

export interface PoolPoint {
  timestamp: string;
  tvlUsd: number | null;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
}

/**
 * One pool's history, one point per day.
 *
 * This is what turns "APY is 46.93%" into a claim a reader can check. It is
 * also the only way to show that an emissions-driven rate is decaying rather
 * than merely high today.
 */
export async function getPoolHistory(poolId: string): Promise<Fetched<PoolPoint[]>> {
  return cached(`llama:chart:${poolId}`, async () => {
    const raw = await fetchJson<{ data?: unknown[] }>(
      `https://yields.llama.fi/chart/${encodeURIComponent(poolId)}`,
      { source: SOURCE },
    );
    const rows = Array.isArray(raw?.data) ? raw.data : [];
    const points: PoolPoint[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (!isString(r["timestamp"])) continue;
      points.push({
        timestamp: r["timestamp"],
        tvlUsd: num(r["tvlUsd"]),
        apy: num(r["apy"]),
        apyBase: num(r["apyBase"]),
        apyReward: num(r["apyReward"]),
      });
    }
    return points;
  });
}

export interface FeeRow {
  name: string;
  slug: string;
  category: string;
  day: number | null;
  week: number | null;
  month: number | null;
  change7d: number | null;
}

export interface FeeTotals {
  day: number | null;
  week: number | null;
  month: number | null;
  protocols: FeeRow[];
}

/**
 * Fees paid to protocols on this chain.
 *
 * TVL says how much sits somewhere. Fees say whether anyone is paying for it —
 * a different and usually more interesting question. The `revenue` variant of
 * this endpoint returns an internal error for this chain, so only fees are read.
 */
export async function getFees(): Promise<Fetched<FeeTotals>> {
  return cached("llama:fees", async () => {
    const raw = await fetchJson<Record<string, unknown>>(
      `https://api.llama.fi/overview/fees/${encodeURIComponent(HL_CHAIN)}` +
        "?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true",
      { source: SOURCE },
    );
    const rows = Array.isArray(raw["protocols"]) ? (raw["protocols"] as unknown[]) : [];
    const protocols: FeeRow[] = [];
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      if (!isString(r["name"])) continue;
      protocols.push({
        name: r["name"],
        slug: isString(r["slug"]) ? r["slug"] : "",
        category: isString(r["category"]) ? r["category"] : "",
        day: num(r["total24h"]),
        week: num(r["total7d"]),
        month: num(r["total30d"]),
        change7d: num(r["change_7dover7d"]),
      });
    }
    return {
      day: num(raw["total24h"]),
      week: num(raw["total7d"]),
      month: num(raw["total30d"]),
      protocols,
    };
  });
}

export async function getProtocols(): Promise<Fetched<Protocol[]>> {
  return cached("llama:protocols", async () => {
    const rows = await fetchJson<unknown[]>("https://api.llama.fi/protocols", { source: SOURCE });
    const out: Protocol[] = [];
    for (const row of Array.isArray(rows) ? rows : []) {
      const r = row as Record<string, unknown>;
      const chains = Array.isArray(r["chains"]) ? (r["chains"] as unknown[]).filter(isString) : [];
      if (!chains.includes(HL_CHAIN)) continue;
      const chainTvls = (r["chainTvls"] ?? {}) as Record<string, unknown>;
      const auditLinks = Array.isArray(r["audit_links"])
        ? (r["audit_links"] as unknown[]).filter(isString)
        : [];
      out.push({
        name: typeof r["name"] === "string" ? r["name"] : "",
        slug: typeof r["slug"] === "string" ? r["slug"] : "",
        category: typeof r["category"] === "string" ? r["category"] : "",
        url: typeof r["url"] === "string" ? r["url"] : "",
        twitter: typeof r["twitter"] === "string" ? r["twitter"] : "",
        chains,
        hlTvl: num(chainTvls[HL_CHAIN]),
        hlBorrowed: num(chainTvls[`${HL_CHAIN}-borrowed`]),
        hlStaking: num(chainTvls[`${HL_CHAIN}-staking`]),
        totalTvl: num(r["tvl"]),
        change1d: num(r["change_1d"]),
        change7d: num(r["change_7d"]),
        audits: num(r["audits"]),
        auditLinks,
        mcap: num(r["mcap"]),
        listedAt: num(r["listedAt"]),
      });
    }
    return out;
  });
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}
