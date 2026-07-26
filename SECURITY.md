# Security

This server is read-only by construction. The interesting question is not whether it can move your funds — it has no mechanism to — but what it does with text written by strangers, because that text ends up in the context of a model that has other tools connected.

That threat is covered first, at length, because it is the real one.

## What is impossible by construction

The server holds no private keys, signs nothing, has no write endpoints, asks for no environment variables, reads and writes no files, spawns no processes, opens no ports, and collects no telemetry.

None of that is a promise about our intentions. There is no code path that could do any of it, `npm run audit` fails the build if one appears, and the whole server is ~4,100 lines you can read in an afternoon.

## T1. Indirect prompt injection — the main risk

**The shape of it.** The server cannot act. But it carries **third-party text into the model's context**, and in a real client that model usually has other MCP servers connected — a wallet, a shell, git, CI. An instruction hidden in retrieved data gets executed by somebody else's tool. This is a confused deputy: the vulnerable component is not this server, it is whatever trusts what this server returns.

**The surface — fields that physically exist in today's responses:**

| Field | Written by | Size | Notes |
|---|---|---|---|
| `validatorSummaries[].description` | the validator, permissionless | up to 445 chars | mainnet already contains newlines, markdown, URLs |
| `validatorSummaries[].name` | the validator | up to 39 chars | — |
| DefiLlama `protocols[].description` | protocol's own PR | up to 599 chars | moderated by someone else, not by us |
| DefiLlama `name`, `url`, `twitter` | same | — | — |
| `pools[].poolMeta` | DefiLlama | — | already contains `\|`, which breaks a markdown table |
| `pools[].symbol` | DefiLlama | — | — |
| Hyperliquid spot tickers | deployer, via auction | ≤ 6 chars | all 476 checked: `A-Z0-9` only |

The cost of attacking the first row is the cost of running a validator. Not free, but not a defence either.

**Three layers, each stricter than the last.**

**Layer 1 — fields nobody needs are never read.** `description` is not parsed anywhere in the codebase, from validators or from DefiLlama. A dedicated audit rule fails the build if that changes. Only fields that get printed are extracted at all.

**Layer 2 — an allowlist of characters, not a blocklist of strings.** Everything printed passes a filter that admits letters, digits, currency signs, and a short list of punctuation — `. , _ : / & + ( ) ' % @ ? ! -` — and drops everything else.

This is deliberately not a list of bad strings, which can always be worked around. It is a list of what may pass. `<|im_start|>`, `[INST]`, `<<SYS>>`, `###`, `{{`, backticks, table pipes and angle brackets do not survive it, because the characters they are built from are not on the list. Strings are NFKC-normalised first, so full-width lookalikes (`＜｜＞`) collapse to ASCII **before** the check rather than after.

A side effect worth knowing: a pipe in live data (`"For LP | Maturity 24SEPT2026"`) is not escaped, it disappears. There is nothing left to forge a table row with.

**Layer 3 — types instead of discipline.** Sanitised text has its own type, `Safe`. The renderers — `table()`, `facts()`, `envelope()` — accept nothing else, so printing a raw upstream field is a **compile error** rather than a missed review. `Safe` can be created from an ordinary string in exactly one file, and the audit fails the build if a second one appears.

Alongside those three:

- **Numbers are never echoed as strings.** Anything that should be a number is parsed, checked for finiteness, and reformatted.
- **The JSON block carries the same values as the table** — already sanitised, same truncation — rather than raw upstream fields. There is no "raw JSON as a second block", which would be a direct channel from arbitrary third-party text into the model's context.
- **An explicit untrusted-data frame** on every response.
- **Tests at both levels.** The filter has unit tests over the whole allowlist rather than a handful of known-bad markers, and an end-to-end test feeds a poisoned upstream response — chat-template markers, a `javascript:` URL, an instruction to move funds, a code fence in a slug — through a real tool and asserts that none of it arrives intact.

**What this does not promise.** The filter does not stop ordinary English. A validator named "ignore previous instructions" still reads as those words. The answer to that is the field whitelist, truncation to 24 characters, and the fact that this server offers no action such a phrase could trigger — not a cleverer filter. Anyone claiming a filter solves prompt injection is selling something.

## T2. SSRF and request retargeting

No tool accepts a URL, host, chain, endpoint, or arbitrary path. The host list is hardcoded in `core/http.ts`: `api.hyperliquid.xyz`, `api.llama.fi`, `yields.llama.fi`, `rpc.hyperliquid.xyz`. HTTPS only, and `redirect: "error"` — a redirect to another host is a failure, not a hop.

Inputs are validated before any network call: address against `^0x[a-fA-F0-9]{40}$`, symbol against `[A-Z0-9/@-]{1,24}`, `category` against an enum, numbers clamped. Nothing from input reaches a URL path unescaped; a protocol `slug` comes from the `/protocols` response, never assembled from a user string.

## T3. Supply chain

The most likely real compromise vector for any npm package, and the first thing worth checking.

- **Direct** runtime dependencies: `@modelcontextprotocol/sdk` and `zod`. Fetch is native. No HTTP client, no utility packages.
- Said plainly rather than left to be discovered: the official SDK brings **94 transitive packages** (express, hono, jose, ajv — its own HTTP and OAuth transports, which a stdio server never uses). That tree is identical for every MCP server built on the official SDK. Our contribution to it is zero packages. The alternative — hand-rolling JSON-RPC over stdio for a zero-dependency tree — was rejected, because a reviewer is more likely to trust the official SDK than a homemade transport.
- No `postinstall` / `prepare` / `preinstall` scripts. Lockfile committed. `engines.node >= 20`. `files: ["dist", "README.md", "LICENSE"]` — the tarball is 44.3 kB across 24 files.
- Published with `npm publish --provenance` from GitHub Actions over OIDC, with 2FA on the account. Provenance is visible on the package page and ties the artifact to a commit.
- The git tag equals the npm version. No re-publishing over a released version.

### What `npm audit` reports, and why it does not apply here

You will likely run it early, so here is the finding and an honest reachability analysis rather than a dismissal:

```
2 moderate severity vulnerabilities
@hono/node-server <2.0.5
Path traversal in serve-static on Windows via encoded backslash (%5C)
  ← @modelcontextprotocol/sdk >=1.25.0
```

- Hono is the SDK's HTTP transport. The vulnerability is in `serve-static` — serving files over HTTP.
- This server runs over **stdio**. Neither `serve-static` nor Hono is imported or instantiated; the code that would reach them is never loaded into the process.
- There is nothing to serve and nothing to listen on: no port is opened and the filesystem is never touched. Both properties have their own audit rules.
- The rule **"never loads the SDK's HTTP server stack"** fails the build if `hono`, `express` or their neighbours ever appear in imports. So the paragraph above is a test, not a claim.

This will be updated as soon as the SDK bumps Hono.

## T4. Reading someone else's address (`hyperevm_wallet`)

The tool reads a public address and nothing else. No key, no signature, no transaction — the mechanism does not exist, and a separate audit rule checks that.

- The address is validated against `^0x[a-fA-F0-9]{40}$` **before** the first byte goes out. A test confirms that garbage input produces no network call at all.
- No ENS or any other external resolver — that would be a fifth domain.
- The address is never logged: the server writes no files and no telemetry, and stderr receives only the startup line.
- The three requests are independent. One failing blanks its own section, not the whole response, and the note says which part could not be read.

## T5. Resource exhaustion

- 7 s timeout per request with `AbortController`; one retry with the same 7 s budget for transient failures (timeout, dropped connection, 429, 5xx). Permanent errors — 404, wrong host, malformed JSON — are not retried. Worst case ≈ 14.3 s: the retry is not given less time than the first attempt, because the largest response here is 11 MB and a shorter second attempt would be guaranteed to fail.
- A stale cache survives a source outage: the previous answer is returned marked `REFRESH FAILED, this is N min old`. Degrades rather than dies, and never lies about freshness.
- Response size cap 25 MB (`/pools` alone is 11 MB, so the usual 5 MB would break the main tool).
- 60 s cache per endpoint.
- Output ceiling ≈ 6,000 characters, `limit` ≤ 50.

That last point is a security property, not a cosmetic one: a single call dumping 11 MB into a context window costs the reader real money and is a denial-of-service against the thing you were actually trying to do.

## T6. Wrong numbers

A technically safe server that prints a wrong rate does more damage than one that crashes.

- **No silent zeros.** Source unreachable → `source unavailable`. Field missing → `n/a`. `0.00%` is printed only when the API actually returned zero.
- Every response names its source and carries `fetched at HH:MM UTC`.
- A sanity anchor for liquid staking: the network staking APR is known from `validatorSummaries`. An LST above the network APR with no explicit reward token is a reason to re-check, not to print.

## T7. Legal and reputational

MIT. The README states plainly: `unofficial · community-built · not affiliated with any protocol listed · not financial advice`. No protocol logos or branding are used anywhere.

## The audit is mechanical

`npm run audit` runs in CI before publishing and fails the build if any claim in the README stops being true. Nineteen rules in five groups, alongside `npm run preflight`, which fails if the repository itself ever contains something that was never meant to be public:

**Capability** — no filesystem, no processes, no sockets or listening ports, no runtime code execution (`eval`, `new Function`, `vm`), no environment variables, no crypto, signing or key handling.

**Network surface** — exactly four hardcoded hosts and no more; no tool accepts a URL, host or endpoint as a parameter; every outbound call goes through the allowlisted wrapper, so a direct `fetch` outside `core/http.ts` is a failure.

**Type-level guarantee** — `Safe` is constructible in exactly one file; renderers accept nothing else; the SDK's HTTP server stack is never imported.

**Data handling** — free-text `description` is never read from upstream; stdout carries only MCP protocol; every tool answers through the envelope, including on the failure path.

**Supply chain** — no install scripts; exactly two direct dependencies; the tarball contains build output only.

The audit has been checked for teeth: a scratch file containing `import fs`, `child_process`, `eval`, `process.env` and a direct `fetch` to an outside domain trips five rules at once.

The point is narrow. A promise resting only on the author's good faith is worth nothing to the person deciding whether to install this. Here, adding filesystem access or a second domain stops the release instead of reaching a user.

## Verified before publishing

- No `description` field is read by any client — the word does not occur in `src/clients/`
- The host list in `http.ts` has exactly four entries
- `package.json` has no lifecycle scripts; two direct dependencies
- `npm pack` contains only `dist/`, README and LICENSE — 44.3 kB, 24 files
- No `console.log` reaches stdout; `scripts/stdio-check.mjs` fails if anything non-JSON does
- Behaviour with the network down: a sentence, not a stack trace, and never `0.00%` in place of unknown
- Sanitiser: 8 checks including bidi characters, pipes, and an attempt to escape a code fence
- A host outside the allowlist, and plain http, are refused before the network
- MCP handshake, `tools/list`, a real call, and schema rejection — `scripts/stdio-check.mjs`
- The JSON block passes through `deepSanitize`: a string containing a code fence cannot escape the block
- Rates and prices cross-checked against independent sources — 0 divergence on rates, ≤ 0.12 % on prices
- All 19 audit rules pass, and the audit is confirmed to catch deliberate violations
- The wallet address is validated before the network — a test confirms no call happens on garbage input
- A stale cache is served with an explicit age marker rather than silently
- One retry on transient failure; 404 is not retried — both under test

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting on this repository rather than a public issue. A first response should take a couple of days.

Findings about the retrieved-data path are especially welcome — a way to get characters outside the allowlist into rendered output, or a way to make a renderer accept an unsanitised string, is the class of bug this document is most concerned with.
