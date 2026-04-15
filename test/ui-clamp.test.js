import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampPanelWidth } from '../lib/logic.js';

test('clampPanelWidth: within range returns value unchanged', () => {
  assert.equal(clampPanelWidth(240), 240);
  assert.equal(clampPanelWidth(180), 180);
  assert.equal(clampPanelWidth(600), 600);
});

test('clampPanelWidth: out of range clamps to min/max', () => {
  assert.equal(clampPanelWidth(50), 180);
  assert.equal(clampPanelWidth(9999), 600);
  assert.equal(clampPanelWidth(-10), 180);
});

test('clampPanelWidth: non-finite falls back to min; custom bounds honored', () => {
  assert.equal(clampPanelWidth(NaN), 180);
  assert.equal(clampPanelWidth('abc'), 180);
  assert.equal(clampPanelWidth(100, 50, 200), 100);
  assert.equal(clampPanelWidth(300, 50, 200), 200);
});
