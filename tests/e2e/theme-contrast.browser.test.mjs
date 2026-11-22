import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [appCss, themeTokens, overrides] = await Promise.all([
  readFile(new URL('../../app.css', import.meta.url), 'utf8'),
  readFile(new URL('../../styles/theme-tokens.css', import.meta.url), 'utf8'),
  readFile(new URL('../../app-overrides.css', import.meta.url), 'utf8')
]);

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const fixture = [
  '<!doctype html><html class="__ROOT_THEME__" data-theme="__ROOT_THEME__"><head><meta charset="utf-8"></head><body>',
  '<div id="app" class="app"><aside id="sidebar" class="sidebar">',
  '<div class="brand"><div class="brandmark">BZ</div><h1>Bizmind Makers</h1></div>',
  '<div class="conversation active"><div class="conv-top"><strong>محادثة تجريبية</strong></div><span class="conversation-archive-mark">مؤرشفة</span></div>',
  '<div class="conversation-swipe-action archive-action">أرشفة</div><div class="conversation-swipe-action restore-action">استعادة</div>',
  '<div class="custom-list-chip active">قائمة محددة</div></aside>',
  '<main id="chat" class="chat" data-chat-theme="__CHAT_THEME__"><header class="chat-head">',
  '<div class="chat-header-menu" id="headerMenu"><div>خيارات المحادثة</div></div></header>',
  '<section class="messages" id="messages"><div class="day-divider">اليوم</div>',
  '<div class="message"><div class="bubble">رسالة واردة</div></div>',
  '<div class="message mine"><div class="bubble"><div class="message-content">رسالة صادرة ',
  '<span class="message-pinned-mark">مثبتة</span><span class="meta">12:30</span><span class="message-status read"><span class="ticks">✓✓</span></span>',
  '</div></div></div><div class="message-options-menu" id="messageMenu">إجراءات الرسالة</div></section>',
  '<div class="composer-wrap"><div class="composer"><button class="send" type="button">إرسال</button>',
  '<textarea class="field" aria-label="اكتب رسالة"></textarea></div></div></main></div></body></html>'
].join('');

async function themedPage(theme, width, height, chatTheme = theme) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(fixture.replaceAll('__ROOT_THEME__', theme).replace('__CHAT_THEME__', chatTheme));
  await page.addStyleTag({ content: appCss });
  await page.addStyleTag({ content: themeTokens });
  await page.addStyleTag({ content: overrides });
  // Let component color transitions settle before sampling computed contrast.
  await page.waitForTimeout(220);
  return page;
}
function parseColor(value) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  assert.ok(match, 'Expected computed rgb color, received ' + value);
  const parts = match[1].split(/[,/ ]+/).filter(Boolean).map(Number);
  const alpha = parts.length > 3 ? parts[3] : 1;
  return { channels: parts.slice(0, 3), alpha };
}
function contrast(foreground, background) {
  const fg = parseColor(foreground), bg = parseColor(background);
  const blended = fg.channels.map((channel, index) => channel * fg.alpha + bg.channels[index] * (1 - fg.alpha));
  const linear = channels => channels.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels => {
    const [r, g, b] = linear(channels);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(blended), b = luminance(bg.channels);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
async function inspect(page) {
  return page.evaluate(() => {
    const style = selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error('Missing fixture element ' + selector);
      const css = getComputedStyle(element);
      const ownBackground = css.backgroundColor;
      const background = ownBackground === 'rgba(0, 0, 0, 0)' || ownBackground === 'transparent'
        ? getComputedStyle(element.closest('.bubble') || element).backgroundColor
        : ownBackground;
      return { color: css.color, background, backgroundImage: css.backgroundImage, surfaceToken: css.getPropertyValue('--surface-row-active'), matchedSidebarActive: element.matches('#sidebar .conversation.active') };
    };
    return {
      received: style('#messages>.message:not(.mine) .bubble'),
      outgoing: style('#messages>.message.mine .bubble'),
      outgoingMeta: style('#messages>.message.mine .meta'),
      outgoingStatus: style('#messages>.message.mine .message-status.read'),
      selectedConversation: style('.conversation.active'),
      selectedList: style('.custom-list-chip.active'),
      primaryButton: style('.send'),
      headerMenu: style('.chat-header-menu'),
      messageMenu: style('.message-options-menu'),
      divider: style('.day-divider'),
      pinnedMarker: style('.message-pinned-mark'),
      archiveAction: style('.conversation-swipe-action.archive-action'),
      restoreAction: style('.conversation-swipe-action.restore-action'),
      viewport: { width: innerWidth, documentWidth: document.documentElement.scrollWidth }
    };
  });
}

test('browser: light and dark themes preserve WCAG AA contrast at desktop and mobile widths', async () => {
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await themedPage(theme, viewport.width, viewport.height);
      try {
        const result = await inspect(page);
        for (const [key, label] of [
          ['received','incoming bubble'], ['outgoing','outgoing bubble'],
          ['outgoingMeta','outgoing timestamp'], ['outgoingStatus','outgoing read status'],
          ['selectedConversation','selected conversation'], ['selectedList','selected custom list'],
          ['primaryButton','primary action'], ['headerMenu','header menu'],
          ['messageMenu','message menu'], ['divider','day divider'],
          ['pinnedMarker','pinned message marker'], ['archiveAction','archive swipe action'],
          ['restoreAction','restore swipe action']
        ]) {
          const ratio = contrast(result[key].color, result[key].background);
          assert.ok(ratio >= 4.5, theme + ' ' + viewport.width + 'px ' + label + ': ' + ratio.toFixed(2) + ':1; fg=' + result[key].color + '; bg=' + result[key].background + '; image=' + result[key].backgroundImage + '; surface=' + result[key].surfaceToken + '; matched=' + result[key].matchedSidebarActive);
        }
        assert.ok(result.viewport.documentWidth <= result.viewport.width,
          theme + ' ' + viewport.width + 'px layout overflows to ' + result.viewport.documentWidth + 'px');
      } finally { await page.close(); }
    }
  }
});

test('browser: conversation-local themes remain isolated from the global app theme', async () => {
  const cases = [
    { global: 'light', local: 'dark', expectedBg: 'rgb(11, 18, 32)', expectedMeta: 'rgb(216, 255, 242)' },
    { global: 'dark', local: 'light', expectedBg: 'rgb(243, 245, 248)', expectedMeta: 'rgb(242, 255, 251)' }
  ];
  for (const item of cases) {
    const page = await themedPage(item.global, 1024, 768, item.local);
    try {
      const result = await page.evaluate(() => {
        const chatElement = document.querySelector('#chat');
        chatElement.setAttribute('data-group-theme', 'emerald');
        const chat = getComputedStyle(chatElement);
        const groupAccent = chat.getPropertyValue('--accent').trim();
        const bubble = getComputedStyle(document.querySelector('#messages .mine .bubble'));
        const meta = getComputedStyle(document.querySelector('#messages .mine .meta'));
        return {
          background: chat.backgroundColor,
          groupAccent,
          bubbleBackground: bubble.backgroundColor,
          bubbleText: bubble.color,
          meta: meta.color
        };
      });
      assert.equal(result.background, item.expectedBg);
      assert.equal(result.groupAccent, '#0b9b78', item.local + ' group accent must override local palette');
      assert.equal(result.meta, item.expectedMeta);
      assert.ok(contrast(result.bubbleText, result.bubbleBackground) >= 4.5, item.local + ' local outgoing bubble contrast');
      assert.ok(contrast(result.meta, result.bubbleBackground) >= 4.5, item.local + ' local outgoing metadata contrast');
    } finally { await page.close(); }
  }
});

test('browser: keyboard focus remains visible and reduced motion removes transitions', async () => {
  const page = await themedPage('light', 390, 844);
  try {
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => ({
      visible: document.activeElement?.matches(':focus-visible'),
      outlineStyle: getComputedStyle(document.activeElement).outlineStyle,
      outlineWidth: getComputedStyle(document.activeElement).outlineWidth
    }));
    assert.equal(focused.visible, true);
    assert.equal(focused.outlineStyle, 'solid');
    assert.ok(parseFloat(focused.outlineWidth) >= 2, 'focus indicator must be at least 2px');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const transition = await page.locator('#messageMenu').evaluate(element => getComputedStyle(element).transitionDuration);
    assert.equal(transition, '0s');
  } finally { await page.close(); }
});
