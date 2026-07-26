// The renderers. A table is where an unsanitised string would do its damage —
// a forged row, a broken column count, an escape from the markdown block — so
// these tests care about structure as much as about looks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { facts, section, subsection, table } from "../dist/format/table.js";
import { sanitize } from "../dist/format/sanitize.js";

const row = (...cells) => cells;

test("a table has a header, a rule and one line per row", () => {
  const out = table(["A", "B"], [row("1", "2"), row("3", "4")]);
  const lines = out.split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^\| A +\| B +\|$/);
  assert.match(lines[1], /^\| -+ \| -+ \|$/);
});

test("every row has the same number of columns as the header", () => {
  const out = table(["A", "B", "C"], [row("1", "2", "3"), row("x", "y", "z")]);
  for (const line of out.split("\n")) {
    assert.equal(line.split("|").length - 1, 4, `wrong column count: ${line}`);
  }
});

test("a short row is padded rather than shifting the columns", () => {
  // A missing cell must not pull the following columns left, which would
  // silently put a number under the wrong heading.
  const out = table(["A", "B", "C"], [row("1", "2")]);
  const body = out.split("\n")[2];
  assert.equal(body.split("|").length - 1, 4);
  assert.match(body, /\| 1 +\| 2 +\| +\|/);
});

test("right alignment marks the rule so a client renders numbers right", () => {
  const out = table(["N"], [row("1")], ["right"]);
  assert.match(out.split("\n")[1], /-*:/);
});

test("columns are as wide as their widest cell", () => {
  const out = table(["A"], [row("short"), row("a much longer cell")]);
  const [head, , first, second] = out.split("\n");
  assert.equal(head.length, first.length);
  assert.equal(first.length, second.length);
});

test("an empty row set renders nothing at all", () => {
  // Not a header with no body: an empty table reads as "we looked and there is
  // nothing", which is a different statement from "we did not look".
  assert.equal(table(["A", "B"], []), "");
});

test("a sanitised cell cannot forge an extra column", () => {
  // Live data contains "For LP | Maturity 24SEPT2026". The pipe is dropped by
  // the sanitiser rather than escaped, so there is nothing left to forge with.
  const hostile = sanitize("evil | injected | cells");
  const out = table(["A", "B"], [row(hostile, sanitize("ok"))]);
  for (const line of out.split("\n")) {
    assert.equal(line.split("|").length - 1, 3, `row has forged columns: ${line}`);
  }
  assert.ok(!out.includes("|", out.indexOf("evil")) || !hostile.includes("|"));
});

test("facts aligns its keys and keeps values verbatim", () => {
  const out = facts([
    ["Protocol", "Kinetiq kHYPE"],
    ["TVL on Hyperliquid", "$827.8M"],
  ]);
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  // Both values start at the same column.
  assert.equal(lines[0].indexOf("Kinetiq"), lines[1].indexOf("$827.8M"));
  assert.ok(lines[0].startsWith("Protocol:"));
});

test("facts survives a key longer than every value", () => {
  const out = facts([["A very long label indeed", "x"]]);
  assert.ok(out.endsWith(" x"));
  assert.ok(out.startsWith("A very long label indeed:"));
});

test("headings are ours, so they are plain markdown", () => {
  assert.equal(section("Title", "body"), "## Title\n\nbody");
  assert.equal(subsection("Sub", "body"), "### Sub\n\nbody");
});
