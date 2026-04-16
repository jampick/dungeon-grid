// Regression for issue #12: the browser DM login posted `dm_password` while
// the server (`loginDm` in lib/logic.js) destructures `password`. All unit
// tests called loginDm() directly with the right field name, so the mismatch
// silently shipped. These tests lock in the wire field name on both sides.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginDm } from '../lib/logic.js';
import Database from 'better-sqlite3';
import { migrate } from '../lib/sessions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.join(__dirname, '..', 'public', 'app.js');

test('public/app.js DM login fetch body uses `password`, not `dm_password`', () => {
  const src = fs.readFileSync(APP_JS, 'utf8');
  // Find the btnDM click handler block and inspect the body it builds.
  const m = src.match(/btnDM[\s\S]*?\/api\/login\/dm/);
  assert.ok(m, 'expected to find a DM login fetch in public/app.js');
  const block = m[0];
  assert.match(
    block,
    /\bpassword\s*:/,
    'DM login body must include a `password:` field (server reads body.password)'
  );
  assert.doesNotMatch(
    block,
    /\bdm_password\s*:/,
    'DM login body must NOT use `dm_password:` — that field name is for POST /api/sessions, not /api/login/dm'
  );
});

test('loginDm accepts the same field name the client sends (`password`)', () => {
  const db = new Database(':memory:');
  migrate(db);
  // Seed a minimal session row so loginDm gets past the session lookup.
  db.prepare('INSERT INTO sessions (id, name, created_at, last_active_at) VALUES (?,?,?,?)')
    .run('s1', 'Test', Date.now(), Date.now());
  const deps = {
    verifyDm: (pw) => pw === 'correct-horse',
    newToken: () => 'tok',
  };
  const ok = loginDm(db, { session_id: 's1', password: 'correct-horse', name: 'DM' }, deps);
  assert.equal(ok.ok, true, 'password field should be accepted');
  assert.equal(ok.role, 'dm');

  const wrongFieldName = loginDm(db, { session_id: 's1', dm_password: 'correct-horse', name: 'DM' }, deps);
  assert.equal(wrongFieldName.ok, false, 'dm_password field must NOT be accepted (would mask the bug)');
  assert.equal(wrongFieldName.status, 401);
});
