import { z } from "zod";
import { getWallet, SOURCE as HL, type SpotBalance, type WalletPosition } from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { fraction, price, qty, usdExact } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitizeOr } from "../format/sanitize.js";
import { facts, section, subsection, table } from "../format/table.js";

/**
 * Read one public address: perp account, spot balances, HYPE staking.
 *
 * Nothing here can act on the address. There is no key, no signature and no
 * transaction path anywhere in this process — this reads the same public
 * ledger any block explorer reads. The address is validated as hex before a
 * single byte goes to the network.
 */

export const name = "hyperevm_wallet";

export const description =
  "Look up what any public Hyperliquid address holds: account value, margin, open perp positions " +
  "with entry price, unrealised PnL and liquidation price, spot balances, and delegated HYPE. Works " +
  "on any address, including one that is not yours — this reads the public ledger, and the server " +
  "has no key, no signature and no send path with which to act on an address.";

/** Checked before the network is touched. Nothing else is accepted. */
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export const inputSchema = {
  address: z
    .string()
    .regex(ADDRESS, "must be a 0x-prefixed 40-character hex address")
    .describe("Public Hyperliquid address, e.g. 0x0000000000000000000000000000000000000000"),
  limit: z.number().int().min(1).max(50).optional().describe("Positions and balances to show. Default 10."),
};

type Args = { address: string; limit?: number };

export async function run(args: Args): Promise<string> {
  const address = args.address.trim();
  if (!ADDRESS.test(address)) {
    return failure(name, "address must be 0x followed by 40 hexadecimal characters");
  }
  const limit = args.limit ?? 10;

  let snapshot;
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getWallet(address);
    snapshot = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  const notes: Safe[] = [lit("This is a read of public ledger data. Nothing here can act on the address.")];
  if (snapshot.unavailable.length > 0) {
    notes.push(lit(`${snapshot.unavailable.join(" and ")} could not be read — those sections are omitted, not empty.`));
  }

  const summary: Array<[string, Safe]> = [
    ["Address", lit(address.toLowerCase())],
    ["Account value", usdExact(snapshot.accountValue)],
    ["Withdrawable", usdExact(snapshot.withdrawable)],
  ];
  if (snapshot.totalNtlPos !== null) summary.push(["Position notional", usdExact(snapshot.totalNtlPos)]);
  if (snapshot.totalMarginUsed !== null) summary.push(["Margin used", usdExact(snapshot.totalMarginUsed)]);
  if (snapshot.maintenanceMargin !== null) summary.push(["Maintenance margin", usdExact(snapshot.maintenanceMargin)]);

  const sections: Safe[] = [section("Hyperliquid account", facts(summary))];

  const positions = [...snapshot.positions].sort(
    (a, b) => Math.abs(b.notional ?? 0) - Math.abs(a.notional ?? 0),
  );
  if (positions.length > 0) {
    const shown = positions.slice(0, limit);
    sections.push(
      subsection(
        `Open positions${positions.length > shown.length ? ` (${shown.length} of ${positions.length} by size)` : ""}`,
        table(
          ["Market", "Side", "Size", "Entry", "Notional", "uPnL", "ROE", "Leverage", "Liq. price"],
          shown.map((p) => [
            sanitizeOr(p.coin, "?", 12),
            lit(side(p.size)),
            qty(p.size === null ? null : Math.abs(p.size), 4),
            price(p.entryPx),
            usdExact(p.notional),
            usdExact(p.unrealizedPnl),
            fraction(p.roe),
            p.leverage === null
              ? lit("n/a")
              : cat(lit(`${p.leverage}x `), sanitizeOr(p.leverageType, "", 8)),
            price(p.liquidationPx),
          ]),
          ["left", "left", "right", "right", "right", "right", "right", "left", "right"],
        ),
      ),
    );
  }

  const balances = [...snapshot.balances].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  if (balances.length > 0) {
    const shown = balances.slice(0, limit);
    sections.push(
      subsection(
        `Spot balances${balances.length > shown.length ? ` (${shown.length} of ${balances.length})` : ""}`,
        table(
          ["Token", "Balance", "On hold"],
          shown.map((b) => [sanitizeOr(b.coin, "?", 16), qty(b.total, 6), qty(b.hold, 6)]),
          ["left", "right", "right"],
        ),
      ),
    );
  }

  if (snapshot.delegated !== null || snapshot.undelegated !== null) {
    const staking: Array<[string, Safe]> = [
      ["Delegated", cat(qty(snapshot.delegated, 4), lit(" HYPE"))],
      ["Undelegated", cat(qty(snapshot.undelegated, 4), lit(" HYPE"))],
    ];
    if ((snapshot.pendingWithdrawal ?? 0) > 0) {
      staking.push(["Pending withdrawal", cat(qty(snapshot.pendingWithdrawal, 4), lit(" HYPE"))]);
    }
    sections.push(subsection("HYPE staking", facts(staking)));
  }

  if (positions.length === 0 && balances.length === 0 && (snapshot.accountValue ?? 0) === 0) {
    notes.push(lit("This address holds no perp account value, no spot balance and no delegation on Hyperliquid."));
  }

  return envelope({
    sources: [{ label: "Hyperliquid account", host: "api.hyperliquid.xyz", fetchedAt, stale }],
    body: joinSafe(sections, "\n\n"),
    notes,
    data: {
      address: address.toLowerCase(),
      account_value_usd: snapshot.accountValue,
      withdrawable_usd: snapshot.withdrawable,
      position_notional_usd: snapshot.totalNtlPos,
      margin_used_usd: snapshot.totalMarginUsed,
      maintenance_margin_usd: snapshot.maintenanceMargin,
      positions: positions.slice(0, limit).map(serialisePosition),
      spot_balances: balances.slice(0, limit).map(serialiseBalance),
      staking: {
        delegated_hype: snapshot.delegated,
        undelegated_hype: snapshot.undelegated,
        pending_withdrawal_hype: snapshot.pendingWithdrawal,
      },
    },
  });
}

function side(size: number | null): string {
  if (size === null || size === 0) return "flat";
  return size > 0 ? "long" : "short";
}

function serialisePosition(p: WalletPosition) {
  return {
    market: sanitizeOr(p.coin, "?", 12),
    side: side(p.size),
    size: p.size,
    entry_px: p.entryPx,
    notional_usd: p.notional,
    unrealized_pnl_usd: p.unrealizedPnl,
    roe: p.roe,
    leverage: p.leverage,
    liquidation_px: p.liquidationPx,
  };
}

function serialiseBalance(b: SpotBalance) {
  return { token: sanitizeOr(b.coin, "?", 16), balance: b.total, on_hold: b.hold };
}
