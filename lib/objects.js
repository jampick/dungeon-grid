// Object catalog — dungeon furniture and loot for the Token dialog and
// the random-dungeon generator. Pure data (no I/O) so it can be imported
// by both the server-side tests and the browser client (served as
// /lib/objects.js).
//
// Unlike CREATURES, OBJECTS does not vary by ruleset. HP/AC are nominal
// values for DMs who want to let players smash furniture; refine later.
//
// `size` follows the same D&D size category strings used by creatures.js,
// resolved through SIZE_MULTIPLIERS at use time.

export const OBJECTS = [
  { id: 'chest',       name: 'Chest',       color: '#8a6a1a', image: '/creatures/chest.svg',       size: 'small',  hp: 10, ac: 15 },
  { id: 'bed',         name: 'Bed',         color: '#6b4e2e', image: '/creatures/bed.svg',         size: 'medium', hp: 5,  ac: 5  },
  { id: 'weapon_rack', name: 'Weapon Rack', color: '#5a3e2e', image: '/creatures/weapon_rack.svg', size: 'small',  hp: 8,  ac: 10 },
  { id: 'desk',        name: 'Desk',        color: '#7a5e3e', image: '/creatures/desk.svg',        size: 'medium', hp: 5,  ac: 5  },
  { id: 'bookshelf',   name: 'Bookshelf',   color: '#4a3820', image: '/creatures/bookshelf.svg',   size: 'medium', hp: 5,  ac: 5  },
  { id: 'table',       name: 'Table',       color: '#6b4e2e', image: '/creatures/table.svg',       size: 'medium', hp: 5,  ac: 5  },
  { id: 'chair',       name: 'Chair',       color: '#6b4e2e', image: '/creatures/chair.svg',       size: 'small',  hp: 3,  ac: 5  },
  { id: 'barrel',      name: 'Barrel',      color: '#5a3a1a', image: '/creatures/barrel.svg',      size: 'small',  hp: 6,  ac: 10 },
  { id: 'crate',       name: 'Crate',       color: '#7a5e3e', image: '/creatures/crate.svg',       size: 'small',  hp: 6,  ac: 10 },
  { id: 'altar',       name: 'Altar',       color: '#a8a088', image: '/creatures/altar.svg',       size: 'medium', hp: 15, ac: 17 },
  { id: 'statue',      name: 'Statue',      color: '#989088', image: '/creatures/statue.svg',      size: 'large',  hp: 15, ac: 17 },
  { id: 'anvil',       name: 'Anvil',       color: '#3a3a3a', image: '/creatures/anvil.svg',       size: 'small',  hp: 20, ac: 19 },
  { id: 'fountain',    name: 'Fountain',    color: '#6a8aa8', image: '/creatures/fountain.svg',    size: 'large',  hp: 15, ac: 15 },
  { id: 'throne',      name: 'Throne',      color: '#8a6a2e', image: '/creatures/throne.svg',      size: 'large',  hp: 15, ac: 15 },
  { id: 'firepit',     name: 'Fire Pit',    color: '#a84e1a', image: '/creatures/firepit.svg',     size: 'small',  hp: 5,  ac: 5  },
  // Light source objects — when dropped on the map they keep illuminating
  // the area around them (see tokenIsLightSource / recomputeFog in lib/logic.js).
  { id: 'torch_sconce', name: 'Torch (wall)',    color: '#a84e1a', image: '/creatures/torch_sconce.svg', size: 'small', hp: 3, ac: 10, light_type: 'torch' },
  { id: 'torch_floor',  name: 'Torch (dropped)', color: '#a84e1a', image: '/creatures/torch_floor.svg',  size: 'small', hp: 3, ac: 10, light_type: 'torch' },
  { id: 'lantern',      name: 'Lantern',         color: '#b8832a', image: '/creatures/lantern.svg',      size: 'small', hp: 5, ac: 12, light_type: 'lantern' },
  { id: 'candle_lit',   name: 'Candle',          color: '#e8c878', image: '/creatures/candle_lit.svg',   size: 'tiny',  hp: 1, ac: 10, light_type: 'candle' },
  { id: 'brazier',      name: 'Brazier',         color: '#a84e1a', image: '/creatures/brazier.svg',      size: 'medium',hp: 15,ac: 15, light_type: 'lantern' },
  { id: 'campfire',     name: 'Campfire',        color: '#c85e1a', image: '/creatures/campfire.svg',     size: 'medium',hp: 10,ac: 10, light_type: 'lantern' },
  { id: 'light_orb',    name: 'Light Orb',       color: '#fff8c8', image: '/creatures/light_orb.svg',    size: 'tiny',  hp: 1, ac: 20, light_type: 'continual' },
  // Outdoor scenery presets — trees, rocks, and other droppable props for
  // overland and wilderness maps. Plain tokens; no new schema.
  { id: 'tree_pine',     name: 'Pine Tree',        color: '#2e5a2e', image: '/creatures/tree_pine.svg',     size: 'large',  hp: 30, ac: 12 },
  { id: 'tree_oak',      name: 'Oak Tree',         color: '#3a5e2a', image: '/creatures/tree_oak.svg',      size: 'large',  hp: 40, ac: 12 },
  { id: 'tree_dead',     name: 'Dead Tree',        color: '#5a4838', image: '/creatures/tree_dead.svg',     size: 'large',  hp: 20, ac: 10 },
  { id: 'bush',          name: 'Bush',             color: '#4a6e3a', image: '/creatures/bush.svg',          size: 'medium', hp: 8,  ac: 8  },
  { id: 'boulder',       name: 'Boulder',          color: '#6a6a6a', image: '/creatures/boulder.svg',       size: 'large',  hp: 60, ac: 18 },
  { id: 'rock_small',    name: 'Small Rock',       color: '#7a7a7a', image: '/creatures/rock_small.svg',    size: 'small',  hp: 15, ac: 16 },
  { id: 'well',          name: 'Well',             color: '#5a5a5a', image: '/creatures/well.svg',          size: 'medium', hp: 30, ac: 15 },
  { id: 'tent',          name: 'Tent',             color: '#8a7a4a', image: '/creatures/tent.svg',          size: 'medium', hp: 5,  ac: 6  },
  { id: 'signpost',      name: 'Signpost',         color: '#6b4e2e', image: '/creatures/signpost.svg',      size: 'tiny',   hp: 3,  ac: 10 },
  { id: 'haystack',      name: 'Haystack',         color: '#c8a84a', image: '/creatures/haystack.svg',      size: 'medium', hp: 5,  ac: 5  },
  { id: 'campfire_out',  name: 'Outdoor Campfire', color: '#c85e1a', image: '/creatures/campfire_out.svg',  size: 'small',  hp: 5,  ac: 5, light_type: 'lantern' },
  { id: 'stump',         name: 'Tree Stump',       color: '#5a4838', image: '/creatures/stump.svg',         size: 'small',  hp: 10, ac: 10 },
  { id: 'mushroom',      name: 'Giant Mushroom',   color: '#9a5a4a', image: '/creatures/mushroom.svg',      size: 'small',  hp: 6,  ac: 8  },
  { id: 'grave',         name: 'Gravestone',       color: '#8a8a8a', image: '/creatures/grave.svg',         size: 'small',  hp: 15, ac: 14 },
  // Map-link / teleport presets. The "linking" behavior comes from the
  // link_map_id / link_x / link_y fields the DM sets per-instance; these
  // rows are plain visual props until linked.
  { id: 'stairs_up',    name: 'Stairs Up',    color: '#6a5a4a', image: '/creatures/stairs_up.svg',    size: 'medium', hp: 100, ac: 20 },
  { id: 'stairs_down',  name: 'Stairs Down',  color: '#4a3a2a', image: '/creatures/stairs_down.svg',  size: 'medium', hp: 100, ac: 20 },
  { id: 'trap_door',    name: 'Trap Door',    color: '#6a4e2a', image: '/creatures/trap_door.svg',    size: 'medium', hp: 30,  ac: 15 },
  { id: 'portal',       name: 'Portal',       color: '#8a5aa8', image: '/creatures/portal.svg',       size: 'large',  hp: 100, ac: 20 },
  { id: 'ladder',       name: 'Ladder',       color: '#8a6a4a', image: '/creatures/ladder.svg',       size: 'small',  hp: 15,  ac: 10 },
];

export function getObjects() { return OBJECTS; }

export function getObjectById(id) {
  return OBJECTS.find(o => o.id === id) || null;
}
