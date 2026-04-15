import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from '../lib/logic.js';

test('stored "dark" wins over system light', () => {
  assert.equal(resolveTheme('dark', 'light'), 'dark');
});

test('stored "light" wins over system dark', () => {
  assert.equal(resolveTheme('light', 'dark'), 'light');
});

test('null stored falls back to system preference', () => {
  assert.equal(resolveTheme(null, 'dark'), 'dark');
  assert.equal(resolveTheme(null, 'light'), 'light');
});

test('invalid stored string falls back to light', () => {
  assert.equal(resolveTheme('banana', 'dark'), 'light');
  assert.equal(resolveTheme('', 'dark'), 'light');
});

test('null stored with invalid system falls back to light', () => {
  assert.equal(resolveTheme(null, undefined), 'light');
});
