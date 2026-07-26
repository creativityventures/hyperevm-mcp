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
