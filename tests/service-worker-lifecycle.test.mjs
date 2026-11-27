import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const updater = readFileSync(new URL("../modules/app-updater.js", import.meta.url), "utf8");

test("cache namespace is versioned and both runtime caches share the release version", () => {
  assert.match(worker, /const CACHE_PREFIX = ["']ultra-chat-pro["']/);
  assert.match(worker, /const CACHE_VERSION = ["\']v54["\']/);
  assert.match(worker, /const SHELL_CACHE = `\$\{CACHE_PREFIX\}-shell-\$\{CACHE_VERSION\}`/);
  assert.match(worker, /const CDN_CACHE = `\$\{CACHE_PREFIX\}-cdn-\$\{CACHE_VERSION\}`/);
});

test("install precaches an explicit offline navigation document as well as the scope root", () => {
  assert.ok(worker.includes('new URL("./", base)'));
  assert.ok(worker.includes('new URL("./index.html", base)'));
  assert.match(worker, /await cache\.addAll\(\[/);
});

test("activation removes only obsolete caches owned by this application", () => {
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX \+ ["']-["']\)/);
  assert.match(worker, /!keep\.has\(key\)/);
  assert.match(worker, /await Promise\.all\([\s\S]*caches\.delete\(key\)/);
  assert.match(worker, /await self\.clients\.claim\(\)/);
  assert.doesNotMatch(worker, /filter\(key => !keep\.has\(key\)\)/);
});

test("worker activation is explicit and does not force skipWaiting during install", () => {
  assert.match(worker, /event\.data && event\.data\.type === ["']SKIP_WAITING["']/);
  assert.match(worker, /self\.skipWaiting\(\)/);
  assert.doesNotMatch(worker, /addEventListener\(["']install["'][\s\S]{0,300}skipWaiting\(/);
});

test("only GET requests enter fetch handling and only approved CDN origins are cacheable", () => {
  assert.match(worker, /if \(request\.method !== ["']GET["']\) return/);
  assert.match(worker, /if \(CDN_ORIGINS\.has\(url\.origin\)\)/);
  assert.match(worker, /if \(url\.origin !== self\.location\.origin\) return/);
  assert.match(worker, /if \(!url\.pathname\.startsWith\(scopeUrl\.pathname\)\) return/);
});

test("authenticated and API traffic is not handled by a generic runtime cache", () => {
  assert.match(worker, /const isShellAsset = [\s\S]*manifest\.json[\s\S]*runtime-config\.js/);
  assert.match(worker, /if \(!isShellAsset\) return/);
  assert.doesNotMatch(worker, /url\.pathname\.includes\(["']\/rest\/v1/);
  assert.doesNotMatch(worker, /url\.pathname\.includes\(["']\/auth\/v1/);
});

test("runtime deployment configuration always bypasses caches and emits no-store headers", () => {
  assert.match(worker, /url\.pathname\.endsWith\(["']\/deployment-config\.js["']\)/);
  assert.match(worker, /fetch\(request, \{ cache: ["']no-store["'] \}\)/);
  assert.match(worker, /Cache-Control["'], ["']no-store, max-age=0, must-revalidate["']/);
  assert.match(worker, /Pragma["'], ["']no-cache["']/);
  assert.doesNotMatch(worker, /new URL\(["']\.\/deployment-config\.js["']/);
});

test("offline navigation falls back to the cached document before the scope root", () => {
  assert.match(worker, /if \(request\.mode === ["']navigate["']\)/);
  assert.ok(worker.includes('cache.match(new URL("./index.html", scopeUrl).href)'));
  assert.ok(worker.includes('cache.match(new URL("./", scopeUrl).href)'));
  assert.match(worker, /status: 503/);
});

test("CDN cache stores only successful or opaque responses and tolerates offline refresh failure", () => {
  assert.match(worker, /response\.ok \|\| response\.type === ["']opaque["']/);
  assert.match(worker, /network\.catch\(\(\) => \{\}\)/);
  assert.match(worker, /statusText: ["']Offline static asset unavailable["']/);
});

test("PWA updater registers the scoped service worker without stale HTTP cache", () => {
  assert.ok(updater.includes("win.navigator?.serviceWorker &&") && updater.includes("win.navigator.serviceWorker.register"));
  assert.ok(updater.includes('new URL("./service-worker.js", doc.baseURI)'));
  assert.ok(updater.includes('updateViaCache: "none"'));
});

test("PWA manifest remains linked from the application document", () => {
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.json">/);
});

test("v54 shell cache includes the extracted message timeline module",()=>{
 assert.ok(worker.includes('new URL("./modules/message-timeline.js", base).href'));
});
