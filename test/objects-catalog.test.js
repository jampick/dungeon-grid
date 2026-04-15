import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OBJECTS, getObjects, getObjectById } from '../lib/objects.js';

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

test('every object preset has a generated SVG file on disk', () => {
  for (const o of OBJECTS) {
    const p = path.join(PUB, path.basename(o.image));
    assert.ok(fs.existsSync(p), `missing ${p}`);
  }
});
