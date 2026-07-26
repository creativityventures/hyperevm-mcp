// Manual smoke run against the live public APIs.
// Not shipped to npm (package.json "files" is dist only).
//   node scripts/smoke.mjs            -> run everything
//   node scripts/smoke.mjs yields     -> run one case by name substring
import * as yields from "../dist/tools/hyperevm_yields.js";
import * as protocols from "../dist/tools/hyperevm_protocols.js";
import * as market from "../dist/tools/hl_market.js";
import * as wallet from "../dist/tools/hyperevm_wallet.js";
import * as staking from "../dist/tools/hl_staking.js";

// Public addresses, used only to exercise each rendering path:
//   burn address       — carries spot balances
//   HLP protocol vault — carries perp account value
//   a public market maker — carries open positions
const BURN = "0x0000000000000000000000000000000000000000";
const HLP_VAULT = "0xdfc24b077bc1425ad1dea75bcb6f8158e10df303";
const ACTIVE_TRADER = "0x010461c14e146ac35fe42271bdc1134ee31c703a";

const cases = [
  ["yields:all", () => yields.run({})],
  ["yields:lst", () => yields.run({ category: "lst" })],
  ["yields:lending", () => yields.run({ category: "lending" })],
  ["yields:other", () => yields.run({ category: "other", limit: 5 })],
  ["protocols:list", () => protocols.run({ limit: 12 })],
  ["protocols:hyperlend", () => protocols.run({ name: "HyperLend" })],
  ["protocols:unknown", () => protocols.run({ name: "zzzznotreal" })],
  ["market:perps", () => market.run({ limit: 8 })],
  ["market:btc", () => market.run({ symbol: "BTC" })],
  ["market:spot", () => market.run({ market: "spot", limit: 6 })],
  ["market:missing", () => market.run({ symbol: "NOTACOIN" })],
  ["wallet:positions", () => wallet.run({ address: ACTIVE_TRADER, limit: 5 })],
  ["wallet:spot", () => wallet.run({ address: BURN, limit: 5 })],
  ["wallet:vault", () => wallet.run({ address: HLP_VAULT })],
  ["wallet:bad-address", () => wallet.run({ address: "0xnothex" })],
  ["staking:active", () => staking.run({ limit: 8 })],
  ["staking:all", () => staking.run({ limit: 5, include_inactive: true })],
];

const filter = process.argv[2] ?? "";
let failures = 0;

for (const [label, fn] of cases) {
  if (filter && !label.includes(filter)) continue;
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    console.log(`\n${"=".repeat(78)}\n### ${label}  (${ms} ms, ${out.length} chars)\n${"=".repeat(78)}`);
    console.log(out);
    if (out.length > 6000) {
      console.log(`!! OVER BUDGET: ${out.length} chars`);
      failures++;
    }
  } catch (err) {
    failures++;
    console.log(`\n### ${label} THREW: ${err?.message ?? err}`);
  }
}

console.log(`\n${failures === 0 ? "all cases returned output" : `${failures} case(s) failed`}`);
process.exit(failures === 0 ? 0 : 1);
