import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { toUserMessage } = require('../modules/auth-error-messages.js');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');

test('signup error mapping never exposes server messages', () => {
  const secret = 'duplicate key value violates constraint private_table_secret';
  const message = toUserMessage({ message: secret }, true);
  assert.notEqual(message, secret);
  assert.doesNotMatch(message, /private_table_secret|duplicate key/i);
});

test('existing email errors use an anti-enumeration response', () => {
  const message = toUserMessage({ message: 'User already registered' }, true);
  assert.match(message, /تعذر إكمال التسجيل/);
  assert.doesNotMatch(message, /يوجد حساب مسجل|البريد الإلكتروني بالفعل/);
});

test('signup errors map invitation, password, username and email cases', () => {
  assert.match(toUserMessage({ message: 'Database error saving new user' }, true), /الدعوة لم تُستخدم/);
  assert.match(toUserMessage({ message: 'Password should be at least 8 characters' }, true), /8 أحرف/);
  assert.match(toUserMessage({ message: 'duplicate key profiles_username' }, true), /اسم المستخدم مستخدم/);
  assert.match(toUserMessage({ message: 'Invalid email' }, true), /صيغة البريد الإلكتروني/);
});

test('login errors remain generic and do not disclose server details', () => {
  const message = toUserMessage({ message: 'secret auth backend detail' }, false);
  assert.match(message, /تعذر تسجيل الدخول/);
  assert.doesNotMatch(message, /secret auth backend detail/);
});

test('auth request mode is captured and mode controls are locked while pending', () => {
  const start = index.indexOf("$('authForm').addEventListener('submit'");
  const end = index.indexOf("$('logoutBtn').onclick", start);
  const handler = index.slice(start, end);
  assert.match(handler, /const attemptMode=state\.authMode/);
  assert.match(handler, /if\(attemptMode==='signup'\)/);
  assert.match(handler, /\$\('loginTab'\)\.disabled=true/);
  assert.match(handler, /\$\('signupTab'\)\.disabled=true/);
  assert.match(handler, /btn\.textContent=state\.authMode==='signup'/);
});

test('the service worker precaches the auth error helper and advances its cache version', () => {
  assert.match(worker, /auth-error-messages\.js/);
  assert.match(worker, /CACHE_VERSION = "v43"/);
});

test('safe local validation messages remain actionable for both auth modes', () => {
  assert.equal(toUserMessage({ message: 'أدخل البريد الإلكتروني.' }, false), 'أدخل البريد الإلكتروني.');
  assert.equal(toUserMessage({ message: 'صيغة البريد الإلكتروني غير صحيحة.' }, true), 'صيغة البريد الإلكتروني غير صحيحة.');
  assert.equal(toUserMessage({ message: 'كلمة المرور يجب ألا تقل عن 8 أحرف.' }, true), 'كلمة المرور يجب ألا تقل عن 8 أحرف.');
  assert.equal(toUserMessage({ message: 'رمز الدعوة غير صحيح. استخدم الرمز الذي أنشأه مسؤول التطبيق.' }, true), 'رمز الدعوة غير صحيح. استخدم الرمز الذي أنشأه مسؤول التطبيق.');
});
