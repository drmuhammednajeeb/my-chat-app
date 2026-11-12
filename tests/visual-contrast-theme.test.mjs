import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app-overrides.css', import.meta.url), 'utf8');

test('light and dark themes expose high-contrast semantic tokens', () => {
  assert.match(css, /html\.light\s*\{[^}]*--text:#101828/s);
  assert.match(css, /html\.light\s*\{[^}]*--muted:#475467/s);
  assert.match(css, /html\.light\s*\{[^}]*--line:#cbd5e1/s);
  assert.match(css, /html\.dark\s*\{[^}]*--text:#f8fafc/s);
  assert.match(css, /html\.dark\s*\{[^}]*--muted:#bdc9d5/s);
  assert.match(css, /html\.dark\s*\{[^}]*--line:#405667/s);
});

test('message typography and keyboard focus are strengthened without removing theme modes', () => {
  assert.match(css, /#messages \.bubble\{font-size:15px;line-height:1\.62\}/);
  assert.match(css, /#messages \.meta\{font-size:11\.5px;font-weight:600\}/);
  assert.match(css, /#messages \.bubble,#messages \.message-content\{\s*font-weight:500/s);
  assert.match(css, /html\.light :focus-visible,html\.dark :focus-visible\{\s*outline:3px solid var\(--accent\)/s);
});
