#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as hlFunding from "./tools/hl_funding.js";
import * as hlMarket from "./tools/hl_market.js";
import * as hlStaking from "./tools/hl_staking.js";
import * as fees from "./tools/hyperevm_fees.js";
import * as poolHistory from "./tools/hyperevm_pool_history.js";
import * as protocols from "./tools/hyperevm_protocols.js";
import * as wallet from "./tools/hyperevm_wallet.js";
import * as yields from "./tools/hyperevm_yields.js";
import { describe, logErr } from "./core/errors.js";
import { failure } from "./format/envelope.js";
import { registerPrompts } from "./prompts.js";

/**
 * hyperevm-mcp — read-only MCP server for the Hyperliquid / HyperEVM ecosystem.
 *
 * There are no keys, no wallet, no signing and no write path anywhere in this
 * process. It reads four public hosts, formats what they return, and prints it.
 *
 * stdout belongs to the MCP protocol. Anything diagnostic goes to stderr.
 */

const VERSION = "1.2.0";

/** Every tool is read-only and touches only public endpoints. */
const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

async function main(): Promise<void> {
  const server = new McpServer({ name: "hyperevm-mcp", version: VERSION });

  server.registerTool(
    yields.name,
    {
      title: "HyperEVM yields",
      description: yields.description,
      inputSchema: yields.inputSchema,
      annotations: { title: "HyperEVM yields", ...READ_ONLY },
    },
    async (args) => text(await guard(yields.name, () => yields.run(args))),
  );

  server.registerTool(
    protocols.name,
    {
      title: "HyperEVM protocols",
      description: protocols.description,
      inputSchema: protocols.inputSchema,
      annotations: { title: "HyperEVM protocols", ...READ_ONLY },
    },
    async (args) => text(await guard(protocols.name, () => protocols.run(args))),
  );

  server.registerTool(
    hlMarket.name,
    {
      title: "Hyperliquid markets",
      description: hlMarket.description,
      inputSchema: hlMarket.inputSchema,
      annotations: { title: "Hyperliquid markets", ...READ_ONLY },
    },
    async (args) => text(await guard(hlMarket.name, () => hlMarket.run(args))),
  );

  server.registerTool(
    hlStaking.name,
    {
      title: "HYPE staking",
      description: hlStaking.description,
      inputSchema: hlStaking.inputSchema,
      annotations: { title: "HYPE staking", ...READ_ONLY },
    },
    async (args) => text(await guard(hlStaking.name, () => hlStaking.run(args))),
  );

  server.registerTool(
    wallet.name,
    {
      title: "Hyperliquid wallet",
      description: wallet.description,
      inputSchema: wallet.inputSchema,
      annotations: { title: "Hyperliquid wallet", ...READ_ONLY },
    },
    async (args) => text(await guard(wallet.name, () => wallet.run(args))),
  );

  server.registerTool(
    poolHistory.name,
    {
      title: "Pool history",
      description: poolHistory.description,
      inputSchema: poolHistory.inputSchema,
      annotations: { title: "Pool history", ...READ_ONLY },
    },
    async (args) => text(await guard(poolHistory.name, () => poolHistory.run(args))),
  );

  server.registerTool(
    fees.name,
    {
      title: "HyperEVM fees",
      description: fees.description,
      inputSchema: fees.inputSchema,
      annotations: { title: "HyperEVM fees", ...READ_ONLY },
    },
    async (args) => text(await guard(fees.name, () => fees.run(args))),
  );

  server.registerTool(
    hlFunding.name,
    {
      title: "Funding history",
      description: hlFunding.description,
      inputSchema: hlFunding.inputSchema,
      annotations: { title: "Funding history", ...READ_ONLY },
    },
    async (args) => text(await guard(hlFunding.name, () => hlFunding.run(args))),
  );

  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logErr(`hyperevm-mcp ${VERSION} ready on stdio — read-only, no keys required`);
}

function text(body: string) {
  return { content: [{ type: "text" as const, text: body }] };
}

/**
 * Nothing unexpected reaches the model as a stack trace. An unhandled failure
 * becomes the same honest sentence as an expected one.
 */
async function guard(tool: string, fn: () => Promise<string>): Promise<string> {
  try {
    return await fn();
  } catch (err) {
    logErr(`${tool} failed: ${describe(err)}`);
    return failure(tool, describe(err));
  }
}

main().catch((err: unknown) => {
  logErr(`fatal: ${describe(err)}`);
  process.exit(1);
});
