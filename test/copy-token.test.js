import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findCopyOffset } from '../lib/logic.js';

test('findCopyOffset: empty board picks east', () => {
  assert.deepStrictEqual(
    findCopyOffset(5, 5, new Set(), 20, 20),
    { x: 6, y: 5 }
  );
});

test('findCopyOffset: east occupied falls through to west', () => {
  assert.deepStrictEqual(
    findCopyOffset(5, 5, new Set(['6,5']), 20, 20),
    { x: 4, y: 5 }
  );
});

test('findCopyOffset: east+west occupied falls through to south', () => {
  assert.deepStrictEqual(
    findCopyOffset(5, 5, new Set(['6,5', '4,5']), 20, 20),
    { x: 5, y: 6 }
  );
});

test('findCopyOffset: all four cardinals occupied falls back to origin', () => {
  assert.deepStrictEqual(
    findCopyOffset(5, 5, new Set(['6,5', '4,5', '5,6', '5,4']), 20, 20),
    { x: 5, y: 5 }
  );
});

test('findCopyOffset: east out of bounds, uses west', () => {
  assert.deepStrictEqual(
    findCopyOffset(19, 19, new Set(), 20, 20),
    { x: 18, y: 19 }
  );
});

test('findCopyOffset: corner at (0,0) — west/north OOB, uses east', () => {
  assert.deepStrictEqual(
    findCopyOffset(0, 0, new Set(), 20, 20),
    { x: 1, y: 0 }
  );
});
