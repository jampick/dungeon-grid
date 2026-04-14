import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollDice } from '../lib/logic.js';

test('1d20 returns total in [1..20] and a single roll', () => {
  for (let i = 0; i < 200; i++) {
    const r = rollDice('1d20');
    assert.equal(r.rolls.length, 1);
    assert.ok(r.total >= 1 && r.total <= 20, `total ${r.total} out of range`);
    assert.ok(r.rolls[0] >= 1 && r.rolls[0] <= 20);
  }
});

test('2d6+3 total is in [5..15], two rolls each in [1..6]', () => {
  for (let i = 0; i < 200; i++) {
    const r = rollDice('2d6+3');
    assert.equal(r.rolls.length, 2);
    for (const roll of r.rolls) {
      assert.ok(roll >= 1 && roll <= 6);
    }
    assert.ok(r.total >= 5 && r.total <= 15, `total ${r.total} out of range`);
  }
});

test('1d6-1 applies negative modifier', () => {
  for (let i = 0; i < 200; i++) {
    const r = rollDice('1d6-1');
    assert.equal(r.rolls.length, 1);
    assert.equal(r.total, r.rolls[0] - 1);
    assert.ok(r.total >= 0 && r.total <= 5);
  }
});

test('malformed input returns zeroed result', () => {
  assert.deepEqual(rollDice('hello'), { total: 0, rolls: [] });
  assert.deepEqual(rollDice(''), { total: 0, rolls: [] });
});
