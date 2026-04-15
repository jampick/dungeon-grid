import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OBJECTS, getObjects, getObjectById } from '../lib/objects.js';
import { LIGHT_PRESETS } from '../lib/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, '..', 'public', 'creatures');

test('OBJECTS catalog has at least 15 entries with the expected shape', () => {
  assert.ok(Array.isArray(OBJECTS));
  assert.ok(OBJECTS.length >= 15, `OBJECTS.length=${OBJECTS.length}`);
  const seenIds = new Set();
  for (const o of OBJECTS) {
    assert.ok(typeof o.id === 'string' && o.id.length, 'id string');
    assert.ok(!seenIds.has(o.id), `duplicate id ${o.id}`);
    seenIds.add(o.id);
    assert.ok(typeof o.name === 'string' && o.name.length, `${o.id}: name`);
    assert.ok(typeof o.color === 'string' && o.color.startsWith('#'), `${o.id}: color`);
    assert.ok(typeof o.image === 'string' && o.image.startsWith('/creatures/'), `${o.id}: image`);
    assert.ok(o.size, `${o.id}: size`);
    assert.ok(Number.isFinite(o.hp), `${o.id}: hp numeric`);
    assert.ok(Number.isFinite(o.ac), `${o.id}: ac numeric`);
  }
});

test('getObjects returns the catalog and getObjectById finds entries', () => {
  assert.strictEqual(getObjects(), OBJECTS);
  assert.ok(getObjectById('chest'));
  assert.strictEqual(getObjectById('chest').name, 'Chest');
  assert.strictEqual(getObjectById('nope'), null);
});

test('OBJECTS catalog includes light source presets with valid light_type', () => {
  const lit = OBJECTS.filter(o => o.light_type);
  assert.ok(lit.length >= 7, `expected >=7 light source objects, got ${lit.length}`);
  const validKeys = new Set(Object.keys(LIGHT_PRESETS));
  for (const o of lit) {
    assert.ok(validKeys.has(o.light_type), `${o.id}: light_type "${o.light_type}" not in LIGHT_PRESETS`);
    assert.notEqual(o.light_type, 'none', `${o.id}: light source must not be "none"`);
  }
});

test('OBJECTS catalog includes outdoor scenery presets', () => {
  const outdoorIds = [
    'tree_pine', 'tree_oak', 'tree_dead', 'bush', 'boulder', 'rock_small',
    'well', 'tent', 'signpost', 'haystack', 'campfire_out', 'stump',
    'mushroom', 'grave',
  ];
  const validSizes = new Set(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);
  for (const id of outdoorIds) {
    const o = getObjectById(id);
    assert.ok(o, `missing outdoor preset ${id}`);
    assert.ok(typeof o.name === 'string' && o.name.length, `${id}: name`);
    assert.ok(typeof o.color === 'string' && o.color.startsWith('#'), `${id}: color`);
    assert.ok(typeof o.image === 'string' && o.image.startsWith('/creatures/'), `${id}: image`);
    assert.ok(validSizes.has(o.size), `${id}: size "${o.size}"`);
    assert.ok(Number.isFinite(o.hp), `${id}: hp`);
    assert.ok(Number.isFinite(o.ac), `${id}: ac`);
  }
  const fire = getObjectById('campfire_out');
  assert.ok(fire.light_type, 'campfire_out light_type');
  assert.ok(Object.keys(LIGHT_PRESETS).includes(fire.light_type),
    `campfire_out light_type "${fire.light_type}" not in LIGHT_PRESETS`);
});

test('every object preset has a generated SVG file on disk', () => {
  for (const o of OBJECTS) {
    const p = path.join(PUB, path.basename(o.image));
    assert.ok(fs.existsSync(p), `missing ${p}`);
  }
});
