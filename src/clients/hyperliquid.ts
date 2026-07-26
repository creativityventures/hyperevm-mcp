import { cached, type Fetched } from "../core/cache.js";
import { SourceError } from "../core/errors.js";
import { fetchJson } from "../core/http.js";
import { num } from "../format/numbers.js";

/**
 * Hyperliquid public info API. No authentication, no keys, no account.
 *
 * The one trap here is spot: `universe` has 316 entries while `ctxs` has 707,
 * and they are not aligned by position — universe[71] is "@72" while
 * ctxs[71].coin is "@71". Joining by index gives wrong prices for most pairs.
 * Perps are aligned by index; spot is joined by name.
 */

const INFO_URL = "https://api.hyperliquid.xyz/info";
export const SOURCE = "Hyperliquid";

export interface Perp {
  name: string;
  maxLeverage: number | null;
  markPx: number | null;
  oraclePx: number | null;
  midPx: number | null;
  prevDayPx: number | null;
  funding: number | null;
  openInterest: number | null;
  dayNtlVlm: number | null;
  premium: number | null;
}

export interface SpotPair {
  /** Display name, e.g. "PURR/USDC" — "@71" is resolved through the token list. */
  name: string;
  /** The identifier used by the API, kept for joins and lookups. */
  key: string;
  markPx: number | null;
  midPx: number | null;
  prevDayPx: number | null;
  dayNtlVlm: number | null;
  circulatingSupply: number | null;
}

export interface VenueFunding {
  venue: string;
  rate: number | null;
  intervalHours: number | null;
}

export interface Validator {
  name: string;
  commission: number | null;
  apr: number | null;
  uptime: number | null;
  stake: number | null;
  isActive: boolean;
  isJailed: boolean;
}

export interface WithWarning<T> {
  rows: T;
  warning: string | null;
}

/** HYPE amounts on the L1 are integers scaled by 1e8. */
const HYPE_WEI = 1e8;

export async function getPerps(): Promise<Fetched<WithWarning<Perp[]>>> {
  return cached("hl:metaAndAssetCtxs", async () => {
    const raw = await fetchJson<unknown[]>(INFO_URL, {
      source: SOURCE,
      method: "POST",
      body: { type: "metaAndAssetCtxs" },
    });
    const meta = (raw?.[0] ?? {}) as Record<string, unknown>;
    const universe = Array.isArray(meta["universe"]) ? (meta["universe"] as unknown[]) : [];
    const ctxs = Array.isArray(raw?.[1]) ? (raw[1] as unknown[]) : [];

    let warning: string | null = null;
    if (universe.length !== ctxs.length) {
      warning =
        `Hyperliquid returned ${universe.length} perp definitions and ${ctxs.length} contexts; ` +
        `only the first ${Math.min(universe.length, ctxs.length)} are shown.`;
    }

    const rows: Perp[] = [];
    const n = Math.min(universe.length, ctxs.length);
    for (let i = 0; i < n; i++) {
      const u = (universe[i] ?? {}) as Record<string, unknown>;
      const c = (ctxs[i] ?? {}) as Record<string, unknown>;
      if (typeof u["name"] !== "string") continue;
      if (u["isDelisted"] === true) continue;
      rows.push({
        name: u["name"],
        maxLeverage: num(u["maxLeverage"]),
        markPx: num(c["markPx"]),
        oraclePx: num(c["oraclePx"]),
        midPx: num(c["midPx"]),
        prevDayPx: num(c["prevDayPx"]),
        funding: num(c["funding"]),
        openInterest: num(c["openInterest"]),
        dayNtlVlm: num(c["dayNtlVlm"]),
        premium: num(c["premium"]),
      });
    }
    return { rows, warning };
  });
}

export async function getSpot(): Promise<Fetched<WithWarning<SpotPair[]>>> {
  return cached("hl:spotMetaAndAssetCtxs", async () => {
    const raw = await fetchJson<unknown[]>(INFO_URL, {
      source: SOURCE,
      method: "POST",
      body: { type: "spotMetaAndAssetCtxs" },
    });
    const meta = (raw?.[0] ?? {}) as Record<string, unknown>;
    const tokens = Array.isArray(meta["tokens"]) ? (meta["tokens"] as unknown[]) : [];
    const universe = Array.isArray(meta["universe"]) ? (meta["universe"] as unknown[]) : [];
    const ctxs = Array.isArray(raw?.[1]) ? (raw[1] as unknown[]) : [];

    const tokenName = new Map<number, string>();
    for (const t of tokens) {
      const token = t as Record<string, unknown>;
      const index = num(token["index"]);
      if (index === null || typeof token["name"] !== "string") continue;
      tokenName.set(index, token["name"]);
    }

    // Join by name. Position is meaningless here: the arrays have different
    // lengths and universe has gaps where pairs were delisted.
    const ctxByCoin = new Map<string, Record<string, unknown>>();
    for (const c of ctxs) {
      const ctx = c as Record<string, unknown>;
      if (typeof ctx["coin"] === "string") ctxByCoin.set(ctx["coin"], ctx);
    }

    let missing = 0;
    const rows: SpotPair[] = [];
    for (const u of universe) {
      const pair = u as Record<string, unknown>;
      if (typeof pair["name"] !== "string") continue;
      const key = pair["name"];
      const ctx = ctxByCoin.get(key);
      if (!ctx) {
        missing++;
        continue;
      }
      rows.push({
        name: displayName(key, pair["tokens"], tokenName),
        key,
        markPx: num(ctx["markPx"]),
        midPx: num(ctx["midPx"]),
        prevDayPx: num(ctx["prevDayPx"]),
        dayNtlVlm: num(ctx["dayNtlVlm"]),
        circulatingSupply: num(ctx["circulatingSupply"]),
      });
    }

    const warning =
      missing > 0 ? `${missing} spot pairs had no market context and were omitted.` : null;
    return { rows, warning };
  });
}

function displayName(key: string, tokensField: unknown, tokenName: Map<number, string>): string {
  if (!key.startsWith("@")) return key;
  if (!Array.isArray(tokensField) || tokensField.length < 2) return key;
  const base = num(tokensField[0]);
  const quote = num(tokensField[1]);
  if (base === null || quote === null) return key;
  const baseName = tokenName.get(base);
  const quoteName = tokenName.get(quote);
  if (!baseName || !quoteName) return key;
  return `${baseName}/${quoteName}`;
}

export async function getPredictedFundings(): Promise<Fetched<Map<string, VenueFunding[]>>> {
  return cached("hl:predictedFundings", async () => {
    const raw = await fetchJson<unknown[]>(INFO_URL, {
      source: SOURCE,
      method: "POST",
      body: { type: "predictedFundings" },
    });
    const map = new Map<string, VenueFunding[]>();
    for (const entry of Array.isArray(raw) ? raw : []) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const coin = entry[0];
      const venues = entry[1];
      if (typeof coin !== "string" || !Array.isArray(venues)) continue;
      const list: VenueFunding[] = [];
      for (const v of venues) {
        if (!Array.isArray(v) || v.length < 2) continue;
        const venue = v[0];
        const info = (v[1] ?? {}) as Record<string, unknown>;
        if (typeof venue !== "string") continue;
        list.push({
          venue,
          rate: num(info["fundingRate"]),
          intervalHours: num(info["fundingIntervalHours"]),
        });
      }
      if (list.length > 0) map.set(coin, list);
    }
    return map;
  });
}

export interface FundingPoint {
  time: number;
  /** Rate for that hour, as a fraction. Multiply by 24 * 365 for the annualised figure. */
  rate: number;
  premium: number | null;
}

/**
 * Hourly funding for one market.
 *
 * A snapshot answers "what is funding now", which is the wrong question for
 * anyone deciding whether to hold a basis position: a single hour is noise.
 * What matters is whether the sign has held, and the API returns one point per
 * hour, so a week is 168 of them.
 */
export async function getFundingHistory(
  coin: string,
  hours: number,
  now: number,
): Promise<Fetched<FundingPoint[]>> {
  const startTime = now - hours * 3_600_000;
  return cached(`hl:fundingHistory:${coin}:${hours}`, async () => {
    const raw = await fetchJson<unknown[]>(INFO_URL, {
      source: SOURCE,
      method: "POST",
      body: { type: "fundingHistory", coin, startTime },
    });
    const points: FundingPoint[] = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      const r = (row ?? {}) as Record<string, unknown>;
      const rate = num(r["fundingRate"]);
      const time = num(r["time"]);
      if (rate === null || time === null) continue;
      points.push({ time, rate, premium: num(r["premium"]) });
    }
    return points.sort((a, b) => a.time - b.time);
  });
}

export async function getValidators(): Promise<Fetched<Validator[]>> {
  return cached("hl:validatorSummaries", async () => {
    const raw = await fetchJson<unknown[]>(INFO_URL, {
      source: SOURCE,
      method: "POST",
      body: { type: "validatorSummaries" },
    });
    const out: Validator[] = [];
    for (const row of Array.isArray(raw) ? raw : []) {
      const r = row as Record<string, unknown>;
      // `description` is deliberately not read: 445 characters of free text
      // written by whoever runs the validator.
      const stats = Array.isArray(r["stats"]) ? (r["stats"] as unknown[]) : [];
      let apr: number | null = null;
      let uptime: number | null = null;
      for (const s of stats) {
        if (!Array.isArray(s) || s[0] !== "day") continue;
        const day = (s[1] ?? {}) as Record<string, unknown>;
        apr = num(day["predictedApr"]);
        uptime = num(day["uptimeFraction"]);
      }
      const stake = num(r["stake"]);
      out.push({
        name: typeof r["name"] === "string" ? r["name"] : "",
        commission: num(r["commission"]),
        apr,
        uptime,
        stake: stake === null ? null : stake / HYPE_WEI,
        isActive: r["isActive"] === true,
        isJailed: r["isJailed"] === true,
      });
    }
    return out;
  });
}

export interface WalletPosition {
  coin: string;
  size: number | null;
  entryPx: number | null;
  notional: number | null;
  unrealizedPnl: number | null;
  roe: number | null;
  liquidationPx: number | null;
  leverage: number | null;
  leverageType: string;
  marginUsed: number | null;
}

export interface SpotBalance {
  coin: string;
  total: number | null;
  hold: number | null;
  entryNtl: number | null;
}

export interface WalletSnapshot {
  accountValue: number | null;
  withdrawable: number | null;
  totalMarginUsed: number | null;
  maintenanceMargin: number | null;
  totalNtlPos: number | null;
  positions: WalletPosition[];
  balances: SpotBalance[];
  delegated: number | null;
  undelegated: number | null;
  pendingWithdrawal: number | null;
  /** Names of the sub-requests that failed, so the tool can say what is missing. */
  unavailable: string[];
}

/**
 * A read of one public address: perp account, spot balances, staking.
 *
 * The address is public on-chain data and nothing here can act on it — there is
 * no key, no signature and no transaction anywhere in this process. Each of the
 * three reads is independent: one failing degrades that section only.
 */
export async function getWallet(address: string): Promise<Fetched<WalletSnapshot>> {
  return cached(`hl:wallet:${address.toLowerCase()}`, async () => {
    const ask = (type: string) =>
      fetchJson<Record<string, unknown>>(INFO_URL, {
        source: SOURCE,
        method: "POST",
        body: { type, user: address },
      });

    const [perp, spot, staking] = await Promise.allSettled([
      ask("clearinghouseState"),
      ask("spotClearinghouseState"),
      ask("delegatorSummary"),
    ]);

    const unavailable: string[] = [];
    const snapshot: WalletSnapshot = {
      accountValue: null,
      withdrawable: null,
      totalMarginUsed: null,
      maintenanceMargin: null,
      totalNtlPos: null,
      positions: [],
      balances: [],
      delegated: null,
      undelegated: null,
      pendingWithdrawal: null,
      unavailable,
    };

    if (perp.status === "fulfilled") {
      const p = perp.value;
      const margin = (p["marginSummary"] ?? {}) as Record<string, unknown>;
      snapshot.accountValue = num(margin["accountValue"]);
      snapshot.totalNtlPos = num(margin["totalNtlPos"]);
      snapshot.totalMarginUsed = num(margin["totalMarginUsed"]);
      snapshot.maintenanceMargin = num(p["crossMaintenanceMarginUsed"]);
      snapshot.withdrawable = num(p["withdrawable"]);
      const positions = Array.isArray(p["assetPositions"]) ? (p["assetPositions"] as unknown[]) : [];
      for (const entry of positions) {
        const pos = ((entry as Record<string, unknown>)["position"] ?? {}) as Record<string, unknown>;
        if (typeof pos["coin"] !== "string") continue;
        const lev = (pos["leverage"] ?? {}) as Record<string, unknown>;
        snapshot.positions.push({
          coin: pos["coin"],
          size: num(pos["szi"]),
          entryPx: num(pos["entryPx"]),
          notional: num(pos["positionValue"]),
          unrealizedPnl: num(pos["unrealizedPnl"]),
          roe: num(pos["returnOnEquity"]),
          liquidationPx: num(pos["liquidationPx"]),
          leverage: num(lev["value"]),
          leverageType: typeof lev["type"] === "string" ? lev["type"] : "",
          marginUsed: num(pos["marginUsed"]),
        });
      }
    } else {
      unavailable.push("perp account");
    }

    if (spot.status === "fulfilled") {
      const balances = Array.isArray(spot.value["balances"]) ? (spot.value["balances"] as unknown[]) : [];
      for (const b of balances) {
        const bal = b as Record<string, unknown>;
        if (typeof bal["coin"] !== "string") continue;
        snapshot.balances.push({
          coin: bal["coin"],
          total: num(bal["total"]),
          hold: num(bal["hold"]),
          entryNtl: num(bal["entryNtl"]),
        });
      }
    } else {
      unavailable.push("spot balances");
    }

    if (staking.status === "fulfilled") {
      snapshot.delegated = num(staking.value["delegated"]);
      snapshot.undelegated = num(staking.value["undelegated"]);
      snapshot.pendingWithdrawal = num(staking.value["totalPendingWithdrawal"]);
    } else {
      unavailable.push("staking");
    }

    if (unavailable.length === 3) {
      throw new SourceError(SOURCE, `${SOURCE} did not answer any account query`, true);
    }

    return snapshot;
  });
}

/** Network-wide HYPE staking APR range across active, unjailed validators. */
export function stakingAprRange(validators: Validator[]): { min: number; max: number; count: number } | null {
  const aprs = validators
    .filter((v) => v.isActive && !v.isJailed && v.apr !== null)
    .map((v) => v.apr as number);
  if (aprs.length === 0) return null;
  return { min: Math.min(...aprs), max: Math.max(...aprs), count: aprs.length };
}
