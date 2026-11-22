import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tokens = readFileSync(new URL('../styles/theme-tokens.css', import.meta.url), 'utf8');
const appCss = readFileSync(new URL('../app.css', import.meta.url), 'utf8');
const overrides = readFileSync(new URL('../app-overrides.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function varsFor(selector) {
  const pattern = selector === ':root' ? /:root\s*\{([^}]*)\}/ : /html\.dark\s*\{([^}]*)\}/;
  const match = tokens.match(pattern);
  assert.ok(match, 'Missing theme scope ' + selector);
  return Object.fromEntries([...match[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, key, value]) => [key, value.trim()]));
}
function rgb(value) {
  const match = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  assert.ok(match, 'Expected a hex color, received ' + value);
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map(char => char + char).join('');
  return [0, 2, 4].map(index => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
}
function contrast(foreground, background) {
  const luminance = color => 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2];
  const a = luminance(rgb(foreground)), b = luminance(rgb(background));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test('light and dark themes define the shared semantic token contract', () => {
  const required = [
    '--bg','--panel','--panel2','--panel3','--line','--text','--muted','--bubble','--mine',
    '--surface-hover','--surface-selected','--surface-selected-text','--surface-row-active',
    '--surface-row-active-text','--bubble-outgoing-text','--button-primary-bg',
    '--button-primary-text','--menu-bg','--menu-text','--menu-hover','--overlay-scrim','--focus-ring'
  ];
  for (const scope of [':root', 'html.dark']) {
    const values = varsFor(scope);
    for (const key of required) assert.ok(values[key], scope + ' missing ' + key);
  }
});

test('WCAG AA text contrast is at least 4.5:1 in both themes', () => {
  for (const scope of [':root', 'html.dark']) {
    const values = varsFor(scope);
    const checks = [
      ['--text','--bg','body copy'],
      ['--text','--panel','panel copy'],
      ['--muted','--panel2','secondary labels'],
      ['--bubble-outgoing-text','--mine','outgoing message'],
      ['--surface-selected-text','--surface-selected','selected list item'],
      ['--button-primary-text','--button-primary-bg','primary button'],
      ['--menu-text','--menu-bg','menu copy'],
      ['--text','--surface-raised','raised surface']
    ];
    for (const [foreground, background, label] of checks) {
      const value = contrast(values[foreground], values[background]);
      assert.ok(value >= 4.5, scope + ' ' + label + ': ' + value.toFixed(2) + ':1');
    }
  }
});

test('legacy stylesheets do not redeclare the global palette', () => {
  for (const css of [appCss, overrides]) {
    assert.doesNotMatch(css, /^:root\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
    assert.doesNotMatch(css, /^html\.(?:light|dark)\s*\{[^}]*--(?:bg|panel|text|muted|accent):/m);
  }
});

test('central token stylesheet loads exactly once in the intended cascade order', () => {
  const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(match => match[0]);
  const indexOf = path => links.findIndex(link => link.includes('href="./' + path + '"'));
  assert.equal(links.filter(link => link.includes('href="./styles/theme-tokens.css"')).length, 1);
  assert.ok(indexOf('styles/theme-tokens.css') > indexOf('app.css'));
  assert.ok(indexOf('modules/voice-recorder.css') > indexOf('styles/theme-tokens.css'));
  assert.ok(indexOf('app-overrides.css') > indexOf('styles/theme-tokens.css'));
  assert.ok(!html.includes(String.fromCharCode(92) + 'n<link'));
});

test('shared bubbles, menus, lists, buttons and overlays use semantic tokens', () => {
  assert.match(overrides, /\.chat-header-menu\{[^}]*background:var\(--menu-bg\)/s);
  assert.match(overrides, /\.message-options-menu\{[^}]*background:var\(--menu-bg\)/s);
  assert.match(overrides, /\.custom-list-chip\.active\{[^}]*var\(--surface-selected\)/s);
  assert.match(overrides, /\.group-management-modal[^}]*background:var\(--overlay-scrim\)/s);
  assert.match(overrides, /\.mine \.bubble\{[^}]*var\(--bubble-outgoing-text\)/s);
  assert.match(overrides, /\.conversation\.active[^}]*var\(--surface-selected\)/s);
});

test('focus visibility and reduced-motion protections remain enabled', () => {
  assert.match(overrides, /:focus-visible/);
  assert.match(appCss, /prefers-reduced-motion:reduce/);
  assert.match(overrides, /prefers-reduced-motion:reduce/);
});
