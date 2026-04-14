import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIGHT_PRESETS } from '../lib/logic.js';

test('LIGHT_PRESETS radii match 1e spec', () => {
  assert.equal(LIGHT_PRESETS.none.radius, 0);
  assert.equal(LIGHT_PRESETS.candle.radius, 2);
  assert.equal(LIGHT_PRESETS.torch.radius, 3);
  assert.equal(LIGHT_PRESETS.lantern.radius, 6);
  assert.equal(LIGHT_PRESETS.bullseye.radius, 12);
  assert.equal(LIGHT_PRESETS.light_spell.radius, 4);
  assert.equal(LIGHT_PRESETS.continual.radius, 12);
  assert.equal(LIGHT_PRESETS.infravision.radius, 12);
});

test('only bullseye is a cone', () => {
  assert.equal(LIGHT_PRESETS.bullseye.cone, true);
  for (const key of Object.keys(LIGHT_PRESETS)) {
    if (key === 'bullseye') continue;
    assert.equal(LIGHT_PRESETS[key].cone, false, `${key} should not be a cone`);
  }
});
