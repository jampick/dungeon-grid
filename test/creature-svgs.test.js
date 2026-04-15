import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CREATURES } from '../lib/creatures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, '..', 'public', 'creatures');

test('every 1e monster has a generated SVG file on disk', () => {
  for (const c of CREATURES['1e'].monsters) {
    const p = path.join(PUB, path.basename(c.image));
    assert.ok(fs.existsSync(p), `missing ${p}`);
  }
});

test('every 1e npc has a generated SVG file on disk', () => {
  for (const c of CREATURES['1e'].npcs) {
    const p = path.join(PUB, path.basename(c.image));
    assert.ok(fs.existsSync(p), `missing ${p}`);
  }
});
