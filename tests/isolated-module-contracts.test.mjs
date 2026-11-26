import test from "node:test";
import assert from "node:assert/strict";
import authErrors from "../modules/auth-error-messages.js";
import runtimeConfig from "../modules/runtime-config.js";
import updater from "../modules/app-updater.js";

test("auth error module exposes a pure message mapper", () => {
  assert.equal(typeof authErrors.toUserMessage, "function");
  assert.equal(authErrors.toUserMessage({ message: "أدخل البريد الإلكتروني" }, true), "أدخل البريد الإلكتروني.");
  assert.equal(authErrors.toUserMessage({ message: "invalid email" }, true), "صيغة البريد الإلكتروني غير صحيحة. راجع البريد الذي صدرت إليه الدعوة.");
  assert.equal(authErrors.toUserMessage({ message: "invalid email" }, false), "تعذر تسجيل الدخول. تحقق من بيانات الدخول والاتصال ثم حاول مجدداً.");
  assert.equal(authErrors.toUserMessage({ message: "user already exists" }, true), "تعذر إكمال التسجيل بهذه البيانات. تحقق من بياناتك أو استخدم استعادة الحساب إذا سبق لك التسجيل.");
  assert.equal(authErrors.toUserMessage({ message: "unknown backend error" }, true), "تعذر إنشاء الحساب. راجع بيانات التسجيل والدعوة السارية ثم حاول مجدداً.");
});

test("runtime configuration accepts only public anon or publishable keys", () => {
  assert.equal(runtimeConfig.isPublicAnonKey("sb_publishable_abcdefghijklmnopqrstuvwxyz123456"), true);
  assert.equal(runtimeConfig.isPublicAnonKey("sb_secret_abcdefghijklmnopqrstuvwxyz123456"), false);
  assert.equal(runtimeConfig.isPublicAnonKey("service_role_fake"), false);
  assert.equal(runtimeConfig.isPublicAnonKey("not-a-key"), false);
});

test("runtime configuration keeps production and non-production targets separated", () => {
  const production = runtimeConfig.resolve({
    target: "pages-production",
    expectedSupabaseHost: runtimeConfig.PRODUCTION_SUPABASE_HOST,
    supabaseUrl: "https://" + runtimeConfig.PRODUCTION_SUPABASE_HOST,
    supabaseAnonKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz123456"
  });
  assert.equal(production.target, "pages-production");
  assert.equal(production.supabaseUrl, "https://" + runtimeConfig.PRODUCTION_SUPABASE_HOST);

  assert.throws(() => runtimeConfig.resolve({
    target: "preview",
    expectedSupabaseHost: runtimeConfig.PRODUCTION_SUPABASE_HOST,
    supabaseUrl: "https://" + runtimeConfig.PRODUCTION_SUPABASE_HOST,
    supabaseAnonKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz123456"
  }), /cannot use production Supabase/);

  assert.throws(() => runtimeConfig.resolve({
    target: "pages-production",
    expectedSupabaseHost: "other-project.supabase.co",
    supabaseUrl: "https://other-project.supabase.co",
    supabaseAnonKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz123456"
  }), /approved production Supabase project/);
});

test("runtime configuration rejects malformed URLs, hosts, and privileged keys", () => {
  const base = {
    target: "test",
    expectedSupabaseHost: "test-project.supabase.co",
    supabaseUrl: "https://test-project.supabase.co",
    supabaseAnonKey: "sb_publishable_abcdefghijklmnopqrstuvwxyz123456"
  };
  assert.throws(() => runtimeConfig.resolve({ ...base, supabaseUrl: "http://test-project.supabase.co" }), /approved HTTPS/);
  assert.throws(() => runtimeConfig.resolve({ ...base, supabaseUrl: "https://test-project.supabase.co.evil.test" }), /approved HTTPS/);
  assert.throws(() => runtimeConfig.resolve({ ...base, supabaseAnonKey: "sb_secret_abcdefghijklmnopqrstuvwxyz123456" }), /public Supabase/);
  assert.throws(() => runtimeConfig.resolve({ ...base, target: "unknown" }), /not allowed/);
});

test("app updater version comparison is deterministic", () => {
  assert.equal(updater.compareVersions("1.2.10", "1.2.9"), 1);
  assert.equal(updater.compareVersions("v1.2", "1.2.0"), 0);
  assert.equal(updater.compareVersions("2.0.0", "1.9.9"), 1);
  assert.equal(updater.compareVersions("1.2.0", "1.2.0"), 0);
  assert.equal(updater.compareVersions("1.2.0", "1.2.1"), -1);
});
