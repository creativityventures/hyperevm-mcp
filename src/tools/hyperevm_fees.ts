import { z } from "zod";
import { getFees, type FeeRow } from "../clients/defillama.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { signedPct, usd } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitize, sanitizeOr } from "../format/sanitize.js";
import { facts, section, table } from "../format/table.js";

/**
 * Who is actually being paid.
 *
 * TVL is the number every dashboard shows, and it measures how much money is
 * parked somewhere — which can be large for a protocol nobody uses, because
 * deposits chase incentives. Fees measure whether anyone is paying to use the
 * thing. The two rankings differ enough on this chain that showing only the
 * first would be a misleading picture of the ecosystem.
 */

export const name = "hyperevm_fees";

export const description =
  "Fees actually paid to protocols on Hyperliquid, over 24h, 7d and 30d, ranked. TVL shows how much " +
  "money sits somewhere; fees show whether anyone is paying to use it, so the two rankings often " +
  "disagree. Pass a name for one protocol's fee line. Read-only, public data, no API key.";

export const inputSchema = {
  name: z
    .string()
    .max(64)
    .optional()
    .describe('Protocol name, e.g. "Hyperliquid Perps". Omitted = ranked list.'),
  limit: z.number().int().min(1).max(50).optional().describe("Rows in the list. Default 12."),
};

type Args = { name?: string; limit?: number };

export async function run(args: Args): Promise<string> {
  const limit = args.limit ?? 12;

  let totals: Awaited<ReturnType<typeof getFees>>["value"];
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getFees();
    totals = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `DefiLlama: ${describe(err)}`);
  }

  const sources = [{ label: "DefiLlama fees", host: "api.llama.fi", fetchedAt, stale }];
  const earning = totals.protocols.filter((p) => (p.day ?? 0) > 0 || (p.week ?? 0) > 0);
  const ranked = [...earning].sort((a, b) => (b.day ?? 0) - (a.day ?? 0));

  if (args.name !== undefined && args.name.trim() !== "") {
    return one(args.name, totals.protocols, sources);
  }

  if (ranked.length === 0) {
    return envelope({
      sources,
      body: lit("No protocol on this chain reported fees in the last 24 hours."),
      notes: [lit("The source publishes fees per protocol; an empty list usually means the upstream adapters are behind rather than that nothing was earned.")],
    });
  }

  const shown = ranked.slice(0, limit);
  const shownDay = shown.reduce((sum, p) => sum + (p.day ?? 0), 0);
  const chainDay = totals.day;

  const header = facts([
    ["Chain fees 24h", usd(chainDay)],
    ["Chain fees 7d", usd(totals.week)],
    ["Chain fees 30d", usd(totals.month)],
    ["Protocols reporting", lit(String(totals.protocols.length))],
    [
      "Top rows shown here",
      chainDay && chainDay > 0
        ? lit(`${((shownDay / chainDay) * 100).toFixed(0)}% of the chain's 24h fees`)
        : lit("n/a"),
    ],
  ]);

  const notes: Safe[] = [
    lit("Fees are what users paid in total. They are not the protocol's profit: most of it is passed on to liquidity providers, stakers or validators, and the split differs per protocol."),
    lit("HYPE staking pools appear here as separate entries because the source counts validator commission as a fee."),
  ];
  if (ranked.length > shown.length) {
    notes.push(lit(`${ranked.length - shown.length} more fee-earning protocols hidden by limit=${limit}.`));
  }
  const silent = totals.protocols.length - earning.length;
  if (silent > 0) {
    notes.push(lit(`${silent} listed protocol(s) reported no fees over the last 24h or 7d and are not shown.`));
  }

  return envelope({
    sources,
    body: joinSafe(
      [
        section("Fees on Hyperliquid", header),
        section(
          "By protocol, ranked by last 24h",
          table(
            ["Protocol", "Category", "24h", "7d", "30d", "7d vs prior"],
            shown.map((p) => [
              sanitizeOr(p.name, "?", 26),
              sanitizeOr(p.category, "—", 18),
              usd(p.day),
              usd(p.week),
              usd(p.month),
              signedPct(p.change7d),
            ]),
            ["left", "left", "right", "right", "right", "right"],
          ),
        ),
      ],
      "\n\n",
    ),
    notes,
    data: shown.map((p) => ({
      protocol: sanitizeOr(p.name, "?", 26),
      category: sanitizeOr(p.category, "—", 18),
      fees_24h_usd: p.day,
      fees_7d_usd: p.week,
      fees_30d_usd: p.month,
      change_7d_over_prior_7d_pct: p.change7d,
    })),
  });
}

function one(query: string, rows: FeeRow[], sources: Parameters<typeof envelope>[0]["sources"]): string {
  const q = query.trim().toLowerCase();
  const exact = rows.filter((r) => r.name.toLowerCase() === q || r.slug.toLowerCase() === q);
  const candidates = exact.length > 0 ? exact : rows.filter((r) => r.name.toLowerCase().includes(q));

  if (candidates.length === 0) {
    return envelope({
      sources,
      body: cat(lit('No fee data on this chain for "'), sanitize(query, 32), lit('".')),
      notes: [lit("Not every protocol has a fee adapter on DefiLlama. Absent data is not zero fees; call this tool without a name to see who does report.")],
    });
  }

  if (candidates.length > 1) {
    const list = candidates
      .slice(0, 8)
      .map((r) => cat(lit("- "), sanitizeOr(r.name, "?", 32), lit(" ("), usd(r.day), lit(" in 24h)")));
    return envelope({
      sources,
      body: cat(
        lit('"'),
        sanitize(query, 32),
        lit(`" matches ${candidates.length} entries:\n\n`),
        joinSafe(list, "\n"),
      ),
      notes: [lit("Pass one of the names above exactly.")],
    });
  }

  const p = candidates[0]!;
  return envelope({
    sources,
    body: cat(
      lit("## "),
      sanitizeOr(p.name, "?", 32),
      lit("\n\n"),
      facts([
        ["Category", sanitizeOr(p.category, "—", 24)],
        ["Fees 24h", usd(p.day)],
        ["Fees 7d", usd(p.week)],
        ["Fees 30d", usd(p.month)],
        ["7d vs prior 7d", signedPct(p.change7d)],
      ]),
    ),
    notes: [
      lit("Fees are what users paid, not the protocol's own take — the split between LPs, stakers and the treasury differs per protocol."),
      lit("Figures cover activity on Hyperliquid only, not the protocol's other chains."),
    ],
    data: {
      protocol: sanitizeOr(p.name, "?", 32),
      category: sanitizeOr(p.category, "—", 24),
      fees_24h_usd: p.day,
      fees_7d_usd: p.week,
      fees_30d_usd: p.month,
      change_7d_over_prior_7d_pct: p.change7d,
    },
  });
}
