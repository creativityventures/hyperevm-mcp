// The cache carries two promises that show up in the output: a failed refresh
// serves the previous answer rather than an error, and it is never served
// quietly. Both are tested here against the cache itself rather than through a
// tool, so a failure points at the cause.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ageMinutes, cached, clearCache } from "../dist/core/cache.js";

beforeEach(() => clearCache());

test("a second read inside the TTL does not call the loader again", async () => {
  let calls = 0;
  const load = async () => { calls++; return { n: calls }; };
  const first = await cached("k", load);
  const second = await cached("k", load);
  assert.equal(calls, 1);
  assert.deepEqual(second.value, first.value);
  assert.equal(second.fetchedAt, first.fetchedAt, "a cache hit reports when the data was fetched, not when it was read");
  assert.equal(second.stale, false);
});

test("an expired entry is refetched", async () => {
  let calls = 0;
  const load = async () => { calls++; return calls; };
  await cached("k", load, 1);
  await new Promise((r) => setTimeout(r, 5));
  const again = await cached("k", load, 1);
  assert.equal(calls, 2);
  assert.equal(again.value, 2);
});

test("concurrent readers of a cold key share one call", async () => {
  // /pools is 11 MB. Two tools asking at the same moment must not fetch it twice.
  let calls = 0;
  const load = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return "payload";
  };
  const all = await Promise.all([cached("k", load), cached("k", load), cached("k", load)]);
  assert.equal(calls, 1);
  for (const r of all) assert.equal(r.value, "payload");
});

test("a failed refresh serves the previous answer, marked stale", async () => {
  await cached("k", async () => "good", 1);
  await new Promise((r) => setTimeout(r, 5));
  const after = await cached("k", async () => { throw new Error("upstream down"); }, 1);
  assert.equal(after.value, "good");
  assert.equal(after.stale, true, "stale data must announce itself");
});

test("a failure with nothing cached throws rather than inventing a value", async () => {
  await assert.rejects(
    () => cached("cold", async () => { throw new Error("upstream down"); }),
    /upstream down/,
  );
});

test("the stale answer keeps the original fetch time, not the failure time", async () => {
  // The output prints how old the data is. Stamping it with the moment of the
  // failed refresh would make stale data look fresh.
  const before = await cached("k", async () => "v", 1);
  await new Promise((r) => setTimeout(r, 10));
  const after = await cached("k", async () => { throw new Error("down"); }, 1);
  assert.equal(after.fetchedAt, before.fetchedAt);
});

test("a failed refresh does not poison the next attempt", async () => {
  await cached("k", async () => "v1", 1);
  await new Promise((r) => setTimeout(r, 5));
  await cached("k", async () => { throw new Error("down"); }, 1);
  const recovered = await cached("k", async () => "v2", 1);
  assert.equal(recovered.value, "v2");
  assert.equal(recovered.stale, false);
});

test("the map has a ceiling, so wallet lookups cannot grow it forever", async () => {
  for (let i = 0; i < 200; i++) {
    await cached(`addr-${i}`, async () => i, 60_000);
  }
  // The earliest keys must have been evicted; the most recent must survive.
  const recent = await cached("addr-199", async () => "refetched", 60_000);
  assert.equal(recent.value, 199, "a recent entry should still be cached");
  let refetched = false;
  await cached("addr-0", async () => { refetched = true; return 0; }, 60_000);
  assert.ok(refetched, "the oldest entry should have been evicted");
});

test("ageMinutes rounds to whole minutes and never goes negative", () => {
  assert.equal(ageMinutes(Date.now()), 0);
  assert.equal(ageMinutes(Date.now() - 5 * 60_000), 5);
  assert.equal(ageMinutes(Date.now() + 60_000), 0, "a clock skew must not print a negative age");
});
