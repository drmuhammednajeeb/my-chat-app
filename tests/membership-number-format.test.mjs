import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../membership.js", import.meta.url), "utf8");
const match = source.match(/function normalizeForeverMembershipNumber\(value\) \{[\s\S]*?\n  \}/);
assert.ok(match, "membership.js must define the shared Forever number normalizer");
const normalize = vm.runInNewContext("(" + match[0] + ")");

test("accepts legacy 971000... IDs in grouped display format", () => {
  assert.equal(normalize("971-000-000-000"), "971000000000");
});

test("accepts the same 12-digit ID without separators", () => {
  assert.equal(normalize("971000000000"), "971000000000");
});

test("accepts any official 971 + nine digit number and preserves leading zeros", () => {
  assert.equal(normalize("971-001-002-003"), "971001002003");
  assert.equal(normalize("971000123456"), "971000123456");
});

test("trims surrounding whitespace", () => {
  assert.equal(normalize("  971-000-000-000  "), "971000000000");
});

test("rejects malformed separators, wrong lengths, and non-digits", () => {
  for (const value of [
    "971-00-0000-000",
    "971-000-000-00",
    "97100000000",
    "9710000000000",
    "972-000-000-000",
    "971-00A-000-000",
    "",
    null
  ]) {
    assert.equal(normalize(value), null, String(value));
  }
});
