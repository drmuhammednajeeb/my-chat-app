import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return html.slice(start, end);
}

test('conversation switch replaces the previous transcript with an accessible loading state synchronously', () => {
  const status = sliceBetween('function renderConversationStatus', 'async function openConversation(c)');
  const open = sliceBetween('async function openConversation(c)', 'const CHAT_STICKERS=');
  assert.ok(status.includes("box.setAttribute('role','status')"));
  assert.ok(status.includes("box.setAttribute('aria-live','polite')"));
  assert.ok(status.includes('area.replaceChildren(box)'));
  const active = open.indexOf('state.active=c;');
  const clear = open.indexOf('renderConversationStatus(\'جارٍ تحميل المحادثة\'');
  const firstAsyncLoad = open.indexOf('loadHiddenMessageIds(c.id)');
  assert.ok(active >= 0 && clear > active, 'loading state must follow active conversation selection');
  assert.ok(firstAsyncLoad > clear, 'old transcript must be removed before asynchronous conversation loading starts');
});

test('composer remains disabled until the selected conversation has completed initialization', () => {
  const open = sliceBetween('async function openConversation(c)', 'const CHAT_STICKERS=');
  const disable = open.indexOf("$('messageInput').disabled=true");
  const load = open.indexOf('loadHiddenMessageIds(c.id)');
  const enable = open.lastIndexOf("$('messageInput').disabled=!canPost");
  assert.ok(disable >= 0 && disable < load, 'composer must be disabled before asynchronous loading');
  assert.ok(enable > load, 'composer can only be enabled after initialization');
});

test('a failed visibility-preference load does not leave an endless loading indicator', () => {
  const open = sliceBetween('async function openConversation(c)', 'const CHAT_STICKERS=');
  const failure = open.indexOf('if(!loaded)');
  const errorState = open.indexOf("renderConversationStatus('تعذر تحميل المحادثة'");
  assert.ok(failure >= 0 && errorState > failure);
  assert.ok(open.includes('openToken===state.conversationOpenVersion'));
  assert.ok(open.includes('state.active?.id===c.id'));
});

test('late message loads are still fenced by both request generation and active conversation identity', () => {
  const loader = readFileSync(new URL('../modules/message-loader.js', import.meta.url), 'utf8');
  assert.ok(loader.includes('state.messageLoadVersion !== requestId'));
  assert.ok(loader.includes('state.active?.id !== requestedConversationId'));
  assert.ok(loader.includes('const isCurrent = () => state.messageLoadVersion === requestId && state.active?.id === conversationId'));
});
