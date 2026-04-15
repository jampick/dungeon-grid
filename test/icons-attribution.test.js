// Static attribution checks for the game-icons.net replacement icons.
// These tests assert against committed files only — they must never
// perform a network fetch, so they stay fast and deterministic in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ICON_MAPPING } from '../scripts/icon-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUB  = path.join(ROOT, 'public', 'creatures');

test('CREDITS.md exists at repo root', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'CREDITS.md')), 'CREDITS.md missing');
});

test('CREDITS.md mentions game-icons.net and CC BY 3.0', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'CREDITS.md'), 'utf8');
  assert.ok(txt.includes('game-icons.net'), 'CREDITS.md must mention game-icons.net');
  assert.ok(txt.includes('CC BY 3.0'),      'CREDITS.md must mention CC BY 3.0');
});

test('README links to CREDITS.md', () => {
  const txt = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.ok(txt.includes('CREDITS.md'), 'README.md must link to CREDITS.md');
});

test('every ICON_MAPPING entry has a string author and name', () => {
  for (const [id, entry] of Object.entries(ICON_MAPPING)) {
    assert.equal(typeof entry.author, 'string', `${id}.author must be string`);
    assert.equal(typeof entry.name,   'string', `${id}.name must be string`);
    assert.ok(entry.author.length > 0, `${id}.author must be non-empty`);
    assert.ok(entry.name.length   > 0, `${id}.name must be non-empty`);
  }
});

test('every ICON_MAPPING entry resolves to a committed SVG file', () => {
  for (const id of Object.keys(ICON_MAPPING)) {
    const p = path.join(PUB, `${id}.svg`);
    assert.ok(fs.existsSync(p), `missing ${p}`);
    const body = fs.readFileSync(p, 'utf8');
    assert.ok(body.includes('<svg'), `${p} is not an SVG`);
  }
});
