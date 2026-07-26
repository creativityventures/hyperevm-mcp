// Preflight. Runs before the first push and in CI before publishing.
//
// `scripts/audit.mjs` guards what the code is allowed to do. This guards what
// the repository is allowed to contain. The two failure modes it exists for:
// a working note that was never meant to be public gets committed, or a
// credential rides along inside a config file. Both are one `git add -A` away,
// both are permanent once pushed, and neither is caught by any test.
//
// The whitelist is deliberately a whitelist. A blacklist of "files we know are
// private" only protects against the files we already thought of.
//
//   node scripts/preflight.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);

/** Every path pattern allowed to exist in the published repository. */
const ALLOWED = [
  /^README\.md$/,
  /^SECURITY\.md$/,
  /^LICENSE$/,
  /^\.gitignore$/,
  /^package(-lock)?\.json$/,
  /^tsconfig\.json$/,
  /^server\.json$/,
  /^src\/.+\.ts$/,
  /^scripts\/.+\.mjs$/,
  /^\.github\/.+$/,
];

/** Entries that must be excluded locally, checked so a re-init cannot lose them. */
const MUST_EXCLUDE = ["internal/", "CLAUDE.md", ".claude/", ".fleet/", ".inbox/", "video/"];

/** Credentials. Checked in every tracked file, this one included. */
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, "GitHub token"],
  [/\bnpm_[A-Za-z0-9]{30,}/, "npm token"],
  [/\bsk-[A-Za-z0-9-]{20,}/, "API key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/(TOKEN|SECRET|PASSWORD|APIKEY|API_KEY)"?\s*[:=]\s*"[^"]{16,}"/i, "hardcoded credential"],
  [/\b[a-f0-9]{32,}\b/, "long hex string — could be a token"],
];

/**
 * Signs that a working note reached the repository.
 *
 * Cyrillic is here because every public document is written in English, so a
 * Cyrillic character means a private note landed in the repo whatever it says.
 *
 * This file is skipped for these patterns and only these: a scanner has to
 * contain the strings it looks for. It is still scanned for credentials above,
 * and the whitelist rule still applies to it.
 */
const SELF = "scripts/preflight.mjs";
const PRIVATE_NOTES = [
  [/[Ѐ-ӿ]/, "Cyrillic text — public files are English, this looks like a working note"],
  [/\b(OFFER|POSITIONING|DEMO|ANALYSIS|DATA_SOURCES|DECISIONS|HYPEREVM_BRIEF|PLAN|ECOSYSTEM|ARCHITECTURE|AUDIT_PLAN|SHOTLIST)\.md\b/, "reference to an internal document"],
  [/\binternal\//, "reference to the internal/ directory"],
];

let failures = 0;
function rule(claim, findings) {
  if (findings.length === 0) {
    console.log(`  ok    ${claim}`);
  } else {
    failures++;
    console.log(`  BROKEN ${claim}`);
    for (const f of findings.slice(0, 12)) console.log(`         ${f}`);
    if (findings.length > 12) console.log(`         … and ${findings.length - 12} more`);
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

console.log("\nhyperevm-mcp preflight\n");

// Nothing is tracked until the first `git add`, and an empty repository would
// pass every check below without meaning anything. Say so instead.
let tracked = [];
try {
  tracked = git("ls-files").split(/\r?\n/).filter(Boolean);
} catch {
  console.log("  not a git repository — nothing to check\n");
  process.exit(1);
}

if (tracked.length === 0) {
  console.log("  no files are tracked yet — run `git add -A` first, then re-run\n");
  process.exit(1);
}

console.log("what the repository contains");

rule(
  "every tracked file is on the publish whitelist",
  tracked.filter((f) => !ALLOWED.some((re) => re.test(f))).map((f) => `${f} is tracked but not public`),
);

function scan(patterns, files) {
  return files.flatMap((file) => {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) return [];
    const lines = fs.readFileSync(full, "utf8").split(/\r?\n/);
    const found = [];
    for (const [re, label] of patterns) {
      lines.forEach((line, i) => {
        if (re.test(line)) found.push(`${file}:${i + 1} ${label}`);
      });
    }
    return found.slice(0, 3);
  });
}

rule("no tracked file carries a credential", scan(SECRETS, tracked));

rule(
  "no tracked file carries a private working note",
  scan(PRIVATE_NOTES, tracked.filter((f) => f !== SELF)),
);

console.log("\nwhat keeps it that way");

// Checked only for paths that exist on this machine. A CI checkout has neither
// the private directories nor the local exclude file, and should not fail here.
const excludePath = path.join(root, ".git", "info", "exclude");
const excludeText = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf8") : "";
rule(
  "every private path present on this machine is excluded",
  MUST_EXCLUDE.filter((entry) => fs.existsSync(path.join(root, entry)))
    .filter((entry) => !excludeText.includes(entry))
    .map((entry) => `${entry} exists here but is missing from .git/info/exclude`),
);

// An ignored file is safe; an untracked file that is NOT ignored is one
// `git add -A` away from being published.
rule(
  "nothing private is sitting untracked and unignored",
  git("status", "--porcelain", "--untracked-files=all")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("??"))
    .map((l) => l.slice(3).trim())
    .filter((f) => !ALLOWED.some((re) => re.test(f)))
    .map((f) => `${f} is neither tracked, ignored, nor excluded`),
);

rule(
  "the npm tarball ships build output only",
  (() => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const files = pkg.files ?? [];
    const allowed = ["dist", "README.md", "LICENSE"];
    return files.filter((f) => !allowed.includes(f)).map((f) => `package.json files[] includes ${f}`);
  })(),
);

console.log(
  failures === 0
    ? "\nnothing here that should not be public\n"
    : `\n${failures} problem${failures === 1 ? "" : "s"} — do not push\n`,
);
process.exit(failures === 0 ? 0 : 1);
