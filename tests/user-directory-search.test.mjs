import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function extract(name) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " must exist in index.html");
  let depth = 0, opened = false, quote = null, escaped = false;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") { depth++; opened = true; }
    else if (ch === "}" && opened && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error("Unclosed function: " + name);
}
const helpers = ["normalizeDirectoryDigits", "normalizeDirectorySearch", "directoryMembershipDigits", "formatDirectoryMembershipNumber"].map(extract).join("\\n");
const api = vm.runInNewContext("(" + helpers + "; ({normalizeDirectoryDigits,normalizeDirectorySearch,directoryMembershipDigits,formatDirectoryMembershipNumber}) )");
test("normalizes Arabic and Persian digits to ASCII", () => {
  assert.equal(api.normalizeDirectoryDigits("٩٧١-٠٠٠-٠٠٠-٠٠١"), "971-000-000-001");
  assert.equal(api.normalizeDirectoryDigits("۹۷۱۰۰۰۰۰۰۰۰۲"), "971000000002");
});
test("normalizes member search without losing Arabic names or handles", () => {
  assert.equal(api.normalizeDirectorySearch("  @محمد  "), "@محمد");
  assert.equal(api.normalizeDirectorySearch("  ٩٧١-٠٠٠-٠٠٠-٠٠١ "), "971-000-000-001");
});
test("recognizes official member-number searches and preserves partial prefixes", () => {
  assert.equal(api.directoryMembershipDigits("971-000-000-001"), "971000000001");
  assert.equal(api.directoryMembershipDigits("٩٧١٠٠٠٠٠٠٠٠١"), "971000000001");
  assert.equal(api.directoryMembershipDigits("محمد"), "");
});
test("formats verified Forever member numbers for readable cards", () => {
  assert.equal(api.formatDirectoryMembershipNumber("971000000001"), "971-000-000-001");
  assert.equal(api.formatDirectoryMembershipNumber("971001002003"), "971-001-002-003");
});
