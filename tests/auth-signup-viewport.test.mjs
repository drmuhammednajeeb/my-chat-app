import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css, sw] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8")
]);

test("signup form exposes a real submit control inside the auth form", () => {
  assert.match(html, /<div id="auth" class="auth-screen">[\s\S]*?<form id="authForm"[^>]*>[\s\S]*?<button id="authSubmit"[^>]*type="submit"/);
  assert.match(html, /function setAuthMode\(mode\)[\s\S]*?\$\('authSubmit'\)\.textContent=signup\?/);
});

test("auth layer is a fixed, explicitly scrollable touch scrollport", () => {
  const rule = css.match(/#auth\.auth-screen\s*\{[^}]*\}/s);
  assert.ok(rule, "auth must own the scrollport");
  assert.match(rule[0], /position:\s*fixed/);
  assert.match(rule[0], /inset:\s*0/);
  assert.match(rule[0], /overflow-y:\s*scroll/);
  assert.match(rule[0], /touch-action:\s*pan-y/);
  assert.match(rule[0], /-webkit-overflow-scrolling:\s*touch/);
});

test("signup form cannot shrink below its content height", () => {
  const rule = css.match(/#authForm\.auth-card\s*\{[^}]*\}/s);
  assert.ok(rule);
  assert.match(rule[0], /flex:\s*0\s+0\s+auto/);
  assert.match(rule[0], /margin:\s*auto/);
});

test("submit button is a normal full-width control, not a sticky overlay", () => {
  const rule = css.match(/#authSubmit\s*\{[^}]*\}/s);
  assert.ok(rule);
  assert.match(rule[0], /position:\s*relative/);
  assert.match(rule[0], /width:\s*100%/);
  assert.doesNotMatch(rule[0], /position:\s*sticky/);
});

test("service worker cache is invalidated for the corrected auth stylesheet", () => {
  assert.match(sw, /const CACHE_VERSION = "v35";/);
  assert.match(html, /app-version" content="2026\.11\.13\.2"/);
});
