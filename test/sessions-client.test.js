import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSessionFromPath,
  authStorageKey,
  addJoinedSession,
} from '../lib/logic.js';

test('parseSessionFromPath: root is landing', () => {
  assert.deepEqual(parseSessionFromPath('/'), { mode: 'landing' });
  assert.deepEqual(parseSessionFromPath(''), { mode: 'landing' });
});

test('parseSessionFromPath: /s/<id> is session', () => {
  assert.deepEqual(parseSessionFromPath('/s/abc123'), { mode: 'session', sessionId: 'abc123' });
  assert.deepEqual(parseSessionFromPath('/s/default'), { mode: 'session', sessionId: 'default' });
  assert.deepEqual(parseSessionFromPath('/s/abc123/'), { mode: 'session', sessionId: 'abc123' });
});

test('parseSessionFromPath: anything else is unknown', () => {
  assert.deepEqual(parseSessionFromPath('/other'), { mode: 'unknown' });
  assert.deepEqual(parseSessionFromPath('/s/Bad_ID'), { mode: 'unknown' });
  assert.deepEqual(parseSessionFromPath('/s/'), { mode: 'unknown' });
});

test('authStorageKey: scopes by session id', () => {
  assert.equal(authStorageKey('abc'), 'dg_auth:abc');
  assert.equal(authStorageKey('default'), 'dg_auth:default');
});

test('addJoinedSession: inserts into empty list', () => {
  assert.deepEqual(
    addJoinedSession([], { id: 'a', name: 'A' }),
    [{ id: 'a', name: 'A' }]
  );
});

test('addJoinedSession: bubbles newest to the front', () => {
  assert.deepEqual(
    addJoinedSession([{ id: 'a', name: 'A' }], { id: 'b', name: 'B' }),
    [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]
  );
});

test('addJoinedSession: dedupes by id and refreshes name', () => {
  assert.deepEqual(
    addJoinedSession([{ id: 'a', name: 'A' }], { id: 'a', name: 'A updated' }),
    [{ id: 'a', name: 'A updated' }]
  );
});

test('addJoinedSession: dedupe moves re-entered session to front', () => {
  assert.deepEqual(
    addJoinedSession(
      [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      { id: 'b', name: 'B' }
    ),
    [{ id: 'b', name: 'B' }, { id: 'a', name: 'A' }]
  );
});

test('addJoinedSession: respects max cap', () => {
  let list = [];
  for (let i = 0; i < 11; i++) {
    list = addJoinedSession(list, { id: 's' + i, name: 'S' + i });
  }
  assert.equal(list.length, 10);
  // Most recent insert is at the front
  assert.equal(list[0].id, 's10');
  // Oldest dropped
  assert.ok(!list.find((e) => e.id === 's0'));
});

test('addJoinedSession: custom max', () => {
  const list = addJoinedSession(
    addJoinedSession(addJoinedSession([], { id: 'a', name: 'A' }), { id: 'b', name: 'B' }),
    { id: 'c', name: 'C' },
    2
  );
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'c');
  assert.equal(list[1].id, 'b');
});
