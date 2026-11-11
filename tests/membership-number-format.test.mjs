import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../membership.js", import.meta.url), "utf8");

function extractFunction(name) {
  const match = source.match(new RegExp("function " + name + "\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}"));
  assert.ok(match, "membership.js must define " + name);
  return match[0];
}

const normalize = vm.runInNewContext("(" + extractFunction("normalizeForeverMembershipNumber") + ")");
const format = vm.runInNewContext("(" + extractFunction("formatForeverMembershipNumber") + ")");

test("accepts grouped and ungrouped official Forever membership numbers", () => {
  assert.equal(normalize("971-000-000-000"), "971000000000");
  assert.equal(normalize("971000000000"), "971000000000");
  assert.equal(normalize("971-001-002-003"), "971001002003");
});

test("preserves leading zeros and trims surrounding whitespace", () => {
  assert.equal(normalize(" 971-001-002-003 "), "971001002003");
  assert.equal(normalize("971000123456"), "971000123456");
});

test("formats normalized numbers without losing digits", () => {
  assert.equal(format("971001002003"), "971-001-002-003");
  assert.equal(format("971-000-000-000"), "971-000-000-000");
});

test("rejects malformed separators, lengths, prefixes and non-digits", () => {
  for (const value of [
    "971-00-0000-000", "971-000-000-00", "97100000000",
    "9710000000000", "972-000-000-000", "971-00A-000-000", "", null
  ]) assert.equal(normalize(value), null, String(value));
});

test("pending invitation renderer formats the number and appends its expiry date", () => {
  const renderer = extractFunction("renderPendingInvites");
  assert.match(renderer, /formatForeverMembershipNumber\\(item\\.membership_number\\)/);
  assert.match(renderer, /" · تنتهي " \\+ dateLabel\\(item\\.expires_at\\)/);
});
