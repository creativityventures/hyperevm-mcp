// Every number a reader sees passes through this module. The rule it exists to
// enforce is narrow and absolute: "n/a" means we do not know, and a zero is
// printed only when the source actually said zero.
//
//   node --test test/
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changePct,
  fraction,
  fundingApr,
  fundingHourly,
  num,
  pct,
  price,
  qty,
  signedPct,
  signedPp,
  usd,
  usdExact,
  utcDate,
  utcTime,
} from "../dist/format/numbers.js";

test("num parses the strings Hyperliquid actually sends", () => {
  assert.equal(num("58.6645"), 58.6645);
  assert.equal(num("  12  "), 12);
  assert.equal(num("-0.0000024686"), -0.0000024686);
  assert.equal(num(0), 0);
  assert.equal(num("0"), 0);
});

test("num refuses anything it cannot turn into a finite number", () => {
  for (const bad of ["", "   ", "abc", "1.2.3", null, undefined, {}, [], true, NaN, Infinity, -Infinity]) {
    assert.equal(num(bad), null, `${JSON.stringify(bad)} should not become a number`);
  }
});

test("num does not treat an empty string as zero", () => {
  // The whole project turns on this one: "" -> 0 would print 0.00% for a field
  // the source never filled in.
  assert.equal(num(""), null);
  assert.notEqual(num(""), 0);
});

test("every formatter renders unknown as n/a, never as zero", () => {
  const formatters = [pct, signedPct, signedPp, fraction, usd, usdExact, qty, price];
  for (const f of formatters) {
    for (const missing of [null, undefined, NaN, Infinity, -Infinity]) {
      assert.equal(f(missing), "n/a", `${f.name}(${String(missing)}) must be n/a`);
    }
  }
  assert.equal(fundingHourly(null), "n/a");
  assert.equal(fundingApr(null), "n/a");
});

test("a real zero is printed as zero", () => {
  assert.equal(pct(0), "0.00%");
  assert.equal(usd(0), "$0");
  assert.equal(fraction(0), "0.0%");
  assert.equal(signedPp(0), "0.00pp");
});

test("pct keeps the source's own units", () => {
  assert.equal(pct(1.93952), "1.94%");
  assert.equal(pct(46.9312), "46.93%");
  assert.equal(pct(1.93952, 4), "1.9395%");
});

test("signed formatters mark gains but not losses", () => {
  assert.equal(signedPct(2.1), "+2.1%");
  assert.equal(signedPct(-9.5), "-9.5%");
  assert.equal(signedPct(0), "0.0%", "zero is neither a gain nor a loss");
  assert.equal(signedPp(-90.91), "-90.91pp");
  assert.equal(signedPp(1.82), "+1.82pp");
});

test("percentage points and percentages are different units", () => {
  // An APY moving from 10% to 12% is +2pp, not +2%. Rendering one as the other
  // is the class of mistake that made the audits field wrong.
  assert.ok(signedPp(2).endsWith("pp"));
  assert.ok(signedPct(2).endsWith("%"));
  assert.notEqual(signedPp(2), signedPct(2));
});

test("fraction scales from [0,1], pct does not", () => {
  assert.equal(fraction(0.882), "88.2%");
  assert.equal(fraction(1), "100.0%");
  assert.equal(pct(0.882), "0.88%");
});

test("usd compacts by magnitude and keeps the sign", () => {
  assert.equal(usd(5_562_714_498), "$5.56B");
  assert.equal(usd(827_840_467), "$827.8M");
  assert.equal(usd(12_123_296), "$12.1M");
  assert.equal(usd(1_112_440), "$1.1M");
  assert.equal(usd(64), "$64");
  assert.equal(usd(-253_078_874), "-$253.1M");
});

test("usd boundaries land on the right unit", () => {
  assert.equal(usd(999), "$999");
  assert.equal(usd(1000), "$1.0K");
  assert.equal(usd(999_999), "$1000.0K");
  assert.equal(usd(1_000_000), "$1.0M");
  assert.equal(usd(1_000_000_000), "$1.00B");
});

test("usdExact does not round someone's own balance", () => {
  assert.equal(usdExact(185_650_266.91388), "$185,650,266.91");
  assert.equal(usdExact(477.867397), "$477.87");
  assert.equal(usdExact(-12.5), "-$12.50");
});

test("qty is a count, not money", () => {
  assert.equal(qty(9_298_684.5557377, 0), "9,298,685");
  assert.equal(qty(22_597_909.5), "22,597,909.5");
  assert.ok(!qty(1234).includes("$"));
});

test("price widens its digits as the price shrinks", () => {
  assert.equal(price(64520), "$64520.00");
  assert.equal(price(58.6645), "$58.6645");
  assert.equal(price(0.0123), "$0.012300");
  assert.equal(price(0.00001234), "$0.00001234");
});

test("funding is rendered hourly and annualised from the same fraction", () => {
  assert.equal(fundingHourly(0.0000125), "0.0013%/h");
  assert.equal(fundingApr(0.0000125), "10.95%/yr");
  assert.equal(fundingHourly(-0.0000235163), "-0.0024%/h");
  // 24 * 365 hours, not 365: an hourly rate annualised as if it were daily
  // would understate the cost of a position by a factor of 24.
  assert.equal(fundingApr(0.0001), "87.60%/yr");
});

test("changePct refuses to divide by a zero baseline", () => {
  assert.equal(changePct(110, 100), 10);
  assert.equal(changePct(90, 100), -10);
  assert.equal(changePct(100, 0), null, "a change from zero is undefined, not infinite");
  assert.equal(changePct(null, 100), null);
  assert.equal(changePct(100, null), null);
});

test("timestamps are rendered in UTC, not local time", () => {
  const ms = Date.UTC(2026, 6, 26, 12, 3, 45);
  assert.equal(utcTime(ms), "12:03 UTC");
  assert.equal(utcDate(ms), "2026-07-26");
  // Midnight is the case a local-time bug would move to the previous day.
  assert.equal(utcDate(Date.UTC(2026, 6, 26, 0, 0, 0)), "2026-07-26");
  assert.equal(utcTime(Date.UTC(2026, 6, 26, 0, 5, 0)), "00:05 UTC");
});
