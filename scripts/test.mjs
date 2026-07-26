// Runs the unit tests.
//
// This exists because `node --test "test/*.test.mjs"` is not portable: Node 20
// treats the pattern as a literal filename, newer versions expand it, and cmd
// on Windows does not expand it at all. The CI runner is on the version we
// claim to support, so it found nothing and the publish stopped one step short.
//
// Enumerating the files here removes the shell and the Node version from the
// question entirely, and a new test file is picked up without anyone having to
// remember to list it.
//
//   node scripts/test.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.join(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")),
  "..",
);
const dir = path.join(root, "test");

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort()
  .map((f) => path.join(dir, f));

if (files.length === 0) {
  console.log("no test files found in test/ — that is a broken checkout, not a pass");
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
