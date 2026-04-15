// Creature presets for the Token dialog.
//
// Pure-data module (no I/O) so it can be imported by both the server-side
// tests and the browser client (served via /lib/creatures.js).
//
// All names are generic fantasy archetypes — no copyrighted material.
// Stats are ballpark values for quick token creation, not a rules engine.
//
// AC convention:
//   1e / 2e: descending  (10 = unarmored, lower = better armored)
//   5e:      ascending   (10 = unarmored, higher = better armored)

const monsters1e = [
  { id: 'goblin',       name: 'Goblin',         hp: 4,   ac: 6,  color: '#6b8e4e', image: '/creatures/goblin.svg' },
  { id: 'orc',          name: 'Orc',            hp: 6,   ac: 6,  color: '#7a4e2e', image: '/creatures/orc.svg' },
  { id: 'kobold',       name: 'Kobold',         hp: 3,   ac: 7,  color: '#8b3a2e', image: '/creatures/kobold.svg' },
  { id: 'gnoll',        name: 'Gnoll',          hp: 11,  ac: 5,  color: '#a07a3e', image: '/creatures/gnoll.svg' },
  { id: 'hobgoblin',    name: 'Hobgoblin',      hp: 8,   ac: 5,  color: '#5e6b3a', image: '/creatures/hobgoblin.svg' },
  { id: 'bugbear',      name: 'Bugbear',        hp: 16,  ac: 5,  color: '#6b4a2e', image: '/creatures/bugbear.svg' },
  { id: 'skeleton',     name: 'Skeleton',       hp: 4,   ac: 7,  color: '#e8e0c8', image: '/creatures/skeleton.svg' },
  { id: 'zombie',       name: 'Zombie',         hp: 8,   ac: 8,  color: '#7a8a5a', image: '/creatures/zombie.svg' },
  { id: 'ghoul',        name: 'Ghoul',          hp: 9,   ac: 6,  color: '#5a5a3a', image: '/creatures/ghoul.svg' },
  { id: 'wight',        name: 'Wight',          hp: 22,  ac: 5,  color: '#3a3a4e', image: '/creatures/wight.svg' },
  { id: 'giant_rat',    name: 'Giant Rat',      hp: 3,   ac: 7,  color: '#5e4a3a', image: '/creatures/giant_rat.svg' },
  { id: 'giant_spider', name: 'Giant Spider',   hp: 18,  ac: 4,  color: '#2e2e3a', image: '/creatures/giant_spider.svg' },
  { id: 'wolf',         name: 'Wolf',           hp: 11,  ac: 7,  color: '#6e6e6e', image: '/creatures/wolf.svg' },
  { id: 'dire_wolf',    name: 'Dire Wolf',      hp: 22,  ac: 6,  color: '#4e4e4e', image: '/creatures/dire_wolf.svg' },
  { id: 'ogre',         name: 'Ogre',           hp: 26,  ac: 5,  color: '#8a6e4e', image: '/creatures/ogre.svg' },
  { id: 'troll',        name: 'Troll',          hp: 36,  ac: 4,  color: '#4e6b3a', image: '/creatures/troll.svg' },
  { id: 'hill_giant',   name: 'Hill Giant',     hp: 40,  ac: 4,  color: '#7a5e3a', image: '/creatures/hill_giant.svg' },
  { id: 'brown_bear',   name: 'Brown Bear',     hp: 28,  ac: 6,  color: '#5e3a1e', image: '/creatures/brown_bear.svg' },
  { id: 'lizardman',    name: 'Lizardman',      hp: 11,  ac: 5,  color: '#3e6b4a', image: '/creatures/lizardman.svg' },
  { id: 'red_dragon',   name: 'Red Dragon',     hp: 88,  ac: -1, color: '#a03020', image: '/creatures/red_dragon.svg' },
];

const npcs1e = [
  { id: 'commoner',     name: 'Commoner',       hp: 4,   ac: 10, color: '#a8956b', image: '/creatures/commoner.svg' },
  { id: 'merchant',     name: 'Merchant',       hp: 6,   ac: 9,  color: '#a87a3e', image: '/creatures/merchant.svg' },
  { id: 'guard',        name: 'Guard',          hp: 11,  ac: 5,  color: '#4e5e7a', image: '/creatures/guard.svg' },
  { id: 'city_watch',   name: 'City Watch',     hp: 13,  ac: 4,  color: '#3e4e6b', image: '/creatures/city_watch.svg' },
  { id: 'tavern_keeper',name: 'Tavern Keeper',  hp: 8,   ac: 9,  color: '#8b5a2e', image: '/creatures/tavern_keeper.svg' },
  { id: 'priest',       name: 'Priest',         hp: 9,   ac: 8,  color: '#d8c878', image: '/creatures/priest.svg' },
  { id: 'noble',        name: 'Noble',          hp: 7,   ac: 8,  color: '#6e3e7a', image: '/creatures/noble.svg' },
  { id: 'mage',         name: 'Mage',           hp: 8,   ac: 9,  color: '#3e3e8a', image: '/creatures/mage.svg' },
  { id: 'thug',         name: 'Thug',           hp: 12,  ac: 8,  color: '#5e3a3a', image: '/creatures/thug.svg' },
  { id: 'bandit',       name: 'Bandit',         hp: 9,   ac: 7,  color: '#6b4e3a', image: '/creatures/bandit.svg' },
];

// 5e: ascending AC, slightly higher HP across the board.
const monsters5e = [
  { id: 'goblin',       name: 'Goblin',         hp: 7,   ac: 15, color: '#6b8e4e', image: '/creatures/goblin.svg' },
  { id: 'orc',          name: 'Orc',            hp: 15,  ac: 13, color: '#7a4e2e', image: '/creatures/orc.svg' },
  { id: 'kobold',       name: 'Kobold',         hp: 5,   ac: 12, color: '#8b3a2e', image: '/creatures/kobold.svg' },
  { id: 'gnoll',        name: 'Gnoll',          hp: 22,  ac: 15, color: '#a07a3e', image: '/creatures/gnoll.svg' },
  { id: 'hobgoblin',    name: 'Hobgoblin',      hp: 11,  ac: 18, color: '#5e6b3a', image: '/creatures/hobgoblin.svg' },
  { id: 'bugbear',      name: 'Bugbear',        hp: 27,  ac: 16, color: '#6b4a2e', image: '/creatures/bugbear.svg' },
  { id: 'skeleton',     name: 'Skeleton',       hp: 13,  ac: 13, color: '#e8e0c8', image: '/creatures/skeleton.svg' },
  { id: 'zombie',       name: 'Zombie',         hp: 22,  ac: 8,  color: '#7a8a5a', image: '/creatures/zombie.svg' },
  { id: 'ghoul',        name: 'Ghoul',          hp: 22,  ac: 12, color: '#5a5a3a', image: '/creatures/ghoul.svg' },
  { id: 'wight',        name: 'Wight',          hp: 45,  ac: 14, color: '#3a3a4e', image: '/creatures/wight.svg' },
  { id: 'giant_rat',    name: 'Giant Rat',      hp: 7,   ac: 12, color: '#5e4a3a', image: '/creatures/giant_rat.svg' },
  { id: 'giant_spider', name: 'Giant Spider',   hp: 26,  ac: 14, color: '#2e2e3a', image: '/creatures/giant_spider.svg' },
  { id: 'wolf',         name: 'Wolf',           hp: 11,  ac: 13, color: '#6e6e6e', image: '/creatures/wolf.svg' },
  { id: 'dire_wolf',    name: 'Dire Wolf',      hp: 37,  ac: 14, color: '#4e4e4e', image: '/creatures/dire_wolf.svg' },
  { id: 'ogre',         name: 'Ogre',           hp: 59,  ac: 11, color: '#8a6e4e', image: '/creatures/ogre.svg' },
  { id: 'troll',        name: 'Troll',          hp: 84,  ac: 15, color: '#4e6b3a', image: '/creatures/troll.svg' },
  { id: 'hill_giant',   name: 'Hill Giant',     hp: 105, ac: 13, color: '#7a5e3a', image: '/creatures/hill_giant.svg' },
  { id: 'brown_bear',   name: 'Brown Bear',     hp: 34,  ac: 11, color: '#5e3a1e', image: '/creatures/brown_bear.svg' },
  { id: 'lizardman',    name: 'Lizardman',      hp: 22,  ac: 15, color: '#3e6b4a', image: '/creatures/lizardman.svg' },
  { id: 'red_dragon',   name: 'Red Dragon',     hp: 178, ac: 19, color: '#a03020', image: '/creatures/red_dragon.svg' },
];

const npcs5e = [
  { id: 'commoner',     name: 'Commoner',       hp: 4,   ac: 10, color: '#a8956b', image: '/creatures/commoner.svg' },
  { id: 'merchant',     name: 'Merchant',       hp: 9,   ac: 11, color: '#a87a3e', image: '/creatures/merchant.svg' },
  { id: 'guard',        name: 'Guard',          hp: 11,  ac: 16, color: '#4e5e7a', image: '/creatures/guard.svg' },
  { id: 'city_watch',   name: 'City Watch',     hp: 16,  ac: 18, color: '#3e4e6b', image: '/creatures/city_watch.svg' },
  { id: 'tavern_keeper',name: 'Tavern Keeper',  hp: 9,   ac: 11, color: '#8b5a2e', image: '/creatures/tavern_keeper.svg' },
  { id: 'priest',       name: 'Priest',         hp: 27,  ac: 13, color: '#d8c878', image: '/creatures/priest.svg' },
  { id: 'noble',        name: 'Noble',          hp: 9,   ac: 15, color: '#6e3e7a', image: '/creatures/noble.svg' },
  { id: 'mage',         name: 'Mage',           hp: 40,  ac: 12, color: '#3e3e8a', image: '/creatures/mage.svg' },
  { id: 'thug',         name: 'Thug',           hp: 32,  ac: 11, color: '#5e3a3a', image: '/creatures/thug.svg' },
  { id: 'bandit',       name: 'Bandit',         hp: 11,  ac: 12, color: '#6b4e3a', image: '/creatures/bandit.svg' },
];

// 2e is aliased to 1e for v1 — same descending-AC convention, same archetypes.
export const CREATURES = {
  '1e': { monsters: monsters1e, npcs: npcs1e },
  '2e': { monsters: monsters1e, npcs: npcs1e },
  '5e': { monsters: monsters5e, npcs: npcs5e },
};

export function getCreatures(ruleset, kind) {
  const set = CREATURES[ruleset] || CREATURES['1e'];
  if (kind === 'monster') return set.monsters;
  if (kind === 'npc')     return set.npcs;
  return [];
}
