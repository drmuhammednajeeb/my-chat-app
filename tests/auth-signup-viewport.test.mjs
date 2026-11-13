import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, css] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8")
]);

test("signup form exposes a real submit control inside the auth form", () => {
  assert.match(html, /<form id="authForm"[^>]*>[\s\S]*?<button id="authSubmit"[^>]*type="submit"/);
  assert.match(html, /function setAuthMode\(mode\)[\s\S]*?\$\('authSubmit'\)\.textContent=signup\?/);
});

test("auth screen owns vertical scrolling when signup exceeds viewport", () => {
  const rule = css.match(/\.auth-screen\s*\{[^}]*place-items:safe center;[^}]*overflow-y:auto;[^}]*\}/s)
    || css.match(/\.auth-screen\s*\{[^}]*overflow-y:auto;[^}]*place-items:safe center;[^}]*\}/s);
  assert.ok(rule, "auth-screen must provide a scrollable viewport and safe alignment");
  assert.match(rule[0], /height:\s*100dvh/);
  assert.match(rule[0], /min-height:\s*100dvh/);
});

test("signup submit remains reachable at the bottom edge while scrolling", () => {
  const rule = css.match(/#authSubmit\s*\{[^}]*\}/s);
  assert.ok(rule, "authSubmit must have an explicit viewport-recovery rule");
  assert.match(rule[0], /position:\s*sticky/);
  assert.match(rule[0], /bottom:\s*max\(/);
});
