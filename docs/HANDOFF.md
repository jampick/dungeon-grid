# Dungeon Grid — Handoff Notes

This document captures the current state of the `dungeon-grid` project so work can continue from another machine. It is the canonical "what's done, what's next, how to run it" reference.

Last updated: 2026-04-14

---

## What this project is

A self-hosted, real-time, pencil-and-paper-aesthetic VTT for D&D, built for small groups who want the feel of graph paper and hand-drawn maps over a remote session. Deliberately NOT a Roll20/Foundry replacement — leaves room for imagination.

- **Stack**: Node 22 + Express + Socket.IO + better-sqlite3 + vanilla JS Canvas
- **Repo**: `https://github.com/jampick/dungeon-grid` (private)
- **Local path on the Windows PC**: `C:\Users\jampick\projects\dungeon-grid`
- **Default target platform**: Synology NAS via Docker, or directly on a PC with Node

---

## How to run it locally

```bash
cd C:\Users\jampick\projects\dungeon-grid   # or wherever you cloned it
npm install
DM_PASSWORD=your-secret npm start
```

Open `http://localhost:3000` in two browser windows (use an Incognito window for the second so they don't share localStorage). Log in as DM in one, Player in the other.

Run the test suite:

```bash
npm test
```

All 28 tests should pass. If they don't, don't ship anything.

---

## Workflow conventions (IMPORTANT)

The user prefers **branch-per-feature with test-gated merges**, parallelized via subagents:

1. For any non-trivial work, Claude dispatches a subagent with isolation (either worktree hook or `git worktree add` manually) on a dedicated branch like `feat-xyz` or `fix-xyz`.
2. Every feature branch **must include tests**. Tests live in `test/` and use Node's built-in `node:test` + `node:assert`. No new runtime deps.
3. Pure logic lives in `lib/logic.js` and `lib/maps.js`. Server.js imports from them. Keep the refactor minimal.
4. Agents run `npm test` before pushing. If green: push the branch. **Agents do not merge to main.** The parent conversation merges serially once all parallel agents report green, so conflicts are resolved once by a human (or the main Claude).
5. Agents **never touch `data/grid.db`**. Use `fs.mkdtempSync` for test DBs.

This is captured in memory at:
`C:\Users\jampick\.claude\projects\C--Users-jampick-OneDrive-Documents-fromMac-DnD-Map\memory\feedback_workflow.md`

Bring that memory with you if you're resuming from a different machine.

---

## Current feature set (as of last merge `bb1343f`)

### Grid & map
- Hex or square grid toggle per map
- Uploadable background image (scanned graph paper, etc.)
- Map settings: grid type, cell px, width, height
- **Map Library**: DM can create, rename, duplicate, activate, delete maps. Tokens/walls/fog are per-map. Duplicating a map copies tokens+walls+fog.

### Tokens
- Drag-and-drop, named, HP/AC, color
- Uploaded token images (optional)
- Owner assignment (which player controls which token)
- Kinds: PC / NPC / monster / object
- Size multiplier
- Facing (8-way compass), rotate with Q/E when selected

### Light sources (1e preset table)
- `none`, `candle` (2 cells), `torch` (3), `lantern` (6), `bullseye` (12 cone), `light_spell` (4), `continual` (12), `infravision` (12)
- Bullseye renders as a cone in the facing direction (60° half-angle)
- Custom radius override available

### Fog of war (dynamic, currently-visible model)
- Server-side flood-fill from each **party** token's light source (kind=pc OR owner_id set)
- Walls and **closed doors** block light propagation
- Diagonals require both orthogonal gaps clear
- Fog recomputes on any token move/create/update/delete/map change
- Cells outside any party light are fogged
- DM fog brushes (reveal/hide/clear/cover all) remain for edge cases — auto-recompute overrides them as soon as a token moves

### Walls & doors
- **Edge tool** — click cell edge to toggle a wall segment
- **Room (drag) tool** — drag to outline rectangular rooms; walls around the whole perimeter
- **Door tool** — click cell edge to cycle: none → closed door → open door → none; replaces walls
- Closed doors block light like walls; open doors let light through
- Players can click visible doors to **request** open/close; DM approves
- `door_approval` campaign setting (default ON)
- Door pending state shows a red `?` indicator on the door for everyone

### Approval mode
- Campaign setting `approval_mode` gates player token moves
- Player drag → token snaps back to original; a dashed ghost circle at the destination with a connector line shows on all clients
- DM sees a **Pending actions** box (top-right) listing both pending moves and pending door requests, with Approve/Deny buttons
- Pending state is in memory only (cleared on server restart)

### Player LOS rendering
- Players see opaque fog (DM sees 55% alpha so they can still see through it)
- Tokens, walls, doors, light glows in fogged cells are not drawn for players
- Players always see their own token, even in darkness

### Chat & dice
- Shared chat on the right panel
- Dice roller: d4/d6/d8/d10/d12/d20/d100 + custom (`2d6+3` style)
- Rolls show in chat
- **DM `clear` button** wipes chat for everyone (broadcast `chat:cleared`)

### Undo (DM only)
- In-memory undo stack, 50 entries max
- Ctrl+Z or `Undo` button in the top toolbar
- Inverses captured for: token move/create/update/delete, map settings change, fog override, wall toggle/clear/rect, door cycle
- Stack clears when active map changes
- `state.undoLabel` exposes the top entry label for the tooltip
- **Not** undone: chat, dice, campaign settings, player login flows, approval-mode pending moves (those use a different queue), door:request/resolve

### Collapsible/resizable panels
- Left and right sidebars have `‹` / `›` toggle buttons at screen edges
- Both can be resized by dragging their inner edge (180–600 px)
- Canvas auto-rescales

---

## Data model

SQLite file at `data/grid.db`. WAL mode. Tables:

- `campaigns(id, name, ruleset, approval_mode, door_approval, show_other_hp, created_at)`
- `maps(id, campaign_id, name, grid_type, grid_size, width, height, background, active)`
- `tokens(id, map_id, kind, name, image, x, y, hp_current, hp_max, ac, light_radius, light_type, facing, color, owner_id, size)`
- `walls(map_id, cx, cy, side, kind, open)` — side is 'n' or 'w'; kind is 'wall' or 'door'
- `fog(map_id, data)` — JSON array of `"x,y"` cell keys
- `players(id, campaign_id, name, token, role)` — role is 'dm' or 'player'
- `catalog(id, name, kind, image, size)` — for the drag-on object library (not yet wired into UI)
- `events(id, campaign_id, ts, actor, kind, payload)` — audit log placeholder, not currently written

**Known limitation**: exactly one campaign is supported. Players and DM share the same global game. See "Next up" for the session refactor.

---

## Repo layout

```
dungeon-grid/
├── data/              # SQLite DB (gitignored)
├── docs/
│   └── HANDOFF.md     # this file
├── lib/
│   ├── logic.js       # pure functions: dice, light presets, computeRevealed, recomputeFog, undo stack, canClearChat, snapshots
│   └── maps.js        # map CRUD helpers (list/create/rename/activate/duplicate/delete)
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js         # vanilla JS canvas client
├── test/
│   ├── chat.test.js
│   ├── dice.test.js
│   ├── fog.test.js
│   ├── light.test.js
│   ├── maps.test.js
│   ├── undo.test.js
│   ├── visibility.test.js
│   └── walls.test.js
├── uploads/           # user-uploaded images (gitignored)
├── Dockerfile
├── LICENSE            # MIT
├── package.json
├── README.md
└── server.js
```

---

## What's in flight / next up

Nothing is currently in flight. The last merge wave (wall-rect fix, chat clear, map library, undo) landed cleanly on `main` at commit `bb1343f`.

### High-priority next items

1. **Secure internet access for external testers** — user is about to tackle this (see next section).
2. **Session / room refactor** — multi-tenant support so multiple groups can play simultaneously without stepping on each other. **Large refactor. Do not start until (1) is done and (1) should be validated working.** Full design brief below.
3. **wall:rect should emit full rows** — already fixed in `fix-wall-rect-fields`. ✓
4. **Object catalog UI** — table exists, no UI. DM could build a library of huts/trees/furniture and drag them onto maps.
5. **Initiative tracker** — user mentioned it early on; not built.
6. **Grid-cell coding** — walls/doors/lights/notes metadata per cell. Current walls handle some of this.
7. **Scanned map auto-grid detection** — OpenCV.js territory. Phase 3, deferred.

---

## Secure internet access plan (IN PROGRESS — start here on the other machine)

Goal: user needs to share a link with external friends to play-test. The game host is either the user's PC or their Synology NAS. The machine you will be resuming from **does have SSH access to the NAS** (the current machine does not). This is part of why we're handing off.

### Recommended approach: Cloudflare Tunnel + Cloudflare Access

1. **Cloudflare Tunnel** gives a stable public hostname without port forwarding or opening the firewall. Outbound connection from the NAS to Cloudflare — no inbound exposure.
2. **Cloudflare Access** puts an authentication gate in front of the tunnel (email PIN, GitHub login, or allowlist). Even if there's a bug in our app auth, external users can't reach the Node server without passing Access first.
3. This gives belt-and-suspenders: Access gates the perimeter, DM password gates the game role inside.

### What's needed on the NAS

- Docker (Synology Container Manager counts) OR direct Node install
- `cloudflared` binary (container or native)
- A Cloudflare account (free tier is fine) with a domain managed by Cloudflare
- The domain can be a `.dev`/`.app` cheapie from Cloudflare Registrar; doesn't need to be nice

### Steps to take (when resuming from the NAS-SSH machine)

1. **Clone the repo on the NAS**:
   ```bash
   ssh your-nas
   cd /volume1/docker   # or wherever you keep compose stacks
   git clone https://github.com/jampick/dungeon-grid.git
   cd dungeon-grid
   ```

2. **Build and run the Docker container**:
   The existing `Dockerfile` in the repo works. Create `docker-compose.yml`:
   ```yaml
   services:
     dungeon-grid:
       build: .
       restart: unless-stopped
       environment:
         DM_PASSWORD: CHANGE_ME_TO_A_STRONG_VALUE
         PORT: 3000
       volumes:
         - ./data:/app/data
         - ./uploads:/app/uploads
       ports:
         - "127.0.0.1:3000:3000"   # bind to loopback only — tunnel reaches it via the Docker network
   ```
   Then `docker compose up -d`.

3. **Set up Cloudflare Tunnel**:
   - In Cloudflare dashboard → Zero Trust → Networks → Tunnels → Create a tunnel
   - Name it `dungeon-grid`
   - Install the `cloudflared` connector on the NAS (Cloudflare gives a one-liner `docker run` command specific to your tunnel)
   - In the tunnel's Public Hostnames tab, add a hostname like `dnd.yourdomain.dev` pointing to `http://dungeon-grid:3000` (or `http://localhost:3000` if running native)
   - Save

4. **Put Cloudflare Access in front**:
   - Zero Trust → Access → Applications → Add an application → Self-hosted
   - Domain: `dnd.yourdomain.dev`
   - Add a policy: "Include → Emails → alice@example.com, bob@example.com" (list of your players)
   - Or: "Include → Email domain → example.com"
   - Save
   - Now anyone hitting the URL gets a Cloudflare login page first

5. **Test with a friend**:
   - Send them the link `https://dnd.yourdomain.dev`
   - They click → Cloudflare Access prompts for email → they get a one-time code
   - After passing Access, they hit the Node app's login page → enter their name → join as player
   - You (on your NAS) also hit the same URL, log in as DM with the password from step 2

### Gotchas to watch for

- **WebSockets must be enabled on the tunnel**. Socket.IO needs them. Cloudflare Tunnel supports WS by default, but if you see the client retrying or falling back to long-polling, check the tunnel config.
- **Uploads have a 10 MB limit in server.js** (`maxHttpBufferSize`). Cloudflare Free tier has a 100 MB body limit on Access-protected routes. Fine.
- **DM password must be strong** — even with Access in front, defense in depth. Set it via the compose file or a `.env`.
- **The SQLite DB lives in `./data/grid.db`**. Back it up. Losing it = losing all campaign state.
- **Health bars and HP toggles still work** as designed.

### When to revisit session isolation

Once external testing proves the single-session app works for your group, the user wants to expand to multi-group session support. This is a significant refactor (see "Session design brief" below). Do **not** mix the session refactor with the initial internet deploy — ship external access first, validate it, then refactor.

---

## Session design brief (for a later branch, NOT NOW)

User asked for session/room isolation so multiple groups can't step on each other. The app currently has exactly one campaign.

**Proposed branch name**: `feat-sessions`

**Data model changes**:

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

**URL shape**: `https://yourhost.dev/s/<session_id>` — session ID in path. Landing page at `/` lists "Create session" and "Join with link".

**Login flow**:
1. User hits `/s/dk7-p9m-rats`
2. Server looks up session; 404 if missing
3. Login screen shows session name, asks: player name, session password (if set), DM password (optional — only filled in for DM)
4. Validates against `sessions.dm_password_hash` and `sessions.join_password_hash`
5. Issues a player token scoped to that session; socket connection carries session ID

**Security items that must be done in the same branch**:
- bcrypt or argon2 for password hashing (add one dep)
- `express-rate-limit` on the login endpoints, per IP per session
- Uploads scoped to `uploads/<session_id>/` so link leaks don't expose everyone's maps
- Session IDs generated from `crypto.randomBytes` — 8 chars of base32 = 40 bits, good enough for short-lived games
- Idle session cleanup: row in `sessions` with `last_active_at > 30 days ago` gets deleted (cron or on-startup sweep)

**Phased delivery suggestion**:
- Phase 1: `sessions` table, URL routing, optional join password, create-session flow. Don't scope queries yet; the "default" session owns all current data. Migration: existing rows get `session_id = 'default'`.
- Phase 2: Add `session_id` foreign keys to every table, rewrite queries, scope uploads, hash passwords, rate-limit. This is the big one.
- Phase 3: Session management UI (list my sessions, rename, delete, change password).

**Estimated scope**: a full weekend minimum, probably two. Many tests will need updating.

**Why this is NOT the next task**: conflicts too heavily with any other in-flight work. Finish internet access, validate, then dispatch this as its own branch with no parallel work.

---

## Known bugs / tech debt

- **`rollDice` used to throw on non-string input** — hardened in `lib/logic.js`, acceptable.
- **No event log**: `events` table exists but isn't written. Could use it for an activity feed later.
- **No persistent auth**: players are identified by an ephemeral `token` in the `players` table. Refresh = reconnect, no problem; but there's no "forgot your name" flow and names must be unique per campaign.
- **Approval-mode pending moves are NOT undoable** by the DM undo stack. Different queue. OK for v1, revisit later.
- **Hex grid tokens still use square-cell indexing** (`x`, `y` are cell coords). Visually OK but movement on hex doesn't follow the "every other row offset" logic of true hex coords. Mostly cosmetic for now since movement is free-form drag.
- **Infravision is modeled as a 60 ft light source for simplicity**. In 1e it only works in darkness and shows heat. Not distinguished.
- **Wall occlusion is cell-edge, not freeform**. No raycasting against arbitrary line segments. You can only place walls on cell grid lines.

---

## When you resume on the other machine

1. Clone the repo if not already: `git clone git@github.com:jampick/dungeon-grid.git`
2. `git pull origin main` to pick up everything through commit `bb1343f` and this handoff doc
3. Read this file (you're reading it now)
4. Start with the **Secure internet access plan** section above
5. Bring the workflow memory with you if you want Claude on the other machine to follow the same branch-test-merge pattern. The memory file is at `~/.claude/projects/.../memory/feedback_workflow.md`. Or just tell Claude "follow the branch-per-feature + test-gated merge workflow from the previous machine."

Good luck. Don't skip the tests.
