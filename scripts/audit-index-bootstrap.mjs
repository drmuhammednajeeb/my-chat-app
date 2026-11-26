#!/usr/bin/env node
/**
 * Phase-1 entry-point/bootstrap contract audit.
 * This is a dependency-free, text-level guard (not a full HTML/JS parser).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] || 'index.html');
const html = readFileSync(file, 'utf8');
const checks = [];
const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

add('HTML document declaration', /^<!doctype html>/i.test(html.trimStart()), 'Entry point begins with a doctype.');
add('Arabic RTL document contract', /<html[^>]*lang="ar"[^>]*dir="rtl"/i.test(html), 'Arabic language and RTL direction.');
add('Boot screen and status are present', /id="boot-screen"/.test(html) && /id="bootStatus"/.test(html), 'Boot overlay and accessible status text.');
add('Boot overlay begins hidden and is gated by auth-booting', /#boot-screen\s*\{\s*display:\s*none\s*\}/.test(html) && /html\.auth-booting\s+#boot-screen/.test(html), 'Boot screen visibility is gated by the root class.');
add('Early theme setup precedes app stylesheet', html.indexOf('bizmindmakers-chat-theme') >= 0 && html.indexOf('./app.css') > html.indexOf('bizmindmakers-chat-theme'), 'Theme preference is established before app stylesheet.');
add('Runtime config is loaded before main app script', html.indexOf('./modules/runtime-config.js') >= 0 && html.indexOf('const __bootMainScriptStarted') > html.indexOf('./modules/runtime-config.js'), 'Runtime configuration contract.');
add('Supabase client is created from validated deployment config', /BizmindRuntimeConfig\.resolve/.test(html) && /supabase\.createClient\(SUPABASE_URL,SUPABASE_ANON_KEY/.test(html), 'Main app uses validated runtime config.');
add('Auth session startup is bounded', /withAuthTimeout\s*\(\s*supabaseClient\.auth\.getSession\s*\(/.test(html), 'Initial session lookup has timeout wrapper.');
add('Membership verification is bounded', /withAuthTimeout\s*\(\s*supabaseClient\.rpc\('get_my_membership_state'/.test(html), 'Membership check has timeout wrapper.');
add('App entry is protected against duplicate concurrent calls', /appEntryPromise/.test(html) && /appEntryUserId/.test(html), 'Concurrent app entry lock is present.');
add('Auth lifecycle invalidates stale entry work', /authLifecycleVersion/.test(html) && /lifecycleVersion!==authLifecycleVersion/.test(html), 'Lifecycle version guard exists.');
add('Initial boot clears auth-booting in finally', /finally\s*\{[\s\S]*?document\.documentElement\.classList\.remove\('auth-booting'\)[\s\S]*?\}\s*\}\)\(\);/.test(html), 'Boot overlay is removed after initial auth flow.');
const idCounts = new Map();
for (const match of html.matchAll(/\sid=["']([^"']+)["']/g)) idCounts.set(match[1], (idCounts.get(match[1]) || 0) + 1);
const duplicates = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id);
add('No duplicate static IDs', duplicates.length === 0, duplicates.length ? duplicates.join(', ') : 'No duplicate IDs detected.');
const inlineHandlers = [...html.matchAll(/\son(?:click|input|change|submit|keydown|keyup|load)\s*=/gi)].length;
add('No inline HTML event attributes', inlineHandlers === 0, `${inlineHandlers} inline handler attributes found.`);
const report = {
  file,
  checks,
  summary: { total: checks.length, passed: checks.filter(x => x.pass).length, failed: checks.filter(x => !x.pass).length },
  limitations: ['Text-level checks only; not an HTML parser, JavaScript AST audit, browser smoke test, or runtime integration test.']
};
console.log(JSON.stringify(report, null, 2));
if (report.summary.failed) process.exitCode = 1;
