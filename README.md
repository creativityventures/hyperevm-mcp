## Parcours français

Une lecture de sécurité du serveur MCP HyperEVM — capacités, réseau, données hostiles et invariants vérifiables — est disponible dans [docs/fr/](docs/fr/).

# hyperevm-mcp

**Ask your AI assistant about the Hyperliquid ecosystem in plain English.**
It reads. There is nowhere to put a private key, and that is the whole security model.

```
"what's the best HYPE yield right now"
```

```
Network HYPE staking APR: 1.80%–2.25% across 27 active validators.
Anything far above this is a reward or a risk premium.

## Liquid staking (HYPE LSTs)
| Protocol       | Token |   APY |  7d |     TVL |
| -------------- | ----- | ----: | --: | ------: |
| Kinetiq kHYPE  | KHYPE | 1.94% | n/a | $825.9M |
| stHYPE         | —     |   n/a | n/a | $173.9M |
| Kinetiq kmHYPE | —     |   n/a | n/a |  $36.1M |

## Lending markets
| Protocol         | Asset | Supply | Borrow |  Util | Max LTV |    TVL |
| ---------------- | ----- | -----: | -----: | ----: | ------: | -----: |
| HyperLend Pooled | USDC  |  5.84% |  7.36% | 88.2% |   62.0% | $12.1M |
| HyperLend Pooled | USD₮0 |  5.15% |  7.94% | 72.2% |   62.0% |  $1.8M |
| HyperLend Pooled | WHYPE |  0.61% |  0.98% | 78.0% |   60.0% | $42.1M |

## Other HYPE yield (LP, looping, fixed-term)
| Protocol     | Pool                  |    APY |  Base |       7d |   TVL | IL  |
| ------------ | --------------------- | -----: | ----: | -------: | ----: | --- |
| nest CL      | WHYPE-USDC (0.0638%)  | 38.80% |   n/a |  +0.33pp | $5.9M | yes |
| nest CL      | WHYPE-UBTC (0.2%)     | 32.78% |   n/a |  -9.93pp | $1.7M | yes |
| Ramses CL V2 | WHYPE-USDC (CL 0.11%) | 30.14% | 0.00% | -29.96pp | $1.8M | yes |

## Protocol vaults
| Vault                         |     TVL |     24h |      7d |     30d |
| ----------------------------- | ------: | ------: | ------: | ------: |
| Hyperliquidity Provider (HLP) | $225.7M | -0.003% | +0.010% | -0.024% |

Note: 3 of the rows above are mostly token emissions rather than earned yield.
Compare the APY and Base columns — emissions stop when the issuing team
decides they stop.
```

Four of those cells read `n/a`. That is the point: stHYPE publishes no yield pool, and kHYPE's weekly delta came back from the source implying the pool paid nothing seven days ago, which its own daily history contradicts. A number we cannot stand behind is not printed.

The vault row shows the same rule twice over. HLP has no pool on DefiLlama at all,
so a table built from that source alone silently omits the largest single place
to deposit on the chain — it is read from Hyperliquid instead. And Hyperliquid's
own APR field for it is *not* shown, because the same value means one thing as
an annual rate and something 365 times larger as a daily one, and the vault's
history does not settle which. What is shown is realised profit and loss per
window, divided here, where the arithmetic is ours to defend.

Then ask whether to believe one of those rates:

```
"has that Ramses WHYPE-USDC pool actually been paying 100%?"
```

```
## Pool history
Pool:                   WHYPE-USDC
Project:                Ramses CL V2
APY now:                16.86%
APY 7d ago:             144.75%
APY 30d ago:            107.77%
Earned vs emitted now:  0.00% earned · 16.86% emitted
TVL change over window: -10.7%

| Date (UTC) |     APY | Earned | Emitted |   TVL |
| ---------- | ------: | -----: | ------: | ----: |
| 2026-06-27 | 107.77% |  0.00% | 107.77% | $1.9M |
| 2026-07-09 |  70.09% |  0.00% |  70.09% | $2.0M |
| 2026-07-21 |  58.80% |  0.00% |  58.80% | $1.8M |
| 2026-07-26 |  16.86% |  0.00% |  16.86% | $1.7M |
```

Zero earned, every day, for a month.

## Install

**Claude Code**

```bash
claude mcp add hyperevm -- npx -y @sand0vvv/hyperevm-mcp
```

**Cursor, Claude Desktop, or any MCP client** — add to the config file:

```json
{
  "mcpServers": {
    "hyperevm": {
      "command": "npx",
      "args": ["-y", "@sand0vvv/hyperevm-mcp"]
    }
  }
}
```

That is the whole setup. Nothing to fill in afterwards — there is no account to authenticate against.

## Try asking

- *what's the best HYPE yield right now*
- *compare lending rates on HyperEVM*
- *which HYPE pools are just token emissions and which actually earn*
- *has that 40% APY held up, or is it decaying*
- *is BTC funding actually stable, or was that one hour*
- *who earns the most fees on this chain*
- *could I actually get out of $500k of HYPE*
- *which protocols grew this week*
- *tell me about HyperLend*
- *what's in this wallet: 0x…*
- *where should I stake HYPE and what does the commission cost me*

## Tools

Nine tools. Five report the present, three report how it got there, one reads an address.

| Tool | What it answers |
| --- | --- |
| `hyperevm_yields` | Every yield on HYPE in one table: liquid staking, lending with supply/borrow/utilisation/max LTV, LP and looping, and the HLP vault — with earned yield separated from token emissions |
| `hyperevm_protocols` | What is deployed on HyperEVM: chain TVL, per-protocol TVL, 1d/7d change, sortable by size or weekly growth; a detail card for any one protocol |
| `hyperevm_fees` | Fees users actually paid, ranked over 24h/7d/30d. TVL says how much money sits somewhere; this says whether anyone is paying to use it |
| `hl_market` | Perp mark price, funding hourly and annualised, open interest, 24h volume; spot pairs; predicted funding across Hyperliquid, Binance and Bybit |
| `hl_staking` | HYPE validators ranked by predicted APR, with commission, uptime and stake share — what the network pays before any wrapper takes its cut |
| `hyperevm_pool_history` | One pool's APY and TVL over weeks, split into earned versus emitted — so a headline rate can be checked against its own history |
| `hl_funding` | How funding actually behaved over days: average, range, how much of the time it held its sign, and what the position would have paid |
| `hl_orderbook` | Spread and resting depth, and whether a given trade size fills inside the visible book — or a plain statement that it does not |
| `hyperevm_wallet` | Any public address: account value, open positions with entry, unrealised PnL and liquidation price, spot balances, HYPE staking |

The pairs are deliberate. `hyperevm_yields` and `hl_market` tell you what a number is now; `hyperevm_pool_history` and `hl_funding` tell you whether to believe it. A 47% pool that has been 100% emissions for a month and a 20% pool earning fees are not the same product, and only the second pair can tell them apart.

## Slash commands

The server also ships MCP prompts, which appear as slash commands in Claude Code:

| Prompt | What it does |
| --- | --- |
| `yield-report` | Staking, liquid staking, lending and LP in one pass, ranked with emissions called out |
| `protocol-brief` | One protocol: size, mechanics, where its yield sits, how it compares |
| `wallet-review` | A public address: exposure, funding cost per day, idle balances |
| `funding-scan` | Where Hyperliquid funding diverges from Binance and Bybit |

## What this server does not do

It has no write path. Not "disabled by default" — the code to sign or send anything does not exist.

- **Nothing here can move money.** The code that would sign a transaction is not in this package.
- Nothing to configure either: the server reads no environment variables, so there is nothing to leak.
- The filesystem is never touched, no process is ever started, and no telemetry leaves the machine.
- Talks to exactly four hosts, hardcoded in [`src/core/http.ts`](src/core/http.ts):
  `api.hyperliquid.xyz`, `api.llama.fi`, `yields.llama.fi`, `rpc.hyperliquid.xyz`.
  No tool takes a URL, host or chain as a parameter.

**None of that is a promise — it is a test.** `npm run audit` checks every line above against the
source and exits non-zero if one stops being true; it runs in CI before publish. Adding a `fs` import
or a second network host fails the build rather than reaching you:

```
$ npm run audit
capability
  ok    does not read or write the filesystem
  ok    does not spawn processes
  ok    does not open raw sockets or listen
  ok    does not evaluate code at runtime
  ok    reads no environment variables — there is nothing to configure
  ok    no crypto, signing or key handling anywhere
network surface
  ok    contacts exactly 4 hosts, all hardcoded
  ok    no tool accepts a URL, host or endpoint as a parameter
  ok    every outbound call goes through the allowlisted fetch wrapper
type-level guarantee
  ok    the Safe escape hatch exists in exactly one file
  ok    renderers accept only Safe text, so unsanitised output cannot compile
  ok    prompts are authored here, never assembled from network data
data handling
  ok    never reads free-text descriptions from upstream
  ok    stdout carries the MCP protocol only
  ok    every tool answers through the envelope, including on failure
supply chain
  ok    no install-time lifecycle scripts
  ok    exactly 2 direct dependencies
  ok    published tarball contains build output only

every claim in the README is enforced here
```

The whole server is a few thousand lines of TypeScript. It is meant to be read before you install it.

## Three details worth knowing

**Lending rates are not where they look like they are.** DefiLlama's `/pools` reports `0.00%` for
collateral markets — truthfully, since their supply rate really is zero. The rate lives in a second
endpoint, `/lendBorrow`, joined on the pool id. A naive integration prints a table of zeros over a
$239M market. This one joins them and shows supply, borrow and utilisation separately.

**Missing data is shown as missing.** stHYPE ($172M) and beHYPE publish no yield pool on DefiLlama,
so their APY appears as `n/a` next to their real TVL, with the network staking APR printed above as a
reference. A zero standing in for "unknown" would be the most expensive thing this tool could print.

**Emissions are not yield.** The top pools by headline APY are often paying entirely in their own
token. The table carries a `Base` column next to `APY`, so `48.86% / base 0.00%` reads as what it is,
and a note names the rows where most of the number is emissions. The `7d` column shows the same
thing over time: that pool's APY fell 30 percentage points in a week.

## Third-party text and prompt injection

This server is read-only and cannot act. But it carries text written by strangers into your agent's
context, next to whatever else that agent can do — a wallet, a shell. Validator names on Hyperliquid
are free text set by whoever runs the validator; DefiLlama protocol names come from pull requests.
So the text is treated as hostile, in three layers.

**1. Fields that are not needed are never read.** `description` — 445 characters of free text on a
validator, 599 on a DefiLlama protocol — is not parsed anywhere in the code. The audit fails the build
if that changes.

**2. An allowlist, not a blocklist.** Everything printed passes a filter that keeps letters, digits,
currency signs and a short list of punctuation, and drops everything else. Not a list of bad
sequences to catch — a list of what may pass. So `<|im_start|>`, `[INST]`, `###`, `{{`, backticks and
table pipes cannot survive, because the characters that build them are not on the list. Input is
NFKC-normalised first, so full-width lookalikes fold to ASCII before the filter rather than after.

**3. The type system, not discipline.** Sanitised text has its own type. The renderers accept nothing
else, so printing a raw upstream field is a compile error rather than a code-review miss. There is
exactly one place where that type can be created from a plain string, and the audit fails the build
if a second appears.

A test feeds a poisoned upstream response — chat-template markers, a `javascript:` URL, an injected
instruction, a fence in the slug — through a real tool and asserts that none of it reaches the output
in a form that can do anything.

**What this does not do:** it cannot stop plain English. A validator named "ignore previous
instructions" still reads as those words. The answers to that are the field whitelist, the 24-character
cap, and the fact that this server exposes no action for such a sentence to trigger — not a cleverer
filter. Anyone claiming a filter solves prompt injection is selling something.

Details in [SECURITY.md](SECURITY.md).

## Requirements

Node 20 or newer. Two direct dependencies: `@modelcontextprotocol/sdk` and `zod`.
(The SDK brings its own tree, as it does for every MCP server; nothing else is added on top.)

## Development

```bash
npm install
npm test          # build, unit tests, behaviour checks — runs offline
npm run verify    # the above plus the self-audit and a real MCP handshake
```

Individually:

```bash
npm run build
node scripts/test.mjs           # units: numbers, tables, the sanitiser, the cache
npm run check     # behaviour: injection end-to-end, allowlist, retry, stale fallback, outage
npm run audit     # enforces every claim in this README against the source
npm run preflight # fails if this repository contains anything that should not be public
npm run smoke     # every tool against the live public APIs
npm run stdio     # spawn the server and speak MCP to it
```

The unit tests cover the parts that decide what a reader sees: that "unknown"
renders as `n/a` and never as `0`, that percentage points and percentages stay
different units, that a cell cannot forge a table column, that a failed refresh
serves the previous answer and says so. The behaviour checks drive poisoned
upstream responses through whole tools.

## Disclaimer

Unofficial and community-built. Not affiliated with Hyperliquid or with any protocol listed.
Data comes from public APIs and may be delayed or wrong; DefiLlama refreshes roughly every 30 minutes.
When a refresh fails the previous answer is served with a visible "REFRESH FAILED, this is N min old"
label rather than an error — old data is useful, old data pretending to be fresh is not.
Not financial advice.

MIT © sand0vvv
