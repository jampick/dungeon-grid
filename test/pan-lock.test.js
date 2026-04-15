import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldStartPan } from '../lib/logic.js';

test('shouldStartPan: plain left-click does not start pan', () => {
  assert.equal(shouldStartPan({ shiftKey: false, button: 0 }), false);
});

test('shouldStartPan: shift + left-click starts pan', () => {
  assert.equal(shouldStartPan({ shiftKey: true, button: 0 }), true);
});

test('shouldStartPan: middle-click starts pan', () => {
  assert.equal(shouldStartPan({ shiftKey: false, button: 1 }), true);
});

test('shouldStartPan: right-click starts pan', () => {
  assert.equal(shouldStartPan({ shiftKey: false, button: 2 }), true);
});

test('shouldStartPan: shift + right-click starts pan', () => {
  assert.equal(shouldStartPan({ shiftKey: true, button: 2 }), true);
});

test('shouldStartPan: undefined event is a defensive no-op', () => {
  assert.equal(shouldStartPan(undefined), false);
  assert.equal(shouldStartPan(null), false);
});
