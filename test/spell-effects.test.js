import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPELLS, getSpells } from '../lib/spells.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, '..', 'public', 'creatures');

const VALID_SHAPES = new Set(['circle', 'cone', 'line', 'square']);

function assertSpellShape(s) {
  assert.ok(typeof s.id === 'string' && s.id.length, `spell id missing`);
  assert.ok(typeof s.name === 'string' && s.name.length, `${s.id}: name`);
  assert.ok(typeof s.color === 'string' && s.color.length, `${s.id}: color`);
  assert.ok(VALID_SHAPES.has(s.shape), `${s.id}: shape ${s.shape}`);
  if (s.shape === 'circle') {
    assert.ok(Number.isFinite(s.radius), `${s.id}: circle needs radius`);
  } else if (s.shape === 'cone') {
    assert.ok(Number.isFinite(s.radius), `${s.id}: cone needs radius`);
    assert.ok(Number.isFinite(s.angle),  `${s.id}: cone needs angle`);
  } else if (s.shape === 'line') {
    assert.ok(Number.isFinite(s.length), `${s.id}: line needs length`);
    assert.ok(Number.isFinite(s.width),  `${s.id}: line needs width`);
  } else if (s.shape === 'square') {
    assert.ok(Number.isFinite(s.side),   `${s.id}: square needs side`);
  }
}

test("getSpells('1e').damage returns at least 10 entries with required fields", () => {
  const list = getSpells('1e').damage;
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 10, `expected >=10, got ${list.length}`);
  for (const s of list) assertSpellShape(s);
});

test("getSpells('5e').damage returns at least 10 entries with required fields", () => {
  const list = getSpells('5e').damage;
  assert.ok(Array.isArray(list));
  assert.ok(list.length >= 10, `expected >=10, got ${list.length}`);
  for (const s of list) assertSpellShape(s);
});

test("getSpells('unknown') falls back to 1e", () => {
  assert.strictEqual(getSpells('unknown'), getSpells('1e'));
});

test("2e aliases to 1e for v1", () => {
  assert.strictEqual(getSpells('2e'), getSpells('1e'));
});

test("each shape type appears at least once in 1e damage list", () => {
  const list = getSpells('1e').damage;
  const shapes = new Set(list.map(s => s.shape));
  for (const shape of VALID_SHAPES) {
    assert.ok(shapes.has(shape), `1e damage list missing ${shape}`);
  }
});

test("spell ids are unique within each ruleset", () => {
  for (const ruleset of ['1e', '5e']) {
    const seen = new Set();
    for (const s of getSpells(ruleset).damage) {
      assert.ok(!seen.has(s.id), `${ruleset}: duplicate id ${s.id}`);
      seen.add(s.id);
    }
  }
});

test("every spell image path resolves to a generated SVG file on disk", () => {
  const checked = new Set();
  for (const ruleset of Object.keys(SPELLS)) {
    for (const category of Object.keys(SPELLS[ruleset])) {
      for (const s of SPELLS[ruleset][category]) {
        if (checked.has(s.image)) continue;
        checked.add(s.image);
        assert.ok(typeof s.image === 'string' && s.image.startsWith('/creatures/'),
          `${s.id}: image path must start with /creatures/`);
        const p = path.join(PUB, path.basename(s.image));
        assert.ok(fs.existsSync(p), `missing spell SVG: ${p}`);
      }
    }
  }
});
