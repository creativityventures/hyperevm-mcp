import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * MCP prompts. In Claude Code these appear as slash commands, so the whole
 * report is one keystroke rather than a paragraph the user has to compose.
 *
 * Each prompt is a short instruction written here, in this repository. Nothing
 * from the network reaches a prompt — prompts are input to the model, and
 * putting third-party text into one would be handing an attacker the steering
 * wheel rather than the passenger seat.
 */

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "yield-report",
    {
      title: "HYPE yield report",
      description:
        "Full picture of what HYPE earns right now: staking, liquid staking, lending and LP, " +
        "with emissions separated from earned yield.",
      argsSchema: {
        size: z
          .string()
          .optional()
          .describe("Optional position size in USD, e.g. 50000, to weight the recommendation."),
      },
    },
    ({ size }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Build a HYPE yield report.",
              "",
              "1. Call hl_staking to establish what the network itself pays.",
              "2. Call hyperevm_yields with category='all'.",
              "3. For the highest-paying row that the notes flag as mostly emissions, call",
              "   hyperevm_pool_history on it. A rate that has been falling for weeks is a",
              "   different proposition from the same number holding steady, and the daily",
              "   series is the only way to tell which one you are looking at.",
              "4. Present the options from safest to riskiest: direct staking, liquid staking,",
              "   lending, then LP and looping.",
              "",
              "Rules for the summary:",
              "- Treat the Base column as the real yield. Where APY is mostly emissions, say so",
              "  plainly and do not rank it above earned yield of similar size.",
              "- Mention impermanent loss wherever the IL column says yes.",
              "- Where APY is n/a, say the protocol does not publish it rather than skipping the row.",
              "- End with what you would actually pick and why, in two sentences.",
              size ? `\nThe position is about $${size}. Factor in that gas and wrapper fees matter less at that size.` : "",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "protocol-brief",
    {
      title: "Protocol brief",
      description: "One protocol on HyperEVM: size, what it does, where its yield sits, how it compares.",
      argsSchema: {
        protocol: z.string().describe("Protocol name, e.g. HyperLend, Kinetiq, Felix."),
      },
    },
    ({ protocol }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Brief me on ${protocol} on HyperEVM.`,
              "",
              "1. Call hyperevm_protocols with that name for size, category, audits and change.",
              "2. Call hyperevm_fees with the same name. TVL says how much is parked there;",
              "   fees say whether anyone is paying to use it, and the two often disagree.",
              "3. Call hyperevm_yields to find its pools and what they pay.",
              "4. Compare it to the two closest protocols by TVL in the same category.",
              "",
              "Be specific about what it does mechanically, not what it claims. If its APY is",
              "not published anywhere, say that — it is a fact about the protocol, not a gap in the data.",
              "The audit line reports whether DefiLlama has audit links on file. It is not a",
              "count of audits and not a judgement about the protocol; report it as what it is.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "wallet-review",
    {
      title: "Wallet review",
      description: "Read a public address and explain what it is exposed to.",
      argsSchema: {
        address: z.string().describe("Public address, 0x followed by 40 hex characters."),
      },
    },
    ({ address }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Review the public Hyperliquid address ${address}.`,
              "",
              "1. Call hyperevm_wallet for the account, positions, spot balances and staking.",
              "2. Call hl_market for any market where a position is open, to show current funding.",
              "",
              "Then explain, plainly:",
              "- what the account is actually exposed to, long or short and to what",
              "- what funding is costing or paying on those positions per day",
              "- whether idle spot or undelegated HYPE could be earning, referencing hyperevm_yields",
              "",
              "This is read-only public data. Do not suggest any transaction the user should sign.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "funding-scan",
    {
      title: "Funding scan",
      description: "Where Hyperliquid funding diverges from Binance and Bybit.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Scan Hyperliquid perp funding for divergence.",
              "",
              "1. Call hl_market with no symbol to get the most traded markets.",
              "2. For the top few by volume, call hl_market with that symbol to read predicted",
              "   funding across Hyperliquid, Binance and Bybit.",
              "3. For the widest divergence you find, call hl_funding on that symbol. A gap that",
              "   exists this hour and a gap that has held for a week are different findings, and",
              "   the share of hours the rate kept its sign is what separates them.",
              "4. Report where the annualised rates disagree most, and say for each whether the",
              "   history supports it or whether it is a single-hour reading.",
              "",
              "State the numbers and the venues. Do not size a trade or tell the user to place one.",
              "Hyperliquid settles funding hourly and the other venues every eight hours, so",
              "compare the annualised column rather than the raw rates.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
