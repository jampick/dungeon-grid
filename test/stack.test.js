import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stackOffsets } from '../lib/logic.js';

test('stackOffsets: n=1 returns single centered offset', () => {
  assert.deepStrictEqual(stackOffsets(1, 64), [{ dx: 0, dy: 0 }]);
});

test('stackOffsets: n=2 returns left + right with equal magnitude', () => {
  const offs = stackOffsets(2, 64);
  assert.strictEqual(offs.length, 2);
  const [a, b] = offs;
  // one on the left, one on the right
  assert.ok((a.dx < 0 && b.dx > 0) || (a.dx > 0 && b.dx < 0),
    'expected one offset with dx<0 and one with dx>0');
  // roughly equal magnitude
  assert.ok(Math.abs(Math.abs(a.dx) - Math.abs(b.dx)) < 1e-9);
  // dy ~ 0 for both (horizontal split)
  assert.ok(Math.abs(a.dy) < 1e-9);
  assert.ok(Math.abs(b.dy) < 1e-9);
});

test('stackOffsets: n=4 evenly spaced around a circle', () => {
  const offs = stackOffsets(4, 100);
  assert.strictEqual(offs.length, 4);
  const sumX = offs.reduce((s, o) => s + o.dx, 0);
  const sumY = offs.reduce((s, o) => s + o.dy, 0);
  assert.ok(Math.abs(sumX) < 1e-9, `sum dx should be ~0, got ${sumX}`);
  assert.ok(Math.abs(sumY) < 1e-9, `sum dy should be ~0, got ${sumY}`);
  // each magnitude ~ same (= cellSize * 0.15)
  const expected = 100 * 0.15;
  for (const o of offs) {
    const mag = Math.hypot(o.dx, o.dy);
    assert.ok(Math.abs(mag - expected) < 1e-9,
      `expected magnitude ${expected}, got ${mag}`);
  }
});

test('stackOffsets: n=0 is handled safely', () => {
  assert.deepStrictEqual(stackOffsets(0, 64), []);
});
