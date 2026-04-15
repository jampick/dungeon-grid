import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../lib/logic.js';

test('stored "dark" wins over system light', () => {
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});

test('stored "light" wins over system dark', () => {
  assert.equal(resolveTheme('light', 'dark'), 'light');
});

test('null stored with system dark → dark', () => {
  assert.equal(resolveTheme(null, 'dark'), 'dark');
});

test('null stored with system light → dark (dark is the default)', () => {
  assert.equal(resolveTheme(null, 'light'), 'dark');
});

test('null stored with null system → dark', () => {
  assert.equal(resolveTheme(null, null), 'dark');
  assert.equal(resolveTheme(null, undefined), 'dark');
});

test('invalid stored string falls back to dark', () => {
  assert.equal(resolveTheme('banana', 'dark'), 'dark');
  assert.equal(resolveTheme('banana', 'light'), 'dark');
  assert.equal(resolveTheme('', 'light'), 'dark');
});
