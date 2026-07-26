import { z } from "zod";
import { getProtocols, SOURCE as LLAMA, type Protocol } from "../clients/defillama.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure, type Source } from "../format/envelope.js";
import { signedPct, usd, utcDate } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { safeUrl, sanitize, sanitizeOr } from "../format/sanitize.js";
import { facts, section, table } from "../format/table.js";

/**
 * What is deployed on HyperEVM and how big it is.
 *
 * TVL is read from chainTvls["Hyperliquid L1"], never from the top-level `tvl`:
 * for Morpho, Pendle or Euler the difference between the two is an order of
 * magnitude, and printing the cross-chain number here would be wrong.
 */

export const name = "hyperevm_protocols";

export const description =
  "Protocols deployed on Hyperliquid / HyperEVM: TVL on this chain, category, 1d and 7d change, " +
  "audits and links. Pass a name for a detail card on one protocol. Read-only, public data, no API key.";

export const inputSchema = {
  name: z.string().max(64).optional().describe("Protocol name or slug, e.g. HyperLend. Omitted = ranked list."),
  limit: z.number().int().min(1).max(50).optional().describe("Rows in the list. Default 15."),
};

type Args = { name?: string; limit?: number };

export async function run(args: Args): Promise<string> {
  let protocols: Protocol[];
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getProtocols();
    protocols = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${LLAMA}: ${describe(err)}`);
  }

  const source: Source = { label: "DefiLlama protocols", host: "api.llama.fi", fetchedAt, stale };

  if (args.name && args.name.trim() !== "") {
    return detail(args.name.trim(), protocols, source);
  }

  const limit = args.limit ?? 15;
  const ranked = [...protocols].sort((a, b) => (b.hlTvl ?? 0) - (a.hlTvl ?? 0));
  const shown = ranked.slice(0, limit);

  const body = section(
    "Protocols on Hyperliquid / HyperEVM",
    cat(
      lit(`${protocols.length} protocols report TVL on this chain.\n\n`),
      table(
        ["Protocol", "Category", "TVL", "1d", "7d"],
        shown.map((p) => [
          sanitizeOr(p.name, "?", 28),
          sanitizeOr(p.category, "?", 22),
          usd(p.hlTvl),
          signedPct(p.change1d),
          signedPct(p.change7d),
        ]),
        ["left", "left", "right", "right", "right"],
      ),
    ),
  );

  return envelope({
    sources: [source],
    body,
    notes: [
      lit(`Showing ${shown.length} of ${protocols.length}. Pass a name, e.g. name="HyperLend", for a detail card.`),
      lit("TVL is the value on Hyperliquid L1 only, not the protocol's total across all chains."),
    ],
    data: shown.map((p) => ({
      protocol: sanitizeOr(p.name, "?", 28),
      slug: sanitize(p.slug, 32),
      category: sanitizeOr(p.category, "?", 22),
      tvl_usd_hyperliquid: p.hlTvl,
      change_1d_pct: p.change1d,
      change_7d_pct: p.change7d,
    })),
  });
}

function detail(query: string, protocols: Protocol[], source: Source): string {
  const match = resolve(query, protocols);
  const asked = sanitize(query, 32);

  if (match.kind === "none") {
    const near = protocols
      .filter((p) => p.name.toLowerCase().includes(query.toLowerCase().slice(0, 4)))
      .slice(0, 5)
      .map((p) => sanitizeOr(p.name, "?", 28));
    return envelope({
      sources: [source],
      body: cat(lit("No protocol on Hyperliquid matches \""), asked, lit("\".")),
      notes:
        near.length > 0
          ? [cat(lit("Closest names: "), joinSafe(near, ", "), lit("."))]
          : [lit("Call without a name to list everything.")],
    });
  }

  if (match.kind === "ambiguous") {
    const list = match.candidates.map((p) =>
      cat(lit("- "), sanitizeOr(p.name, "?", 28), lit(" ("), sanitize(p.slug, 32), lit(")")),
    );
    return envelope({
      sources: [source],
      body: cat(
        lit("\""),
        asked,
        lit(`" matches ${match.candidates.length} protocols:\n\n`),
        joinSafe(list, "\n"),
      ),
      notes: [lit("Pass one of the names above exactly.")],
    });
  }

  const p = match.protocol;
  const pairs: Array<[string, Safe]> = [
    ["Protocol", sanitizeOr(p.name, "?", 40)],
    ["Category", sanitizeOr(p.category, "?", 32)],
    ["TVL on Hyperliquid", usd(p.hlTvl)],
  ];
  if (p.hlBorrowed !== null) pairs.push(["Borrowed", usd(p.hlBorrowed)]);
  if (p.hlStaking !== null) pairs.push(["Staked", usd(p.hlStaking)]);
  if (p.totalTvl !== null && p.chains.length > 1) {
    pairs.push(["TVL all chains", cat(usd(p.totalTvl), lit(` across ${p.chains.length} chains`))]);
  }
  pairs.push(["Change", cat(lit("1d "), signedPct(p.change1d), lit(" · 7d "), signedPct(p.change7d))]);
  if (p.mcap !== null) pairs.push(["Market cap", usd(p.mcap)]);
  pairs.push(["Audits", p.audits === null ? lit("not reported") : lit(String(p.audits))]);
  const links = p.auditLinks.map(safeUrl).filter((u) => u !== "");
  if (links.length > 0) pairs.push(["Audit links", joinSafe(links.slice(0, 2), " ")]);
  const site = safeUrl(p.url);
  if (site !== "") pairs.push(["Site", site]);
  if (p.twitter !== "") pairs.push(["X", cat(lit("@"), sanitize(p.twitter, 24))]);
  if (p.listedAt !== null) pairs.push(["Listed on DefiLlama", utcDate(p.listedAt * 1000)]);

  const notes: Safe[] = [
    lit("Description text from the source is not shown — see SECURITY.md in the repo for why."),
  ];
  if (match.siblings.length > 0) {
    const siblings = match.siblings.map((s) =>
      cat(sanitizeOr(s.name, "?", 28), lit(" ("), usd(s.hlTvl), lit(")")),
    );
    notes.unshift(cat(lit("The source also lists "), joinSafe(siblings, ", "), lit(" separately.")));
  }

  return envelope({
    sources: [source],
    body: cat(lit("## "), sanitizeOr(p.name, "?", 40), lit("\n\n"), facts(pairs)),
    notes,
    data: {
      protocol: sanitizeOr(p.name, "?", 40),
      slug: sanitize(p.slug, 32),
      category: sanitizeOr(p.category, "?", 32),
      tvl_usd_hyperliquid: p.hlTvl,
      borrowed_usd: p.hlBorrowed,
      staking_usd: p.hlStaking,
      tvl_usd_all_chains: p.totalTvl,
      change_1d_pct: p.change1d,
      change_7d_pct: p.change7d,
      audits: p.audits,
    },
  });
}

type Match =
  | { kind: "one"; protocol: Protocol; siblings: Protocol[] }
  | { kind: "ambiguous"; candidates: Protocol[] }
  | { kind: "none" };

/** Exact slug, then exact name, then prefix, then substring. Never guesses past that. */
function resolve(query: string, protocols: Protocol[]): Match {
  const q = query.toLowerCase();

  const bySlug = protocols.filter((p) => p.slug.toLowerCase() === q);
  if (bySlug.length === 1) return { kind: "one", protocol: bySlug[0]!, siblings: [] };

  const byName = protocols.filter((p) => p.name.toLowerCase() === q);
  if (byName.length === 1) return { kind: "one", protocol: byName[0]!, siblings: [] };
  if (byName.length > 1) return narrow(byName);

  const byPrefix = protocols.filter(
    (p) => p.name.toLowerCase().startsWith(q) || p.slug.toLowerCase().startsWith(q),
  );
  if (byPrefix.length === 1) return { kind: "one", protocol: byPrefix[0]!, siblings: [] };
  if (byPrefix.length > 1) return narrow(byPrefix);

  const bySubstring = protocols.filter((p) => p.name.toLowerCase().includes(q));
  if (bySubstring.length === 1) return { kind: "one", protocol: bySubstring[0]!, siblings: [] };
  if (bySubstring.length > 1) return narrow(bySubstring);

  return { kind: "none" };
}

/**
 * DefiLlama lists many protocols as several entries — HyperLend as Pooled and
 * Isolated, Felix as Vaults, CDP and USDhl. When one of them holds nearly all
 * of the group's TVL, showing that card and naming the rest answers the
 * question; making the caller pick between a $414M entry and a $0 entry does not.
 */
function narrow(candidates: Protocol[]): Match {
  const ranked = [...candidates].sort((a, b) => (b.hlTvl ?? 0) - (a.hlTvl ?? 0));
  const total = ranked.reduce((sum, p) => sum + (p.hlTvl ?? 0), 0);
  const top = ranked[0]!;
  if (total > 0 && (top.hlTvl ?? 0) / total >= 0.8) {
    return { kind: "one", protocol: top, siblings: ranked.slice(1, 6) };
  }
  return { kind: "ambiguous", candidates: ranked.slice(0, 8) };
}
