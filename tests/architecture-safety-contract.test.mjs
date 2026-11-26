import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../index.html");
const worker = read("../service-worker.js");
const manifest = JSON.parse(read("../manifest.json"));

function localAsset(value) {
  if (!value || /^(?:https?:|data:|#|mailto:|javascript:)/i.test(value)) return null;
  return value.replace(/^\.\//, "").split(/[?#]/)[0];
}
function workerPrecacheAssets() {
  const install = worker.match(/cache\.addAll\(\[([\s\S]*?)\]\)/);
  assert.ok(install, "service worker must define a shell precache manifest");
  return new Set([...install[1].matchAll(/new URL\(["']\.\/([^"']+)["']/g)].map(([, path]) => path));
}
function htmlLocalDependencies() {
  const styles = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi)].map(([tag]) => tag.match(/href=["']([^"']+)["']/i)?.[1]).filter(Boolean);
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map(([, attrs]) => attrs.match(/src=["']([^"']+)["']/i)?.[1]).filter(Boolean);
  return [...styles, ...scripts].map(localAsset).filter(Boolean);
}

test("local HTML dependencies exist in the repository", () => {
  for (const path of htmlLocalDependencies()) {
    assert.ok(existsSync(new URL("../" + path, import.meta.url)), "missing referenced asset: " + path);
  }
});

test("local HTML stylesheet and script assets are covered by shell precache", () => {
  const precache = workerPrecacheAssets();
  const intentional = new Set(["deployment-config.js"]); // network-only, no-store; never precached
  for (const path of htmlLocalDependencies()) {
    if (intentional.has(path)) continue;
    assert.ok(precache.has(path), "HTML dependency missing from service-worker shell precache: " + path);
  }
});

test("service-worker cache version and deployment-config network-only contract are explicit", () => {
  assert.match(worker, /const CACHE_VERSION = ["']v\d+["']/);
  assert.doesNotMatch(worker, /new URL\(["']\.\/deployment-config\.js["']\s*,\s*base\)/);
  assert.match(worker, /url\.pathname\.endsWith\(["']\/deployment-config\.js["']\)/);
  assert.match(worker, /fetch\(request,\s*\{\s*cache:\s*["']no-store["']\s*\}\)/);
});

test("manifest icon declarations remain local and represented in shell cache", () => {
  const icons = manifest.icons || [];
  assert.ok(icons.length >= 2, "manifest must declare multiple app icons");
  const precache = workerPrecacheAssets();
  for (const icon of icons) {
    const path = localAsset(icon.src);
    assert.ok(path, "manifest icon must be a local path");
    assert.ok(precache.has(path), "manifest icon missing from shell precache: " + path);
  }
});

test("static HTML IDs are unique to avoid ambiguous DOM wiring", () => {
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(([, id]) => id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  assert.deepEqual([...new Set(duplicates)], [], "duplicate static IDs: " + [...new Set(duplicates)].join(", "));
});

test("extracted module inventory is explicitly classified before expanding module boundaries", () => {
  const inventory = JSON.parse(read("../docs/architecture-safety-module-inventory.json"));
  const expected = [
    "app-updater.js","audio-player.js","auth-error-messages.js","auth-light.js","backup-restore.js",
    "message-loader.js","message-reactions.js","profile-status-and-conversation-images.js",
    "runtime-config.js","password-strength.js","signup-name-validation.js","conversation-search.js","status-workspace.js","voice-recorder.js","performance-analytics.js"
  ].sort();
  assert.deepEqual(inventory.modules.sort(), expected, "module inventory must be reviewed and updated intentionally");
  assert.ok(inventory.implicitGlobals.length > 0, "global-contract debt must be documented rather than hidden");
  for (const item of inventory.implicitGlobals) {
    assert.ok(item.module && item.globals.length && item.reason, "each global exception requires module, globals, and rationale");
  }
});
