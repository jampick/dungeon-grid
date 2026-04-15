import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLightRadius } from '../lib/logic.js';

test('effectiveLightRadius: torch with no override returns preset 3', () => {
  assert.equal(effectiveLightRadius({ light_type: 'torch', light_radius: 0 }), 3);
});

test('effectiveLightRadius: candle with no override returns preset 2', () => {
  assert.equal(effectiveLightRadius({ light_type: 'candle', light_radius: 0 }), 2);
});

test('effectiveLightRadius: override wins over preset', () => {
  assert.equal(effectiveLightRadius({ light_type: 'torch', light_radius: 10 }), 10);
});

test('effectiveLightRadius: none returns 0', () => {
  assert.equal(effectiveLightRadius({ light_type: 'none', light_radius: 0 }), 0);
});

test('effectiveLightRadius: bullseye returns preset 12', () => {
  assert.equal(effectiveLightRadius({ light_type: 'bullseye', light_radius: 0 }), 12);
});

test('effectiveLightRadius: undefined light_type defaults to none -> 0', () => {
  assert.equal(effectiveLightRadius({ light_type: undefined, light_radius: 0 }), 0);
});
