// Self-audit. Runs in CI and fails the build.
//
// The README makes a list of promises: no keys, no filesystem, no processes, no
// telemetry, four hosts, two dependencies, no install scripts. A promise that is
// only enforced by good intentions is worth nothing to the person deciding
// whether to install this. Each promise below is checked mechanically, so
// breaking one stops the release rather than reaching a user.
//
//   node scripts/audit.mjs
import fs from "node:fs";
import path from "node:path";

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".ts")) files.push(full);
  }
})(path.join(root, "src"));

const sources = files.map((f) => ({
  path: path.relative(root, f).replace(/\\/g, "/"),
  raw: fs.readFileSync(f, "utf8"),
  code: stripComments(fs.readFileSync(f, "utf8")),
}));

const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

let failures = 0;
function rule(claim, findings) {
  if (findings.length === 0) {
    console.log(`  ok    ${claim}`);
  } else {
    failures++;
    console.log(`  BROKEN ${claim}`);
    for (const f of findings.slice(0, 6)) console.log(`         ${f}`);
  }
}

/** Matches an import or require of any of the given module names. */
function findModuleUse(names) {
  const found = [];
  for (const { path: p, code } of sources) {
    for (const name of names) {
      const re = new RegExp(`(from\\s+["'](?:node:)?${name}["'])|(require\\(\\s*["'](?:node:)?${name}["'])`);
      if (re.test(code)) found.push(`${p} uses ${name}`);
    }
  }
  return found;
}

function findPattern(re, label, skip = () => false) {
  const found = [];
  for (const { path: p, code } of sources) {
    if (skip(p)) continue;
    const lines = code.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (re.test(line)) found.push(`${p}:${i + 1} ${label}: ${line.trim().slice(0, 80)}`);
    });
  }
  return found;
}

console.log("\nhyperevm-mcp self-audit\n");

console.log("capability");
rule("does not read or write the filesystem", findModuleUse(["fs", "fs/promises"]));
rule("does not spawn processes", findModuleUse(["child_process", "worker_threads", "cluster"]));
rule("does not open raw sockets or listen", findModuleUse(["net", "dgram", "http", "https", "http2", "tls"]));
// `npm audit` reports advisories against the SDK's HTTP transports. This server
// speaks stdio and never loads them; the rule is what turns that sentence into
// something a reader does not have to take on trust. See SECURITY.md.
rule(
  "never loads the SDK's HTTP server stack, where its advisories live",
  findModuleUse(["hono", "@hono/node-server", "express", "cors", "express-rate-limit", "eventsource"]),
);
rule("does not evaluate code at runtime", findModuleUse(["vm"]).concat(
  findPattern(/\beval\s*\(|new\s+Function\s*\(/, "dynamic evaluation"),
));
rule("reads no environment variables — there is nothing to configure", findPattern(/process\.env/, "env read"));
rule("no crypto, signing or key handling anywhere", findModuleUse(["crypto"]).concat(
  findPattern(/privateKey|PRIVATE_KEY|signTransaction|\bmnemonic\b|\bseedPhrase\b/i, "key handling"),
));

console.log("\nnetwork surface");
{
  const httpFile = sources.find((s) => s.path === "src/core/http.ts");
  const expected = ["api.hyperliquid.xyz", "api.llama.fi", "yields.llama.fi", "rpc.hyperliquid.xyz"];
  const listed = [...(httpFile?.code.matchAll(/"([a-z0-9.-]+\.(?:xyz|fi))"/g) ?? [])].map((m) => m[1]);
  const unexpected = listed.filter((h) => !expected.includes(h));
  const missing = expected.filter((h) => !listed.includes(h));
  rule(
    `contacts exactly ${expected.length} hosts, all hardcoded`,
    [...unexpected.map((h) => `unexpected host ${h}`), ...missing.map((h) => `expected host missing: ${h}`)],
  );
  rule(
    "no tool accepts a URL, host or endpoint as a parameter",
    findPattern(/\b(url|host|endpoint|rpc|baseUrl)\s*:\s*z\./i, "network target as input"),
  );
  rule(
    "every outbound call goes through the allowlisted fetch wrapper",
    findPattern(/\bfetch\s*\(/, "direct fetch", (p) => p === "src/core/http.ts"),
  );
}

console.log("\ntype-level guarantee");
rule(
  "the Safe escape hatch exists in exactly one file",
  findPattern(/as\s+Safe\b/, "unchecked cast to Safe", (p) => p === "src/format/safe.ts"),
);
{
  // The renderers must not accept a plain string, or the brand proves nothing.
  const findings = [];
  const tableSrc = sources.find((s) => s.path === "src/format/table.ts");
  if (!tableSrc) {
    findings.push("src/format/table.ts is missing");
  } else {
    if (!/rows:\s*Safe\[\]\[\]/.test(tableSrc.code)) findings.push("table() no longer requires Safe cells");
    if (!/pairs:\s*Array<\[string,\s*Safe\]>/.test(tableSrc.code)) {
      findings.push("facts() no longer requires Safe values");
    }
  }
  const envelopeSrc = sources.find((s) => s.path === "src/format/envelope.ts");
  if (!envelopeSrc || !/body:\s*Safe/.test(envelopeSrc.code)) {
    findings.push("envelope() no longer requires a Safe body");
  }
  rule("renderers accept only Safe text, so unsanitised output cannot compile", findings);
}
rule(
  "prompts are authored here, never assembled from network data",
  sources
    .filter((s) => s.path === "src/prompts.ts" && /clients\//.test(s.code))
    .map((s) => `${s.path} imports a network client`),
);

console.log("\ndata handling");
// Clients are the only place upstream JSON is touched, so that is where this
// invariant lives. The bracket form is checked everywhere as a second net —
// our own tool descriptions are plain identifiers and never look like this.
rule(
  "never reads free-text descriptions from upstream",
  findPattern(/\bdescription\b/, "description read", (p) => !p.startsWith("src/clients/")).concat(
    findPattern(/\[\s*["']description["']\s*\]/, "raw description access"),
  ),
);
rule(
  "stdout carries the MCP protocol only",
  findPattern(/console\.(log|info|warn|error)|process\.stdout/, "stdout write"),
);
{
  // Every tool must return through the envelope, which is where sanitising,
  // sourcing and the budget cap live.
  const bad = sources
    .filter((s) => s.path.startsWith("src/tools/"))
    .filter((s) => !/\benvelope\s*\(/.test(s.code) || !/\bfailure\s*\(/.test(s.code))
    .map((s) => `${s.path} does not use both envelope() and failure()`);
  rule("every tool answers through the envelope, including on failure", bad);
}

console.log("\nsupply chain");
{
  const lifecycle = ["preinstall", "install", "postinstall", "prepare", "prepack", "prepublish"];
  const present = lifecycle.filter((s) => pkg.scripts && s in pkg.scripts);
  rule("no install-time lifecycle scripts", present.map((s) => `package.json defines "${s}"`));
}
{
  const deps = Object.keys(pkg.dependencies ?? {});
  const allowed = ["@modelcontextprotocol/sdk", "zod"];
  const extra = deps.filter((d) => !allowed.includes(d));
  rule(`exactly ${allowed.length} direct dependencies`, extra.map((d) => `unexpected dependency ${d}`));
}
rule(
  "published tarball contains build output only",
  JSON.stringify(pkg.files) === JSON.stringify(["dist", "README.md", "LICENSE"])
    ? []
    : [`package.json "files" is ${JSON.stringify(pkg.files)}`],
);

console.log(
  `\n${failures === 0 ? "every claim in the README is enforced here" : `${failures} claim(s) no longer hold`}\n`,
);
process.exit(failures === 0 ? 0 : 1);

/** Crude but sufficient: keeps comments from tripping the code rules. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
