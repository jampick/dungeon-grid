# Roadmap

Design notes for future work on dungeon-grid. Items here are not committed features — they are sketches for design discussion before implementation.

## Multi-tenant sessions

### Background

The app currently supports exactly one campaign. Every map, token, wall, fog cell, and player row is implicitly global. Two groups pointed at the same instance would see each other's tokens and overwrite each other's maps. Today the deployed instance works around this by being gated behind a single Cloudflare Access email allowlist — only one group uses it.

The goal of this work is session/room isolation so multiple independent groups can share one hosted instance without stepping on each other, each with their own DM, their own players, and their own persistent state.

### Non-goals

- Cross-session features (shared asset library across groups, global chat, account system). Each session is an island.
- A full account/identity system. Players are still ephemeral per-session, identified by display name.
- Billing, quotas, or any SaaS-ification. This is still self-hosted for friend groups.

### Data model changes

- New top-level `sessions` table:
  ```sql
  sessions(
    id TEXT PRIMARY KEY,        -- short URL-safe, e.g. 'dk7-p9m-rats' or 8-char base32
    name TEXT NOT NULL,
    dm_password_hash TEXT NOT NULL,       -- bcrypt/argon2, never plaintext
    join_password_hash TEXT,              -- optional; if set, required for players
    created_at INTEGER,
    last_active_at INTEGER
  )
  ```

- Add `session_id TEXT` foreign key to `campaigns`, `maps`, `tokens`, `walls`, `fog`, `players`, `catalog`, `events`.

- Every DB query and every socket handler filters by session.

### URL shape

`https://yourhost.dev/s/<session_id>` — session ID in path. Landing page at `/` lists "Create session" and "Join with link".

### Login flow

1. User hits `/s/dk7-p9m-rats`
2. Server looks up session; 404 if missing
3. Login screen shows session name, asks: player name, session password (if set), DM password (optional — only filled in for DM)
4. Validates against `sessions.dm_password_hash` and `sessions.join_password_hash`
5. Issues a player token scoped to that session; socket connection carries session ID

### Security items that must be done in the same branch

- bcrypt or argon2 for password hashing (add one dep)
- `express-rate-limit` on the login endpoints, per IP per session
- Uploads scoped to `uploads/<session_id>/` so link leaks don't expose everyone's maps
- Session IDs generated from `crypto.randomBytes` — 8 chars of base32 = 40 bits, good enough for short-lived games
- Idle session cleanup: row in `sessions` with `last_active_at > 30 days ago` gets deleted (cron or on-startup sweep)

### Phased delivery suggestion

- **Phase 1**: `sessions` table, URL routing, optional join password, create-session flow. Don't scope queries yet; the "default" session owns all current data. Migration: existing rows get `session_id = 'default'`.
- **Phase 2**: Add `session_id` foreign keys to every table, rewrite queries, scope uploads, hash passwords, rate-limit. This is the big one.
- **Phase 3**: Session management UI (list my sessions, rename, delete, change password).

### Estimated scope

A full weekend minimum, probably two. Many tests will need updating.

### When to tackle this

This is a large refactor. Do not start it without dedicated uninterrupted time and zero parallel branches, because every query and socket handler in the app gets rewritten.

## Other ideas

Append new design sketches here as they come up.
