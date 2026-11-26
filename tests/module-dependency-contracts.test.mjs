import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const contracts = JSON.parse(read("docs/module-dependency-contracts.json"));
const html = read("index.html");

function scriptSources() {
  return [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi)]
    .map(([, src]) => src.replace(/^\.\//, ""));
}

test("dependency contract registry covers every extracted JavaScript module exactly once", () => {
  const actual = readdirSync(new URL("modules/", root)).filter(name => name.endsWith(".js")).map(name => "modules/" + name).sort();
  const declared = contracts.modules.map(item => item.path).sort();
  assert.deepEqual(declared, actual, "new or removed modules require an explicit contract update");
  assert.equal(new Set(declared).size, declared.length, "module paths must be unique");
});

test("every module contract is explicit, ordered, and backed by an existing file", () => {
  const orders = contracts.modules.map(item => item.loadOrder);
  assert.equal(new Set(orders).size, orders.length, "loadOrder values must be unique");
  for (const item of contracts.modules) {
    assert.ok(Number.isInteger(item.loadOrder) && item.loadOrder > 0, item.path + " requires a positive loadOrder");
    assert.ok(Array.isArray(item.dependsOn), item.path + " requires an explicit dependsOn array");
    assert.ok(item.dependsOn.every(dep => typeof dep === "string" && dep.length), item.path + " has an invalid dependency");
    assert.doesNotThrow(() => read(item.path), "missing module file: " + item.path);
  }
});

test("classic-script load order in HTML matches the dependency contract registry", () => {
  const sources = scriptSources();
  const positions = contracts.modules.map(item => ({ ...item, index: sources.indexOf(item.path) }));
  for (const item of positions) assert.notEqual(item.index, -1, item.path + " is not loaded by index.html");
  const sorted = [...positions].sort((a, b) => a.loadOrder - b.loadOrder);
  assert.deepEqual(sorted.map(item => item.path), [...positions].sort((a, b) => a.index - b.index).map(item => item.path),
    "index.html script order drifted from the reviewed dependency contract");
  for (const item of contracts.modules) {
    assert.equal(sources.filter(source => source === item.path).length, 1, item.path + " must be loaded exactly once");
  }
});

test("extracted modules do not silently introduce unmanaged ES module edges", () => {
  for (const item of contracts.modules) {
    const source = read(item.path);
    assert.doesNotMatch(source, /^\s*import\s/m, item.path + " adds an import; update the module graph and contract deliberately");
    assert.doesNotMatch(source, /^\s*export\s/m, item.path + " adds an export; update the module graph and contract deliberately");
  }
});

test("shared runtime dependencies are declared as module contracts", () => {
  for (const item of contracts.modules) {
    const source = read(item.path);
    for (const globalName of ["state", "supabaseClient", "toast"]) {
      if (new RegExp("\\b" + globalName + "\\b").test(source)) {
        assert.ok(item.dependsOn.includes(globalName), item.path + " uses " + globalName + " without declaring it");
      }
    }
  }
});
