import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeActivePlayerIds } from '../lib/logic.js';

test('empty map -> empty array', () => {
  assert.deepEqual(computeActivePlayerIds(new Map()), []);
});

test('non-Map / null input -> empty array', () => {
  assert.deepEqual(computeActivePlayerIds(null), []);
  assert.deepEqual(computeActivePlayerIds(undefined), []);
});

test('one player with one socket -> [that id]', () => {
  const m = new Map();
  m.set(7, new Set(['sock-a']));
  assert.deepEqual(computeActivePlayerIds(m), [7]);
});

test('two players, one with empty set -> only the non-empty one', () => {
  const m = new Map();
  m.set(1, new Set(['s1', 's2']));
  m.set(2, new Set());
  assert.deepEqual(computeActivePlayerIds(m), [1]);
});

test('multi-socket players counted once', () => {
  const m = new Map();
  m.set(10, new Set(['a', 'b', 'c']));
  m.set(11, new Set(['d']));
  assert.deepEqual(computeActivePlayerIds(m), [10, 11]);
});
