// The single door every third-party string passes through.
//
// scripts/checks.mjs already drives poisoned responses through whole tools.
// These tests go the other way: they exercise the filter directly, across the
// whole allowlist rather than a handful of known-bad markers, because the
// design claim is "only these characters pass", not "these attacks fail".
import { test } from "node:test";
import assert from "node:assert/strict";
import { deepSanitize, safeUrl, sanitize, sanitizeJson, sanitizeOr } from "../dist/format/sanitize.js";

test("the allowlist passes exactly what it says it passes", () => {
  const allowed = "abcXYZ 0123456789 .,_:/&+()'%@?!-$€£";
  assert.equal(sanitize(allowed, 100), allowed);
});

test("everything used to open a structure is dropped", () => {
  // Not a blocklist of attacks — the characters a marker is built from.
  for (const ch of ["<", ">", "|", "`", "{", "}", "[", "]", "#", "*", "\\", '"', "~", "^", ";", "="]) {
    const out = sanitize(`a${ch}b`, 32);
    assert.equal(out, "ab", `${JSON.stringify(ch)} reached the output`);
  }
});

test("known chat-template markers cannot survive in usable form", () => {
  for (const marker of ["<|im_start|>", "<|endoftext|>", "[INST]", "<<SYS>>", "###", "{{system}}", "```"]) {
    const out = sanitize(`name ${marker} tail`, 64);
    assert.ok(!/[<>|`{}\[\]#*]/.test(out), `${marker} left structural characters: ${out}`);
  }
});

test("full-width lookalikes are folded before the check, not after", () => {
  // NFKC first, or "＜｜＞" would pass as letters and render as "<|>".
  const out = sanitize("＜｜ｉｍ＿ｓｔａｒｔ｜＞", 64);
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes("|"));
  assert.ok(!out.includes(">"));
});

test("invisible and bidi characters are removed, not rendered as spaces", () => {
  const hidden = "safe​name‮reversed⁦iso﻿bom";
  const out = sanitize(hidden, 64);
  assert.equal(out, "safenamereversedisobom");
});

test("control characters become spaces so words do not fuse", () => {
  // A newline in a validator name would otherwise join two words into one.
  assert.equal(sanitize("line one\nline two", 64), "line one line two");
  assert.equal(sanitize("a\tb", 64), "a b");
  assert.equal(sanitize("a\r\nb", 64), "a b");
});

test("runs of whitespace collapse and the result is trimmed", () => {
  assert.equal(sanitize("   lots     of   space   ", 64), "lots of space");
});

test("legitimate names survive intact", () => {
  for (const name of [
    "Kinetiq kHYPE",
    "HyperLend Pooled",
    "WHYPE-USDC (0.0637%)",
    "Purrposeful x HyBridge",
    "infinitefield.xyz",
    "Nansen-HypurrCollective HYPE Staking",
    "USD₮0",
  ]) {
    assert.equal(sanitize(name, 64), name, `mangled a real name: ${name}`);
  }
});

test("truncation marks itself and never exceeds the limit", () => {
  const out = sanitize("a".repeat(100), 10);
  assert.equal(out.length, 10);
  assert.ok(out.endsWith("…"));
});

test("a string exactly at the limit is not truncated", () => {
  const ten = "abcdefghij";
  assert.equal(sanitize(ten, 10), ten);
});

test("anything that is not a string becomes empty, never 'undefined'", () => {
  for (const bad of [null, undefined, 42, {}, [], true, Symbol("x")]) {
    assert.equal(sanitize(bad), "", `${String(bad)} produced output`);
  }
});

test("sanitizeOr falls back only when nothing survives the filter", () => {
  assert.equal(sanitizeOr("Kinetiq", "?", 32), "Kinetiq");
  assert.equal(sanitizeOr(null, "?", 32), "?");
  assert.equal(sanitizeOr("<<<>>>", "?", 32), "?", "a name made only of dropped characters is missing, not blank");
});

test("sanitizeJson applies the same filter with a wider limit", () => {
  // The letters survive and the fence does not — "eviljson" is inert text,
  // "```json" is a block boundary. Removing the letters was never the point.
  assert.equal(sanitizeJson("evil```json"), "eviljson");
  assert.ok(!sanitizeJson("evil```json").includes("`"));
  assert.ok(sanitizeJson("x".repeat(100)).length <= 64);
});

test("safeUrl rebuilds the URL and drops referral tags", () => {
  assert.equal(safeUrl("https://app.hyperlend.finance/?ref=llama"), "https://app.hyperlend.finance");
  assert.equal(safeUrl("https://x.com/a/b?utm=1#frag"), "https://x.com/a/b");
});

test("safeUrl rejects any scheme that is not http or https", () => {
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>",
    "file:///etc/passwd",
    "vbscript:x",
    "not a url",
    "",
  ]) {
    assert.equal(safeUrl(bad), "", `${bad} was let through`);
  }
});

test("deepSanitize reaches strings nested in the JSON payload", () => {
  const out = deepSanitize({
    name: "evil<|im_start|>",
    nested: { list: ["a`b", { deep: "c|d" }] },
    number: 42,
    nothing: null,
  });
  // "evilim_start" is a word; "<|im_start|>" is a role boundary. The filter
  // removes the boundary, not the letters, and that is the documented promise.
  assert.equal(out.name, "evilim_start");
  assert.ok(!/[<>|]/.test(out.name));
  assert.equal(out.nested.list[0], "ab");
  assert.equal(out.nested.list[1].deep, "cd");
  assert.equal(out.number, 42, "numbers pass through untouched");
  assert.equal(out.nothing, null);
});
