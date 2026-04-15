// Spell area-of-effect catalog. Pure data (no I/O) so it can be imported
// by both the server-side tests and the browser client (served via
// /lib/spells.js).
//
// Each spell entry describes a visual AOE preset: a shape (circle, cone,
// line, square), the geometric parameters in cells (5ft each), an rgba
// fill color, and an SVG image path used as the token's marker.
//
// Radii / lengths are rough D&D approximations — close to canonical
// values but not claimed as exact, and not a rules engine. 2e aliases to
// 1e for v1.

export const SPELLS = {
  '1e': {
    damage: [
      { id: 'fireball',       name: 'Fireball',       level: 3, shape: 'circle', radius: 4,  color: 'rgba(255,100,40,0.35)',  image: '/creatures/spell_fireball.svg' },
      { id: 'lightning_bolt', name: 'Lightning Bolt', level: 3, shape: 'line',   length: 12, width: 1, color: 'rgba(180,220,255,0.45)', image: '/creatures/spell_lightning.svg' },
      { id: 'cone_of_cold',   name: 'Cone of Cold',   level: 5, shape: 'cone',   radius: 12, angle: 60, color: 'rgba(180,220,255,0.35)', image: '/creatures/spell_cold.svg' },
      { id: 'ice_storm',      name: 'Ice Storm',      level: 4, shape: 'circle', radius: 4,  color: 'rgba(200,230,255,0.35)', image: '/creatures/spell_ice.svg' },
      { id: 'fire_storm',     name: 'Fire Storm',     level: 7, shape: 'square', side: 4,    color: 'rgba(255,100,40,0.35)',  image: '/creatures/spell_firestorm.svg' },
      { id: 'wall_of_fire',   name: 'Wall of Fire',   level: 4, shape: 'line',   length: 12, width: 1, color: 'rgba(255,100,40,0.4)',   image: '/creatures/spell_wall_fire.svg' },
      { id: 'cloudkill',      name: 'Cloudkill',      level: 5, shape: 'circle', radius: 6,  color: 'rgba(140,180,100,0.4)',  image: '/creatures/spell_cloudkill.svg' },
      { id: 'stinking_cloud', name: 'Stinking Cloud', level: 3, shape: 'circle', radius: 4,  color: 'rgba(180,160,80,0.35)',  image: '/creatures/spell_stink.svg' },
      { id: 'web',            name: 'Web',            level: 2, shape: 'square', side: 4,    color: 'rgba(230,230,230,0.4)',  image: '/creatures/spell_web.svg' },
      { id: 'sleep',          name: 'Sleep',          level: 1, shape: 'circle', radius: 3,  color: 'rgba(140,100,200,0.3)',  image: '/creatures/spell_sleep.svg' },
      { id: 'entangle',       name: 'Entangle',       level: 1, shape: 'circle', radius: 8,  color: 'rgba(120,180,80,0.35)',  image: '/creatures/spell_entangle.svg' },
      { id: 'silence_15',     name: 'Silence 15ft',   level: 2, shape: 'circle', radius: 3,  color: 'rgba(140,140,180,0.3)',  image: '/creatures/spell_silence.svg' },
      { id: 'darkness_15',    name: 'Darkness 15ft',  level: 2, shape: 'circle', radius: 3,  color: 'rgba(20,20,40,0.5)',     image: '/creatures/spell_darkness.svg' },
      { id: 'faerie_fire',    name: 'Faerie Fire',    level: 1, shape: 'square', side: 4,    color: 'rgba(200,180,255,0.35)', image: '/creatures/spell_faerie.svg' },
      { id: 'burning_hands',  name: 'Burning Hands',  level: 1, shape: 'cone',   radius: 3,  angle: 90, color: 'rgba(255,140,40,0.4)', image: '/creatures/spell_burning_hands.svg' },
    ],
  },
  '5e': {
    damage: [
      { id: 'fireball',       name: 'Fireball',       level: 3, shape: 'circle', radius: 4,  color: 'rgba(255,100,40,0.35)',  image: '/creatures/spell_fireball.svg' },
      { id: 'lightning_bolt', name: 'Lightning Bolt', level: 3, shape: 'line',   length: 20, width: 1, color: 'rgba(180,220,255,0.45)', image: '/creatures/spell_lightning.svg' },
      { id: 'cone_of_cold',   name: 'Cone of Cold',   level: 5, shape: 'cone',   radius: 12, angle: 60, color: 'rgba(180,220,255,0.35)', image: '/creatures/spell_cold.svg' },
      { id: 'ice_storm',      name: 'Ice Storm',      level: 4, shape: 'circle', radius: 4,  color: 'rgba(200,230,255,0.35)', image: '/creatures/spell_ice.svg' },
      { id: 'wall_of_fire',   name: 'Wall of Fire',   level: 4, shape: 'line',   length: 12, width: 1, color: 'rgba(255,100,40,0.4)',   image: '/creatures/spell_wall_fire.svg' },
      { id: 'cloudkill',      name: 'Cloudkill',      level: 5, shape: 'circle', radius: 4,  color: 'rgba(140,180,100,0.4)',  image: '/creatures/spell_cloudkill.svg' },
      { id: 'stinking_cloud', name: 'Stinking Cloud', level: 3, shape: 'circle', radius: 4,  color: 'rgba(180,160,80,0.35)',  image: '/creatures/spell_stink.svg' },
      { id: 'web',            name: 'Web',            level: 2, shape: 'square', side: 4,    color: 'rgba(230,230,230,0.4)',  image: '/creatures/spell_web.svg' },
      { id: 'sleep',          name: 'Sleep',          level: 1, shape: 'circle', radius: 4,  color: 'rgba(140,100,200,0.3)',  image: '/creatures/spell_sleep.svg' },
      { id: 'entangle',       name: 'Entangle',       level: 1, shape: 'square', side: 4,    color: 'rgba(120,180,80,0.35)',  image: '/creatures/spell_entangle.svg' },
      { id: 'silence',        name: 'Silence',        level: 2, shape: 'circle', radius: 4,  color: 'rgba(140,140,180,0.3)',  image: '/creatures/spell_silence.svg' },
      { id: 'darkness',       name: 'Darkness',       level: 2, shape: 'circle', radius: 3,  color: 'rgba(20,20,40,0.5)',     image: '/creatures/spell_darkness.svg' },
      { id: 'faerie_fire',    name: 'Faerie Fire',    level: 1, shape: 'square', side: 4,    color: 'rgba(200,180,255,0.35)', image: '/creatures/spell_faerie.svg' },
      { id: 'burning_hands',  name: 'Burning Hands',  level: 1, shape: 'cone',   radius: 3,  angle: 90, color: 'rgba(255,140,40,0.4)', image: '/creatures/spell_burning_hands.svg' },
      { id: 'thunderwave',    name: 'Thunderwave',    level: 1, shape: 'square', side: 3,    color: 'rgba(150,200,255,0.4)',  image: '/creatures/spell_thunderwave.svg' },
    ],
  },
};

// 2e aliases to 1e for v1.
SPELLS['2e'] = SPELLS['1e'];

export function getSpells(ruleset) {
  return SPELLS[ruleset] || SPELLS['1e'];
}
