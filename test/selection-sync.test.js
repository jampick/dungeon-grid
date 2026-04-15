import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTokenSelected } from '../lib/logic.js';

test('isTokenSelected: matching ids return true', () => {
  assert.equal(isTokenSelected(5, 5), true);
});

test('isTokenSelected: mismatched ids return false', () => {
  assert.equal(isTokenSelected(5, 3), false);
});

test('isTokenSelected: null/null returns false (nothing selected)', () => {
  assert.equal(isTokenSelected(null, null), false);
});

test('isTokenSelected: id=0 is a valid selectable id (not falsy)', () => {
  assert.equal(isTokenSelected(0, 0), true);
});
