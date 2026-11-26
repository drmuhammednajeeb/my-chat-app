import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const [html, css, sw, versionJson] = await Promise.all([
  readFile(new URL("../index.html", import.meta.url), "utf8"),
  readFile(new URL("../app.css", import.meta.url), "utf8"),
  readFile(new URL("../service-worker.js", import.meta.url), "utf8"),
  readFile(new URL("../version.json", import.meta.url), "utf8")
]);
const release = JSON.parse(versionJson);

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
  assert.match(sw, /const CACHE_VERSION = "v51";/);
  assert.match(html, new RegExp('app-version" content="' + release.version.split(".").join("\\.") + '"'));
});

test("signup requires a two- or three-part real name and normalizes whitespace", () => {
  assert.match(html, /function normalizeSignupDisplayName\(value\)/);
  assert.match(html, /function validateSignupDisplayName\(value\)/);
  assert.match(html, /BizmindSignupName\.validate/);
  assert.match(html, /nameResult\.valid/);
  assert.match(html, /اسمك مع لقبك على الأقل/);
  assert.match(html, /محمد النبهاني أو محمد أحمد النبهاني/);
});

test("password strength is live guidance and does not enforce complexity", () => {
  assert.match(html, /id="passwordStrengthMeter"[^>]*role="progressbar"/);
  assert.match(html, /BizmindPasswordStrength\.calculate/);
  assert.match(html, /function updatePasswordStrength\(\)/);
  assert.match(html, /\$\('password'\)\.addEventListener\('input',updatePasswordStrength\)/);
  assert.match(html, /if\(password\.length<8\)throw new Error/);
  assert.doesNotMatch(html, /if\(.*(?:uppercase|lowercase|symbol|digit).*(?:throw new Error)/i);
});

test("signup name validator accepts two or three Arabic/Latin names only", async () => {
  const nameSource = await readFile(new URL("../modules/signup-name-validation.js", import.meta.url), "utf8");
  const nameContext = {};
  runInNewContext(nameSource, nameContext);
  const api = nameContext.BizmindSignupName;
  assert.equal(api.validate("محمد النبهاني").valid, true);
  assert.equal(api.validate("محمد أحمد النبهاني").valid, true);
  assert.equal(api.validate("Mohammed bin Ali Nabhani").valid, false);
  assert.equal(api.validate("محمد").valid, false);
  assert.equal(api.normalize("محمد  النبهاني"), "محمد النبهاني");
  assert.equal(api.validate("محمد 123").valid, false);
});

test("password strength levels are advisory and the only signup threshold is eight characters", async () => {
  const strengthSource = await readFile(new URL("../modules/password-strength.js", import.meta.url), "utf8");
  const context = {};
  runInNewContext(strengthSource, context);
  const strengthApi = context.BizmindPasswordStrength;
  assert.equal(strengthApi.calculate("abcdefgh").label, "ضعيفة");
  assert.equal(strengthApi.calculate("abcdefghij").label, "متوسطة");
  assert.equal(strengthApi.calculate("Abcdefgh1").label, "قوية");
  assert.equal(strengthApi.calculate("Abcdefgh1234!").label, "قوية جداً");
  assert.match(html, /if\(password\.length<8\)throw new Error/);
});

test("Auth trigger enforces two- or three-part names before consuming invitations", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261121120000_enforce_signup_display_name_server_side.sql", import.meta.url), "utf8");
  const fixture = await readFile(new URL("./staging/local-supabase/fixtures/signup-name-guard.assert.sql", import.meta.url), "utf8");
  assert.match(migration, /security definer[\s\S]*?set search_path = ''/i);
  assert.match(migration, /cardinality\(v_name_parts\) not between 2 and 3/i);
  assert.ok(migration.includes("v_membership_number !~ '^971[0-9]{9}$'"));
  assert.ok(migration.includes("'membership_number_verified', true"));
  assert.match(migration, /btrim\(coalesce\(new\.raw_user_meta_data->>'display_name', ''\)\)/);
  assert.match(migration, /submitted_part !~ /);
  assert.ok(migration.indexOf("v_name_parts :=") < migration.indexOf("for update"), "name validation must happen before invitation locking");
  assert.match(migration, /jsonb_build_object\('display_name', v_display_name\)/);
  assert.match(fixture, /A one-part signup name was unexpectedly accepted/);
  assert.match(fixture, /A four-part signup name was unexpectedly accepted/);
  assert.match(fixture, /محمد   النبهاني/);
  assert.match(fixture, /Mohammed Ahmed Alnabhani/);
  assert.match(fixture, /rollback;/i);
});
