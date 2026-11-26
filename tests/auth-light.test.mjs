import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const authLight = require('../modules/auth-light.js');

function fakeNode() {
  const classes = new Set();
  const attributes = new Map();
  return {
    dataset: {},
    textContent: '',
    classList: {
      toggle(name, force) {
        if (force) classes.add(name);
        else classes.delete(name);
      },
      contains(name) { return classes.has(name); }
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; }
  };
}

test('auth light starts dark and exposes an accessible idle status', () => {
  const rootNode = fakeNode();
  const statusNode = fakeNode();
  const controller = authLight.createController({ rootNode, statusNode });

  assert.equal(rootNode.dataset.state, 'idle');
  assert.equal(rootNode.classList.contains('is-lit'), false);
  assert.equal(statusNode.getAttribute('aria-live'), 'polite');
  assert.match(statusNode.textContent, /أدخل بياناتك/);
  assert.equal(controller.setState('idle'), 'idle');
});

test('auth light shows a non-success verification state while credentials are checked', () => {
  const rootNode = fakeNode();
  const statusNode = fakeNode();
  const controller = authLight.createController({ rootNode, statusNode });

  assert.equal(controller.setState('checking'), 'checking');
  assert.equal(rootNode.classList.contains('is-checking'), true);
  assert.equal(rootNode.classList.contains('is-lit'), false);
  assert.equal(statusNode.getAttribute('data-state'), 'checking');
});

test('auth light illuminates only for the explicit successful-auth state', () => {
  const rootNode = fakeNode();
  const statusNode = fakeNode();
  const controller = authLight.createController({ rootNode, statusNode });

  assert.equal(controller.setState('success'), 'success');
  assert.equal(rootNode.classList.contains('is-lit'), true);
  assert.equal(rootNode.classList.contains('is-checking'), false);
  assert.match(statusNode.textContent, /تم التحقق بنجاح/);
});

test('failed authentication always switches the lamp off and announces an error', () => {
  const rootNode = fakeNode();
  const statusNode = fakeNode();
  const controller = authLight.createController({ rootNode, statusNode });
  controller.setState('success');

  assert.equal(controller.setState('error'), 'error');
  assert.equal(rootNode.classList.contains('is-lit'), false);
  assert.equal(rootNode.classList.contains('has-error'), true);
  assert.equal(statusNode.getAttribute('aria-live'), 'assertive');
});

test('unknown states fail closed to the unlit idle state', () => {
  const rootNode = fakeNode();
  const statusNode = fakeNode();
  const controller = authLight.createController({ rootNode, statusNode });
  controller.setState('success');

  assert.equal(controller.setState('unexpected'), 'idle');
  assert.equal(rootNode.classList.contains('is-lit'), false);
});

test('the real authentication flow owns lamp state transitions and static assets are precached', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const worker = readFileSync(new URL('../service-worker.js', import.meta.url), 'utf8');
  assert.match(html, /modules\/auth-light\.js/);
  assert.match(html, /auth-light\.css/);
  assert.match(html, /BizmindAuthLight\?\.setState\('checking'\)/);
  assert.match(html, /BizmindAuthLight\?\.setState\('success'\)/);
  assert.match(html, /BizmindAuthLight\?\.setState\('error'\)/);
  assert.match(worker, /CACHE_VERSION = "v57"/);
  assert.match(worker, /\.\/modules\/auth-light\.js/);
  assert.match(worker, /\.\/modules\/auth-light\.css/);
});
