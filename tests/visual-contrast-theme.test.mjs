import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../styles/theme-tokens.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const overrides = readFileSync(new URL('../app-overrides.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('light and dark themes expose high-contrast semantic tokens from one source', () => {
  assert.match(tokens, /:root\s*\{[^}]*--text:#101828/s);
  assert.match(tokens, /:root\s*\{[^}]*--muted:#475467/s);
  assert.match(tokens, /:root\s*\{[^}]*--line:#cbd5e1/s);
  assert.match(tokens, /html\.dark\s*\{[^}]*--text:#f8fafc/s);
  assert.match(tokens, /html\.dark\s*\{[^}]*--muted:#bdc9d5/s);
  assert.match(tokens, /html\.dark\s*\{[^}]*--line:#405667/s);
});

test('global palette tokens are not redefined in legacy stylesheets', () => {
  assert.doesNotMatch(appCss, /^:root\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
  assert.doesNotMatch(appCss, /^html\.(?:light|dark)\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
  assert.doesNotMatch(overrides, /^:root\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
  assert.doesNotMatch(overrides, /^html\.(?:light|dark)\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
});

test('the central token stylesheet loads after base styles and before component styles', () => {
  const base = html.indexOf('<link rel="stylesheet" href="./app.css">');
  const tokensLink = html.indexOf('<link rel="stylesheet" href="./styles/theme-tokens.css">');
  const recorder = html.indexOf('<link rel="stylesheet" href="./modules/voice-recorder.css">');
  assert.ok(base >= 0 && tokensLink > base && recorder > tokensLink);
});

test('message typography and keyboard focus remain strengthened in both theme modes', () => {
  assert.match(overrides, /#messages \.bubble\{font-size:15px;line-height:1\.62\}/);
  assert.match(overrides, /#messages \.meta\{font-size:11\.5px;font-weight:600\}/);
  assert.match(overrides, /#messages \.bubble,#messages \.message-content\{\s*font-weight:500/s);
  assert.match(overrides, /html\.light :focus-visible,html\.dark :focus-visible\{\s*outline:3px solid var\(--accent\)/s);
});
