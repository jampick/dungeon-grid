import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldMarkUnread } from '../lib/logic.js';

test('shouldMarkUnread: collapsed + message from other → true', () => {
  assert.equal(shouldMarkUnread({ isCollapsed: true, fromName: 'Bob', selfName: 'Alice' }), true);
});

test('shouldMarkUnread: expanded + message from other → false', () => {
  assert.equal(shouldMarkUnread({ isCollapsed: false, fromName: 'Bob', selfName: 'Alice' }), false);
});

test('shouldMarkUnread: collapsed + message from self → false', () => {
  assert.equal(shouldMarkUnread({ isCollapsed: true, fromName: 'Alice', selfName: 'Alice' }), false);
});

test('shouldMarkUnread: expanded + message from self → false', () => {
  assert.equal(shouldMarkUnread({ isCollapsed: false, fromName: 'Alice', selfName: 'Alice' }), false);
});

test('shouldMarkUnread: collapsed + system message + selfName Alice → true', () => {
  assert.equal(shouldMarkUnread({ isCollapsed: true, fromName: 'system', selfName: 'Alice' }), true);
});
