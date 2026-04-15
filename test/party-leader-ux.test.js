import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canMoveToken } from '../lib/logic.js';

// Permission matrix for token moves — replaces the inline guard in
// server.js `token:move`. Covers the new party-leader exception: a player
// who owns the campaign's party-leader token may also move any PC token.

const dm = { id: 1, role: 'dm' };
const alice = { id: 10, role: 'player' };
const bob = { id: 11, role: 'player' };

const aliceToken = { id: 100, kind: 'pc', owner_id: alice.id };
const bobToken = { id: 101, kind: 'pc', owner_id: bob.id };
const aMonster = { id: 200, kind: 'monster', owner_id: null };
const campaign = { id: 1, party_leader_id: 100 };

test('canMoveToken: DM can move any token', () => {
  assert.equal(canMoveToken(dm, aliceToken, campaign, aliceToken), true);
  assert.equal(canMoveToken(dm, bobToken, campaign, aliceToken), true);
  assert.equal(canMoveToken(dm, aMonster, campaign, aliceToken), true);
});

test('canMoveToken: player can move their own token', () => {
  assert.equal(canMoveToken(alice, aliceToken, campaign, aliceToken), true);
});

test('canMoveToken: player cannot move another player\'s PC without leader', () => {
  assert.equal(canMoveToken(bob, aliceToken, campaign, null), false);
});

test('canMoveToken: party leader can move other PCs (exception)', () => {
  // Alice owns the leader token, so she can move Bob's PC.
  assert.equal(canMoveToken(alice, bobToken, campaign, aliceToken), true);
});

test('canMoveToken: party leader cannot move non-PCs (leader exception is PC-only)', () => {
  assert.equal(canMoveToken(alice, aMonster, campaign, aliceToken), false);
});

test('canMoveToken: non-leader player cannot use leader exception', () => {
  // Bob is NOT the leader (Alice is). Bob tries to move Alice's PC.
  assert.equal(canMoveToken(bob, aliceToken, campaign, aliceToken), false);
});

test('canMoveToken: null/undefined args are safe', () => {
  assert.equal(canMoveToken(null, aliceToken, campaign, aliceToken), false);
  assert.equal(canMoveToken(alice, null, campaign, aliceToken), false);
});

test('canMoveToken: no leader set at all', () => {
  assert.equal(canMoveToken(alice, aliceToken, { party_leader_id: null }, null), true);
  assert.equal(canMoveToken(bob, aliceToken, { party_leader_id: null }, null), false);
});
