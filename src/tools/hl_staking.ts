import { z } from "zod";
import { getValidators, SOURCE as HL, stakingAprRange, type Validator } from "../clients/hyperliquid.js";
import { describe, SourceError } from "../core/errors.js";
import { envelope, failure } from "../format/envelope.js";
import { fraction, pct, qty } from "../format/numbers.js";
import { cat, joinSafe, lit, type Safe } from "../format/safe.js";
import { sanitizeOr } from "../format/sanitize.js";
import { section, table } from "../format/table.js";

/**
 * Where to stake HYPE, and what it costs.
 *
 * A question asked every day that no other MCP server answers. It is also the
 * single most exposed surface in this project: a validator's `name` is free
 * text set by whoever runs it, permissionless, and `description` runs to 445
 * characters. The description is never read at all — see clients/hyperliquid.ts
 * — and the name is sanitized like everything else, which is enforced by the
 * `Safe` type rather than by remembering to do it.
 */

export const name = "hl_staking";

export const description =
  "Staking HYPE directly with a validator: the active set ranked by predicted APR, with each one's " +
  "commission, uptime and share of stake, and jailed validators named but excluded. This is what the " +
  "network pays before any liquid staking wrapper takes its cut, so it is the benchmark every kHYPE " +
  "or stHYPE rate should be judged against — those live in hyperevm_yields. " +
  "Read-only, public data, no API key.";

export const inputSchema = {
  limit: z.number().int().min(1).max(50).optional().describe("Validators to show. Default 15."),
  include_inactive: z
    .boolean()
    .optional()
    .describe("Include jailed and inactive validators. Default false."),
};

type Args = { limit?: number; include_inactive?: boolean };

export async function run(args: Args): Promise<string> {
  const limit = args.limit ?? 15;
  const includeInactive = args.include_inactive ?? false;

  let validators: Validator[];
  let fetchedAt: number;
  let stale: boolean;
  try {
    const res = await getValidators();
    validators = res.value;
    fetchedAt = res.fetchedAt;
    stale = res.stale;
  } catch (err) {
    return failure(name, err instanceof SourceError ? err.message : `${HL}: ${describe(err)}`);
  }

  const eligible = includeInactive ? validators : validators.filter((v) => v.isActive && !v.isJailed);
  const ranked = [...eligible].sort((a, b) => (b.apr ?? -1) - (a.apr ?? -1));
  const shown = ranked.slice(0, limit);

  if (shown.length === 0) {
    return envelope({
      sources: [{ label: "Hyperliquid validators", host: "api.hyperliquid.xyz", fetchedAt, stale }],
      body: lit("No validators matched."),
      notes: [lit("Try include_inactive=true.")],
    });
  }

  const range = stakingAprRange(validators);
  const totalStake = eligible.reduce((sum, v) => sum + (v.stake ?? 0), 0);

  const header = range
    ? cat(
        lit("Network APR spans "),
        pct(range.min * 100),
        lit(" to "),
        pct(range.max * 100),
        lit(
          ` across ${range.count} active validators. ` +
            `Choosing well is worth about ${((range.max - range.min) * 100).toFixed(2)} percentage points; ` +
            `commission is the main lever.\n\n`,
        ),
      )
    : lit("");

  const notes: Safe[] = [
    lit(
      "APR is the network's own prediction over the last day, already net of the validator's commission.",
    ),
    lit(
      "Staking directly means the HYPE is locked and unstaking takes time; a liquid staking token trades that for a wrapper fee and smart-contract risk. Compare against hyperevm_yields.",
    ),
    lit("Validator descriptions are free text set by the validator and are not shown here."),
  ];
  if (ranked.length > shown.length) {
    notes.push(lit(`${ranked.length - shown.length} more validators hidden by limit=${limit}.`));
  }
  const jailed = validators.filter((v) => v.isJailed);
  if (jailed.length > 0 && !includeInactive) {
    const names = jailed.slice(0, 5).map((v) => sanitizeOr(v.name, "?", 24));
    notes.push(
      cat(lit(`${jailed.length} validator(s) are jailed and excluded: `), joinSafe(names, ", "), lit(".")),
    );
  }

  return envelope({
    sources: [{ label: "Hyperliquid validators", host: "api.hyperliquid.xyz", fetchedAt, stale }],
    body: cat(
      header,
      section(
        includeInactive ? "HYPE validators" : "HYPE validators — active",
        table(
          ["Validator", "APR", "Commission", "Uptime", "Stake (HYPE)", "Share"],
          shown.map((v) => [
            sanitizeOr(v.name, "unnamed", 24),
            pct(v.apr === null ? null : v.apr * 100),
            fraction(v.commission),
            fraction(v.uptime),
            qty(v.stake, 0),
            totalStake > 0 ? fraction((v.stake ?? 0) / totalStake) : lit("n/a"),
          ]),
          ["left", "right", "right", "right", "right", "right"],
        ),
      ),
    ),
    notes,
    data: shown.map((v) => ({
      validator: sanitizeOr(v.name, "unnamed", 24),
      apr_pct: v.apr === null ? null : v.apr * 100,
      commission: v.commission,
      uptime: v.uptime,
      stake_hype: v.stake,
      is_active: v.isActive,
      is_jailed: v.isJailed,
    })),
  });
}
