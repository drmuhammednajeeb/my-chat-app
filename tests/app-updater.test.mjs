import test from 'node:test';
import assert from 'node:assert/strict';
import updater from '../modules/app-updater.js';

test('compares numeric release components rather than lexical strings', () => {
  assert.equal(updater.compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(updater.compareVersions('2026.11.12.2', '2026.11.12.1'), 1);
  assert.equal(updater.compareVersions('2.0', '2.0.0'), 0);
  assert.equal(updater.compareVersions('1.2.0', '1.2.1'), -1);
});
