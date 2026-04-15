import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisiblePath } from '../lib/logic.js';

test('buildVisiblePath: empty set returns empty array', () => {
  assert.deepEqual(buildVisiblePath(new Set(), 32), []);
  assert.deepEqual(buildVisiblePath(null, 32), []);
});

test('buildVisiblePath: single cell returns one rect at pixel coords', () => {
  const rects = buildVisiblePath(new Set(['2,3']), 32);
  assert.equal(rects.length, 1);
  assert.deepEqual(rects[0], { x: 64, y: 96, w: 32, h: 32 });
});

test('buildVisiblePath: L-shape of two cells returns two rects', () => {
  const rects = buildVisiblePath(['0,0', '1,0'], 10);
  assert.equal(rects.length, 2);
  const xs = rects.map(r => r.x).sort((a, b) => a - b);
  assert.deepEqual(xs, [0, 10]);
  assert.ok(rects.every(r => r.y === 0 && r.w === 10 && r.h === 10));
});
