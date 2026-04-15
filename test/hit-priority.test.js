import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickByKindPriority } from '../lib/logic.js';

const DM_ORDER = ['pc', 'npc', 'monster', 'object', 'effect'];

test('pickByKindPriority: empty candidates returns null', () => {
  assert.strictEqual(pickByKindPriority([], DM_ORDER), null);
  assert.strictEqual(pickByKindPriority(null, DM_ORDER), null);
  assert.strictEqual(pickByKindPriority(undefined, DM_ORDER), null);
});

test('pickByKindPriority: single candidate is returned', () => {
  const only = { id: 1, kind: 'object' };
  assert.strictEqual(pickByKindPriority([only], DM_ORDER), only);
});

test('pickByKindPriority: creature wins over object for DM priority', () => {
  const obj = { id: 1, kind: 'object' };
  const pc = { id: 2, kind: 'pc' };
  // Object first in the list (matches reverse-iteration of state.tokens
  // where the furniture was inserted last).
  const chosen = pickByKindPriority([obj, pc], DM_ORDER);
  assert.strictEqual(chosen, pc);
  assert.strictEqual(chosen.kind, 'pc');
});

test('pickByKindPriority: two objects + one effect picks first object by candidate order', () => {
  const obj1 = { id: 1, kind: 'object', tag: 'first' };
  const obj2 = { id: 2, kind: 'object', tag: 'second' };
  const eff = { id: 3, kind: 'effect' };
  const chosen = pickByKindPriority([obj1, obj2, eff], DM_ORDER);
  assert.strictEqual(chosen, obj1);
  assert.strictEqual(chosen.tag, 'first');
});

test('pickByKindPriority: only an effect available is returned as last-resort', () => {
  const eff = { id: 9, kind: 'effect' };
  assert.strictEqual(pickByKindPriority([eff], DM_ORDER), eff);
});

test('pickByKindPriority: unknown kinds fall back to first candidate', () => {
  const a = { id: 1, kind: 'mystery' };
  const b = { id: 2, kind: 'alsoUnknown' };
  const chosen = pickByKindPriority([a, b], DM_ORDER);
  assert.strictEqual(chosen, a);
});
