// Generates a small SVG default image for every creature preset in
// lib/creatures.js. Each SVG is a colored circle with the creature's
// initial centered — matches the hand-drawn aesthetic of the rest of
// the app. Run once after editing the catalog:
//
//   node scripts/gen-creatures.mjs
//
// The output files (public/creatures/*.svg) are committed alongside
// this script so the server can serve them statically.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CREATURES } from '../lib/creatures.js';
import { OBJECTS } from '../lib/objects.js';
import { ICON_MAPPING } from './icon-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'creatures');
fs.mkdirSync(OUT_DIR, { recursive: true });

function svg(letter, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="${color}" stroke="#2a2a2a" stroke-width="3"/>
  <text x="32" y="42" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#f4ecd8">${letter}</text>
</svg>
`;
}

// De-dupe by image path — 1e and 5e (and 2e, aliased to 1e) share image
// paths for the same archetype, so we only need to write each file once.
// Entries whose id appears in ICON_MAPPING are skipped entirely: they've
// been replaced with semantically-matched game-icons.net downloads by
// scripts/fetch-game-icons.mjs, and we must not clobber them with a
// letter-circle.
const seen = new Set();
let written = 0;
let skipped = 0;
for (const ruleset of Object.keys(CREATURES)) {
  for (const kind of ['monsters', 'npcs']) {
    for (const c of CREATURES[ruleset][kind]) {
      if (seen.has(c.image)) continue;
      seen.add(c.image);
      if (ICON_MAPPING[c.id]) { skipped++; continue; }
      const base = path.basename(c.image);
      const letter = (c.name[0] || '?').toUpperCase();
      fs.writeFileSync(path.join(OUT_DIR, base), svg(letter, c.color));
      written++;
    }
  }
}
// Object presets share the letter-in-circle aesthetic. Since OBJECTS are
// not ruleset-keyed, a single pass over the catalog suffices.
for (const o of OBJECTS) {
  if (seen.has(o.image)) continue;
  seen.add(o.image);
  if (ICON_MAPPING[o.id]) { skipped++; continue; }
  const base = path.basename(o.image);
  const letter = (o.name[0] || '?').toUpperCase();
  fs.writeFileSync(path.join(OUT_DIR, base), svg(letter, o.color));
  written++;
}
console.log(`Wrote ${written} SVG files to ${OUT_DIR} (skipped ${skipped} with game-icons mapping)`);
