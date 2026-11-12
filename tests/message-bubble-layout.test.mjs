import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');

test('message time and delivery status are rendered inside the text flow', () => {
  assert.match(html, /message-content'\\)\\|\\|bubble\\)\\.append\\(meta\\)/);
  assert.match(html, /message-content'\\)\\|\\|bubble\\)\\.append\\(status\\)/);
  assert.match(styles, /#messages \\.message-content>\\.meta[\\s\\S]*?float:left/);
  assert.match(styles, /#messages \\.message-content>\\.message-status[\\s\\S]*?float:left/);
});

test('message menu is hidden by default and does not sit over message text', () => {
  assert.match(styles, /opacity:0;pointer-events:none/);
  assert.match(styles, /#messages>\\.message:hover \\.message-menu-trigger/);
  assert.match(styles, /#messages>\\.message\\.mine \\.message-menu-wrap\\{left:-20px;right:auto\\}/);
  assert.match(styles, /#messages>\\.message:not\\(\\.mine\\) \\.message-menu-wrap\\{right:-20px;left:auto\\}/);
  assert.match(styles, /@media\\(hover:none\\),\\(pointer:coarse\\)/);
});

test('message bubble uses compact WhatsApp geometry and reply quotes remain valid', () => {
  assert.match(styles, /padding:6px 9px 8px 9px/);
  assert.match(styles, /border-radius:8px/);
  assert.match(html, /if\\(content\\)bubble\\.insertBefore\\(quote,content\\);else bubble\\.prepend\\(quote\\)/);
});
