import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canClearChat } from '../lib/logic.js';

test('canClearChat allows DM', () => {
  assert.equal(canClearChat('dm'), true);
});

test('canClearChat denies players and unknown roles', () => {
  assert.equal(canClearChat('player'), false);
  assert.equal(canClearChat(''), false);
  assert.equal(canClearChat(undefined), false);
});
