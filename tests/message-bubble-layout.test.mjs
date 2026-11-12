import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const styles = await readFile(new URL('../app-overrides.css', import.meta.url), 'utf8');

test('message time and delivery status are rendered inside the text flow', () => {
  assert.ok(html.includes("(bubble.querySelector('.message-content')||bubble).append(meta)"));
  assert.ok(html.includes("(bubble.querySelector('.message-content')||bubble).append(status)"));
  assert.ok(styles.includes('#messages .message-content>.meta'));
  assert.ok(styles.includes('#messages .message-content>.message-status'));
  assert.ok(styles.includes('float:left'));
  assert.ok(styles.includes('color:rgba(255,255,255,.6)'));
  assert.ok(styles.includes('font-size:11px'));
});

test('message menu is hidden by default and does not sit over message text', () => {
  assert.ok(styles.includes('opacity:0;pointer-events:none'));
  assert.ok(styles.includes('background:transparent;color:var(--muted)'));
  assert.ok(styles.includes('#messages>.message:hover .message-menu-trigger'));
  assert.ok(styles.includes('#messages>.message.mine .message-menu-wrap{left:-20px;right:auto}'));
  assert.ok(styles.includes('#messages>.message:not(.mine) .message-menu-wrap{right:-20px;left:auto}'));
  assert.ok(styles.includes('@media(hover:none),(pointer:coarse)'));
});

test('message bubble uses compact WhatsApp geometry and reply quotes remain valid', () => {
  assert.ok(styles.includes('padding:6px 9px 8px 9px'));
  assert.ok(styles.includes('border-radius:8px'));
  assert.ok(html.includes('if(content)bubble.insertBefore(quote,content);else bubble.prepend(quote)'));
  assert.ok(html.includes('if(meta)content.append(meta);if(status)content.append(status);'));
  assert.ok(html.includes("content.textContent=incoming.content;"));
});
