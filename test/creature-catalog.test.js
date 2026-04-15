import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, getCreatures } from '../lib/creatures.js';

const REQUIRED = ['id', 'name', 'hp', 'ac', 'color', 'image'];

test('getCreatures(1e, monster) returns >= 20 entries with required fields', () => {
  const list = getCreatures('1e', 'monster');
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 20, `expected >=20, got ${list.length}`);
  for (const c of list) {
    for (const f of REQUIRED) assert.ok(f in c, `missing field ${f} on ${c.id}`);
  }
});

test('getCreatures(1e, npc) returns >= 8 entries with required fields', () => {
  const list = getCreatures('1e', 'npc');
  assert.ok(list.length >= 8);
  for (const c of list) {
    for (const f of REQUIRED) assert.ok(f in c, `missing field ${f} on ${c.id}`);
  }
});

test('getCreatures(5e, monster) uses ascending AC (some AC > 10)', () => {
  const list = getCreatures('5e', 'monster');
  assert.ok(list.length >= 5);
  assert.ok(list.some(c => c.ac > 10), 'expected at least one 5e monster with AC > 10');
});

test('getCreatures(1e, monster) uses descending AC (some AC < 10)', () => {
  const list = getCreatures('1e', 'monster');
  assert.ok(list.some(c => c.ac < 10), 'expected at least one 1e monster with AC < 10');
});

test('getCreatures(unknown, monster) falls back to 1e', () => {
  const fallback = getCreatures('not-a-ruleset', 'monster');
  const oneE = getCreatures('1e', 'monster');
  assert.deepEqual(fallback, oneE);
});

test('every catalog image path starts with /creatures/ and ends with .svg', () => {
  for (const ruleset of Object.keys(CREATURES)) {
    for (const kind of ['monsters', 'npcs']) {
      for (const c of CREATURES[ruleset][kind]) {
        assert.match(c.image, /^\/creatures\/.+\.svg$/, `${ruleset}/${kind}/${c.id} image=${c.image}`);
      }
    }
  }
});

test('ids are unique within each (ruleset, kind) pair', () => {
  for (const ruleset of Object.keys(CREATURES)) {
    for (const kind of ['monsters', 'npcs']) {
      const ids = CREATURES[ruleset][kind].map(c => c.id);
      const set = new Set(ids);
      assert.equal(set.size, ids.length, `dup id in ${ruleset}/${kind}`);
    }
  }
});
