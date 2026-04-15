// Generates a small SVG default image for every spell preset in
// lib/spells.js. Each SVG is a translucent colored circle with the
// spell's initial centered — matches the letter-in-circle aesthetic of
// the creature/object generators. Run once after editing the catalog:
//
//   node scripts/gen-spells.mjs
//
// The output files (public/creatures/spell_*.svg) are committed
// alongside this script so the server can serve them statically.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPELLS } from '../lib/spells.js';
import { ICON_MAPPING, SPELL_ID_TO_FILE } from './icon-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'creatures');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Collapse rgba() to a hex-ish opaque color for the SVG fill so the icon
// reads at thumbnail size; the in-canvas overlay still uses the rgba.
function opaqueFill(rgba) {
  const m = /rgba?\(([^)]+)\)/.exec(rgba || '');
  if (!m) return '#888';
  const [r, g, b] = m[1].split(',').map(s => parseInt(s.trim(), 10));
  const hex = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function svg(letter, color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="${color}" stroke="#2a2a2a" stroke-width="3"/>
  <text x="32" y="42" text-anchor="middle" font-family="Georgia, serif" font-size="30" font-weight="bold" fill="#f4ecd8">${letter}</text>
</svg>
`;
}

// De-dupe by image path — 1e/2e/5e share filenames for shared spell
// ids. Entries whose filename stem (e.g. `spell_fireball`) appears in
// ICON_MAPPING are skipped: they've been replaced with a
// game-icons.net download by scripts/fetch-game-icons.mjs.
const seen = new Set();
let written = 0;
let skipped = 0;
for (const ruleset of Object.keys(SPELLS)) {
  for (const category of Object.keys(SPELLS[ruleset])) {
    for (const s of SPELLS[ruleset][category]) {
      if (seen.has(s.image)) continue;
      seen.add(s.image);
      const fileStem = SPELL_ID_TO_FILE[s.id];
      if (fileStem && ICON_MAPPING[fileStem]) { skipped++; continue; }
      const base = path.basename(s.image);
      const letter = (s.name[0] || '?').toUpperCase();
      fs.writeFileSync(path.join(OUT_DIR, base), svg(letter, opaqueFill(s.color)));
      written++;
    }
  }
}
console.log(`Wrote ${written} spell SVG files to ${OUT_DIR} (skipped ${skipped} with game-icons mapping)`);
