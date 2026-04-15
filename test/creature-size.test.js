import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CREATURES, SIZE_MULTIPLIERS, sizeMultiplier, getCreatures } from '../lib/creatures.js';

const ALL_CATEGORIES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

function eachEntry(cb) {
  for (const ruleset of Object.keys(CREATURES)) {
    for (const kind of ['monsters', 'npcs']) {
      for (const c of CREATURES[ruleset][kind]) cb(ruleset, kind, c);
    }
  }
}

test('SIZE_MULTIPLIERS contains all 6 D&D size categories', () => {
  for (const cat of ALL_CATEGORIES) {
    assert.ok(cat in SIZE_MULTIPLIERS, `missing ${cat}`);
    assert.ok(typeof SIZE_MULTIPLIERS[cat] === 'number' && SIZE_MULTIPLIERS[cat] > 0);
  }
  assert.equal(SIZE_MULTIPLIERS.medium, 1);
});

test('every 1e monster entry has size and move with valid types', () => {
  for (const c of getCreatures('1e', 'monster')) {
    assert.ok('size' in c, `missing size on 1e/${c.id}`);
    assert.ok('move' in c, `missing move on 1e/${c.id}`);
    assert.ok(ALL_CATEGORIES.includes(c.size), `bad size ${c.size} on 1e/${c.id}`);
    assert.ok(typeof c.move === 'number' && c.move > 0, `bad move on 1e/${c.id}`);
  }
});

test('every 1e npc entry has size and move with valid types', () => {
  for (const c of getCreatures('1e', 'npc')) {
    assert.ok(ALL_CATEGORIES.includes(c.size));
    assert.ok(typeof c.move === 'number' && c.move > 0);
  }
});

test('every 5e monster entry has size and move with valid types', () => {
  for (const c of getCreatures('5e', 'monster')) {
    assert.ok(ALL_CATEGORIES.includes(c.size), `bad size ${c.size} on 5e/${c.id}`);
    assert.ok(typeof c.move === 'number' && c.move > 0);
  }
});

test('every 5e npc entry has size and move with valid types', () => {
  for (const c of getCreatures('5e', 'npc')) {
    assert.ok(ALL_CATEGORIES.includes(c.size));
    assert.ok(typeof c.move === 'number' && c.move > 0);
  }
});

test('catalog uses each non-medium size at least once (gargantuan optional)', () => {
  const seen = new Set();
  eachEntry((_r, _k, c) => seen.add(c.size));
  for (const cat of ['tiny', 'small', 'large', 'huge']) {
    assert.ok(seen.has(cat), `expected at least one ${cat} creature in catalog`);
  }
});

test('resolving every catalog entry size through SIZE_MULTIPLIERS yields a finite positive number', () => {
  eachEntry((ruleset, kind, c) => {
    const m = sizeMultiplier(c.size);
    assert.ok(typeof m === 'number' && isFinite(m) && m > 0,
      `bad multiplier for ${ruleset}/${kind}/${c.id}: ${m}`);
  });
});

test('sizeMultiplier passes through valid numeric input and falls back on garbage', () => {
  assert.equal(sizeMultiplier(2), 2);
  assert.equal(sizeMultiplier('medium'), 1);
  assert.equal(sizeMultiplier('large'), 2);
  assert.equal(sizeMultiplier('not-a-size'), 1);
  assert.equal(sizeMultiplier(undefined), 1);
  assert.equal(sizeMultiplier(0), 1);
  assert.equal(sizeMultiplier(-1), 1);
});

test('known sentinel creatures get their expected sizes', () => {
  const oneE = getCreatures('1e', 'monster');
  const goblin = oneE.find(c => c.id === 'goblin');
  const troll = oneE.find(c => c.id === 'troll');
  const dragon = oneE.find(c => c.id === 'red_dragon');
  assert.equal(goblin.size, 'small');
  assert.equal(troll.size, 'large');
  assert.equal(dragon.size, 'gargantuan');
});
