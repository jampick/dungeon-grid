// Mapping from catalog ids (creatures / objects / spells) to game-icons.net
// icons. Each entry names a contributor directory and an icon filename
// (without the .svg extension) from https://github.com/game-icons/icons.
//
// All icons on game-icons.net are Creative Commons BY 3.0. See CREDITS.md
// for per-icon attribution, and scripts/fetch-game-icons.mjs for the
// download tool that materializes these into public/creatures/*.svg.
//
// Entries omitted from this mapping (e.g. because no good game-icons
// match was found) fall back to the letter-in-circle placeholders
// produced by scripts/gen-creatures.mjs and scripts/gen-spells.mjs.
export const AUTHOR_DISPLAY = {
  lorc: 'Lorc',
  delapouite: 'Delapouite',
  skoll: 'Skoll',
  'carl-olsen': 'Carl Olsen',
  'caro-asercion': 'Caro Asercion',
  sbed: 'sbed',
};

// Keys are catalog ids (NOT filenames). The download script writes each
// to public/creatures/${id}.svg, matching the existing letter-circle
// naming used by the catalog `image` fields.
//
// Spell filenames are prefixed with `spell_` (e.g. spell_fireball.svg).
// The keys here use that prefix so the mapping is 1:1 with the file on
// disk. See SPELL_ID_TO_FILE below for the catalog-id -> filename
// lookup used by the generator skip logic.
export const ICON_MAPPING = {
  // ---- Creatures: monsters ----
  goblin:       { author: 'delapouite',    name: 'goblin-head' },
  orc:          { author: 'delapouite',    name: 'orc-head' },
  gnoll:        { author: 'caro-asercion', name: 'hyena-head' },
  hobgoblin:    { author: 'lorc',          name: 'evil-minion' },
  skeleton:     { author: 'skoll',         name: 'skeleton' },
  zombie:       { author: 'delapouite',    name: 'shambling-zombie' },
  ghoul:        { author: 'lorc',          name: 'carrion' },
  wight:        { author: 'lorc',          name: 'grim-reaper' },
  giant_rat:    { author: 'delapouite',    name: 'rat' },
  giant_spider: { author: 'carl-olsen',    name: 'spider-alt' },
  wolf:         { author: 'lorc',          name: 'wolf-head' },
  dire_wolf:    { author: 'lorc',          name: 'wolf-howl' },
  ogre:         { author: 'delapouite',    name: 'ogre' },
  troll:        { author: 'skoll',         name: 'troll' },
  hill_giant:   { author: 'delapouite',    name: 'giant' },
  brown_bear:   { author: 'delapouite',    name: 'bear-head' },
  lizardman:    { author: 'lorc',          name: 'lizardman' },
  red_dragon:   { author: 'lorc',          name: 'dragon-head' },

  // ---- Creatures: NPCs ----
  commoner:      { author: 'delapouite', name: 'person' },
  merchant:      { author: 'delapouite', name: 'shop' },
  guard:         { author: 'delapouite', name: 'spartan-helmet' },
  city_watch:    { author: 'lorc',       name: 'crested-helmet' },
  priest:        { author: 'delapouite', name: 'pope-crown' },
  noble:         { author: 'lorc',       name: 'crown' },
  mage:          { author: 'delapouite', name: 'wizard-face' },
  bandit:        { author: 'delapouite', name: 'bandit' },

  // ---- Objects ----
  chest:        { author: 'delapouite', name: 'chest' },
  bed:          { author: 'delapouite', name: 'bed' },
  desk:         { author: 'delapouite', name: 'desk' },
  bookshelf:    { author: 'delapouite', name: 'bookshelf' },
  table:        { author: 'delapouite', name: 'table' },
  chair:        { author: 'delapouite', name: 'wooden-chair' },
  barrel:       { author: 'delapouite', name: 'barrel' },
  crate:        { author: 'delapouite', name: 'wooden-crate' },
  altar:        { author: 'delapouite', name: 'sword-altar' },
  statue:       { author: 'delapouite', name: 'colombian-statue' },
  anvil:        { author: 'lorc',       name: 'anvil' },
  fountain:     { author: 'lorc',       name: 'fountain' },
  throne:       { author: 'delapouite', name: 'throne-king' },
  firepit:      { author: 'lorc',       name: 'campfire' },
  torch_sconce: { author: 'delapouite', name: 'torch' },
  torch_floor:  { author: 'delapouite', name: 'primitive-torch' },
  lantern:      { author: 'lorc',       name: 'lantern-flame' },
  candle_lit:   { author: 'lorc',       name: 'candle-light' },
  campfire:     { author: 'lorc',       name: 'campfire' },
  light_orb:    { author: 'lorc',       name: 'light-bulb' },

  // ---- Spells (filename prefix `spell_` matches public/creatures/*.svg) ----
  spell_fireball:      { author: 'lorc',       name: 'fireball' },
  spell_lightning:     { author: 'lorc',       name: 'lightning-tree' },
  spell_cold:          { author: 'delapouite', name: 'ice-spell-cast' },
  spell_ice:           { author: 'lorc',       name: 'ice-cube' },
  spell_firestorm:     { author: 'lorc',       name: 'fire-wave' },
  spell_wall_fire:     { author: 'lorc',       name: 'fire-silhouette' },
  spell_cloudkill:     { author: 'sbed',       name: 'poison-cloud' },
  spell_stink:         { author: 'lorc',       name: 'mushroom-cloud' },
  spell_web:           { author: 'lorc',       name: 'spider-web' },
  spell_sleep:         { author: 'delapouite', name: 'night-sleep' },
  spell_entangle:      { author: 'lorc',       name: 'vine-whip' },
  spell_silence:       { author: 'lorc',       name: 'silence' },
  spell_darkness:      { author: 'lorc',       name: 'eclipse' },
  spell_faerie:        { author: 'delapouite', name: 'sparkles' },
  spell_burning_hands: { author: 'lorc',       name: 'burning-embers' },
  spell_thunderwave:   { author: 'skoll',      name: 'sound-waves' },
};

// Spell catalog ids (lib/spells.js) don't equal the filename stem used
// in public/creatures — multiple spell ids can share one image. The
// generators use this reverse lookup to decide whether the shared
// filename has already been replaced with a game-icons download.
export const SPELL_ID_TO_FILE = {
  fireball:       'spell_fireball',
  lightning_bolt: 'spell_lightning',
  cone_of_cold:   'spell_cold',
  ice_storm:      'spell_ice',
  fire_storm:     'spell_firestorm',
  wall_of_fire:   'spell_wall_fire',
  cloudkill:      'spell_cloudkill',
  stinking_cloud: 'spell_stink',
  web:            'spell_web',
  sleep:          'spell_sleep',
  entangle:       'spell_entangle',
  silence_15:     'spell_silence',
  silence:        'spell_silence',
  darkness_15:    'spell_darkness',
  darkness:       'spell_darkness',
  faerie_fire:    'spell_faerie',
  burning_hands:  'spell_burning_hands',
  thunderwave:    'spell_thunderwave',
};
