import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeLightGeometry, LIGHT_PRESETS } from '../lib/logic.js';

const SIZE = 32;

test('computeLightGeometry: torch returns circle, no cone', () => {
  const t = { x: 5, y: 5, facing: 0, light_type: 'torch' };
  const g = computeLightGeometry(t, LIGHT_PRESETS.torch, SIZE);
  assert.ok(g);
  assert.equal(g.cx, (5 + 0.5) * SIZE);
  assert.equal(g.cy, (5 + 0.5) * SIZE);
  assert.equal(g.radius, 3 * SIZE);
  assert.equal(g.cone, null);
});

test('computeLightGeometry: none / zero radius returns null', () => {
  assert.equal(computeLightGeometry({ x: 0, y: 0 }, LIGHT_PRESETS.none, SIZE), null);
  assert.equal(computeLightGeometry(null, LIGHT_PRESETS.torch, SIZE), null);
  assert.equal(computeLightGeometry({ x: 0, y: 0 }, LIGHT_PRESETS.torch, 0), null);
});

test('computeLightGeometry: light_radius override wins over preset', () => {
  const t = { x: 0, y: 0, light_type: 'torch', light_radius: 10 };
  const g = computeLightGeometry(t, LIGHT_PRESETS.torch, SIZE);
  assert.equal(g.radius, 10 * SIZE);
});

test('computeLightGeometry: bullseye facing east → cone around 0 rad', () => {
  const t = { x: 4, y: 4, facing: 2, light_type: 'bullseye' }; // 2 = E
  const g = computeLightGeometry(t, LIGHT_PRESETS.bullseye, SIZE);
  assert.ok(g.cone);
  const half = Math.PI / 3;
  assert.equal(g.cone.startAngle, 0 - half);
  assert.equal(g.cone.endAngle, 0 + half);
  assert.equal(g.radius, 12 * SIZE);
});

test('computeLightGeometry: bullseye facing north → cone around -PI/2', () => {
  const t = { x: 0, y: 0, facing: 0, light_type: 'bullseye' }; // 0 = N
  const g = computeLightGeometry(t, LIGHT_PRESETS.bullseye, SIZE);
  const half = Math.PI / 3;
  assert.equal(g.cone.startAngle, -Math.PI/2 - half);
  assert.equal(g.cone.endAngle, -Math.PI/2 + half);
});

test('computeLightGeometry: bullseye facing south-west has 120° sweep', () => {
  const t = { x: 0, y: 0, facing: 5, light_type: 'bullseye' }; // 5 = SW
  const g = computeLightGeometry(t, LIGHT_PRESETS.bullseye, SIZE);
  assert.ok(g.cone);
  const sweep = g.cone.endAngle - g.cone.startAngle;
  assert.ok(Math.abs(sweep - (2 * Math.PI / 3)) < 1e-9);
});
