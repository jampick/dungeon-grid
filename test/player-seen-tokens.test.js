import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSeenTokenIds } from '../lib/logic.js';

const T = (id, x, y, extra = {}) => ({ id, x, y, ...extra });

test('DM sees every token regardless of fog or ownership', () => {
  const tokens = [T(1, 0, 0), T(2, 5, 5, { owner_id: 7 }), T(3, 9, 9)];
  const fogCells = new Set(['0,0', '5,5', '9,9']);
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: [], playerId: null, isDM: true });
  assert.deepEqual([...seen].sort(), [1, 2, 3]);
});

test('Player sees their own owned token even when in fog', () => {
  const tokens = [T(1, 5, 5, { owner_id: 42 })];
  const fogCells = new Set(['5,5']);
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: [], playerId: 42, isDM: false });
  assert.ok(seen.has(1));
});

test('Player sees tokens whose current cell is lit (not fogged)', () => {
  const tokens = [T(1, 2, 2), T(2, 8, 8)];
  const fogCells = new Set(['8,8']); // 2,2 is lit
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: [], playerId: 1, isDM: false });
  assert.ok(seen.has(1));
  assert.ok(!seen.has(2));
});

test('Player sees tokens that appear in memoryTokens via token_id', () => {
  const tokens = [T(99, 4, 4)];
  const fogCells = new Set(['4,4']); // fogged
  const memoryTokens = [{ cx: 4, cy: 4, token_id: 99, snapshot: { name: 'Goblin' } }];
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens, playerId: 1, isDM: false });
  assert.ok(seen.has(99));
});

test('Player does NOT see a hidden monster in an unexplored fogged cell', () => {
  const tokens = [T(7, 10, 10, { kind: 'monster' })];
  const fogCells = new Set(['10,10']);
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: [], playerId: 1, isDM: false });
  assert.equal(seen.size, 0);
});

test('Player sees a remembered monster currently in fog (memory wins)', () => {
  const tokens = [T(7, 10, 10, { kind: 'monster' })];
  const fogCells = new Set(['10,10', '6,6']);
  // The party last saw it at (6,6); current pos (10,10) is also fogged.
  const memoryTokens = [{ cx: 6, cy: 6, token_id: 7, snapshot: { name: 'Orc' } }];
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens, playerId: 1, isDM: false });
  assert.ok(seen.has(7));
});

test('Empty inputs return empty set for player and empty for DM', () => {
  const seenPlayer = computeSeenTokenIds({ tokens: [], fogCells: new Set(), memoryTokens: [], playerId: 1, isDM: false });
  assert.equal(seenPlayer.size, 0);
  const seenDm = computeSeenTokenIds({ tokens: [], fogCells: new Set(), memoryTokens: [], playerId: null, isDM: true });
  assert.equal(seenDm.size, 0);
});

test('Null/undefined memoryTokens is tolerated (memory feature disabled)', () => {
  const tokens = [T(1, 0, 0), T(2, 5, 5)];
  const fogCells = new Set(['5,5']);
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: null, playerId: 1, isDM: false });
  assert.ok(seen.has(1));
  assert.ok(!seen.has(2));
});

test('Player owning a token in a lit cell only added once (Set semantics)', () => {
  const tokens = [T(1, 2, 2, { owner_id: 5 })];
  const fogCells = new Set();
  const seen = computeSeenTokenIds({ tokens, fogCells, memoryTokens: [], playerId: 5, isDM: false });
  assert.equal(seen.size, 1);
  assert.ok(seen.has(1));
});
