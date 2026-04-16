# Dungeon Grid

A self-hosted, pencil-and-paper-aesthetic virtual tabletop for D&D. Built for small groups who want the feel of graph paper and hand-drawn maps over a remote session — not a video game, not a Roll20/Foundry replacement.

<!-- TODO: add screenshot -->

## Features

### Grid & maps
- Hex or square grid, toggleable per map
- Uploadable background image (scanned graph paper, hand drawings)
- Per-map settings: grid type, cell size, width, height, feet-per-square
- Corner scale legend (1 sq = 5 ft) with a 4-cell scale bar
- Map Library: DM can create, rename, duplicate, activate, delete maps. Tokens, walls, and fog are per-map; duplicating carries them along.
- **Random dungeon generation** — DM "Generate random map" button produces procedural rooms, corridors, and doors
- **Themed furniture** — generated rooms are themed (barracks, library, smithy, kitchen, throne room, etc.) and auto-populated with thematic objects (beds, bookshelves, anvils) from the object catalog

### Tokens
- Drag-and-drop, named, HP/AC, color, optional uploaded image with live preview pane and a clear-image button
- Kinds: PC / NPC / monster / object
- **Creature & object presets** — per-ruleset catalog dropdowns (monsters, NPCs, droppable furniture like chests, beds, weapon racks, barrels, braziers, fountains, thrones, altars). Picking a preset auto-fills name, HP, AC, color, image, size, and move
- **Size categories** — Tiny / Small / Medium / Large / Huge / Gargantuan; token circle scales accordingly
- **Race + movement** — per-ruleset race catalog with default per-race move distance; dashed range circle during drag, server-side re-validation, hard cap on single-action distance
- **Walls block player movement** — Bresenham-path check rejects drags through walls or closed doors (DM bypasses)
- 8-way facing with arrowhead tip; rotate with Q/E when selected
- **Stack indicator** — fan offset and corner ×N badge when multiple tokens share a cell
- Owner dropdown lists only currently-connected players; tokens auto-reassign to none after a 10-second disconnect grace period

### Light & fog of war
- 1e preset light table: none, candle (2), torch (3), lantern (6), bullseye (12 cone), light spell (4), continual (12), infravision (12). Custom radius override supported.
- Bullseye renders as a ~60° cone in the token's facing direction (default for hooded lantern too).
- **Three-state memory fog**: unexplored (pitch black), explored-memory (ghost tokens at last-seen positions, dim walls), currently lit (full render). Memory is shared by the whole party.
- **Live fog preview during drag** — light updates client-side as a token moves, not just on mouseup
- **Light source objects** — torches, lanterns, candles, braziers, campfires, light orbs keep illuminating after being dropped on the ground. Monsters carrying torches do *not* illuminate (keeps dungeons scary).
- **Memory rules** — party tokens are excluded from memory ghosts; stale monster memory clears when a token is re-spotted somewhere else
- **Light source approval** — optional setting requires DM to approve player light source changes
- Dynamic fog: server-side flood-fill from each party token's light source. Walls and closed doors block light; diagonal propagation requires both orthogonal gaps clear.
- Fog recomputes on any token move, create, update, delete, or map change.
- DM fog brushes (reveal, hide, clear, cover-all) and a Clear party memory button remain for edge cases.

### Walls & doors
- Edge tool — click a cell edge to toggle a wall segment
- Room (drag) tool — drag to outline rectangular rooms with perimeter walls
- Door tool — cycles a cell edge through none → closed → open → none; replaces walls
- Closed doors block light like walls; open doors pass light
- Players can click a visible door to request open/close; DM approves. Pending doors show a red `?` to everyone. Controlled by the `door_approval` campaign setting.

### Approval mode
- Three independent campaign settings: `approval_mode` (moves), `door_approval` (doors), `light_approval` (player light source changes)
- On drag, the player's token snaps back and a dashed ghost circle with connector line shows on all clients
- DM gets a Pending actions panel (top-right) with Approve / Deny for moves, door requests, and light changes
- Pending state is in memory only; clears on server restart

### Player line of sight
- Players see opaque fog; DM sees 55% alpha to keep oversight
- Tokens, walls, doors, and light glows in fogged cells are hidden from players
- Players always see their own token, even in darkness

### Spell effects (DM only)
- Drop AOE markers on the map: fireball circle, cone of cold cone, lightning bolt line, and the rest of the standard catalog
- Per-ruleset shape + radius catalog so each effect is correctly sized

### Chat & dice
- Shared chat panel
- Dice roller: d4, d6, d8, d10, d12, d20, d100, plus custom expressions like `2d6+3`
- Rolls post to chat
- **Unread indicator** — red dot on the right-panel toggle when the panel is collapsed and a new message arrives
- DM `clear` button wipes chat for everyone

### Undo (DM only)
- In-memory stack, 50 entries, Ctrl+Z or toolbar button
- Covers: token move / create / update / delete, map settings, fog overrides, wall toggle / clear / rect, door cycle, full random-map generation
- Stack clears on active-map change
- Does not cover: chat, dice, campaign settings, login flows, approval-mode pending queue, door requests

### DM vs player UI
- Collapsible, resizable left and right sidebars (180–600 px)
- Dark parchment theme by default; crescent-moon button toggles a brighter daylight theme
- **Player-seen tokens filter** — sidebar token list only shows tokens the party has seen; DM sees all
- DM toolbar exposes map library, walls, doors, fog brushes, approval queue, undo, and the deployment panel
- Player UI hides DM tools and respects fog
- Static `/lib` assets are served `no-cache` and `/app.js` is templated with a version stamp so deploys never serve stale JS

## Quick start

```bash
git clone https://github.com/jampick/dungeon-grid.git
cd dungeon-grid
npm install
DM_PASSWORD=your-secret npm start
```

Requires Node 22. Open `http://localhost:3000` in two browser windows — use Incognito for the second so they do not share localStorage. Log in as DM with the password set above; join as a player by name in the other window.

## Deploy via Docker (easiest)

Pull a prebuilt multi-arch image and run it — no cloning required. The image auto-builds on every push to `main` via GitHub Actions and supports `linux/amd64` and `linux/arm64` (Intel NASes, Raspberry Pi, Synology ARM, Apple Silicon).

```yaml
# docker-compose.yml
services:
  dungeon-grid:
    image: ghcr.io/jampick/dungeon-grid:latest
    restart: unless-stopped
    environment:
      DM_PASSWORD: your-secret
      PORT: 3000
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
    ports:
      - "127.0.0.1:3000:3000"
    read_only: true
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    tmpfs:
      - /tmp
```

`docker compose up -d` and visit http://localhost:3000. A ready-to-copy version of this file lives at [`docker-compose.example.yml`](docker-compose.example.yml).

> **First-time ghcr.io auth:** the image is published as PRIVATE by default until the maintainer flips it to public on https://github.com/jampick/dungeon-grid/pkgs/container/dungeon-grid. If your `docker compose pull` gets a 403/unauthorized, either wait for it to be made public or `docker login ghcr.io` with a GitHub PAT that has `read:packages`.

A Docker Hub mirror is also published at `jampick/dungeon-grid` once the maintainer configures the `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` repo secrets.

## Running the tests

```bash
npm test
```

Uses Node's built-in `node:test` runner. 356 tests across ~60 files covering chat, dice, fog (including memory fog), light (including effective radius and rounded falloff), maps (including random generation and object-catalog placement), creature catalog, sizes, movement range, walls, doors, visibility, undo, owner reassignment on disconnect, cache headers, login, theme, multi-tenant session isolation + migration + auth, session routing helpers, and deployment wiring.

## Deployment: Synology NAS + Cloudflare Tunnel + Cloudflare Access

The app is designed to run as a single Docker container on a NAS (Synology, but anything with Docker works), reached through a Cloudflare Tunnel gated by Cloudflare Access. This gives two independent auth layers:

- **Cloudflare Access** gates the perimeter (email allowlist, one-time PIN, GitHub SSO, etc.). No inbound port forwarding or firewall holes.
- **Cloudflare Tunnel** punches an outbound-only connection from the NAS to Cloudflare. The app never listens on a public interface.
- **`DM_PASSWORD`** gates the DM role inside the app. Defense in depth — set it to something strong even with Access in front.

You can deploy the NAS container in two ways:

1. **Pull the published image** (new, easier) — use `image: ghcr.io/jampick/dungeon-grid:latest` in your compose file and `docker compose pull && docker compose up -d`. No source checkout or local build required. See [Deploy via Docker](#deploy-via-docker-easiest) above. The image is private on ghcr.io until the maintainer flips it to public; authenticate with a GitHub PAT (`read:packages`) the first time if needed.
2. **Build from source** (existing, below) — clone the repo to the NAS and let `docker compose build` run the `Dockerfile`. This is what the existing `update.sh` polling loop uses and is still fully supported.

### docker-compose.yml (build from source)

```yaml
services:
  dungeon-grid:
    build:
      context: ./app
      network: host
      args:
        GIT_SHA: ${GIT_SHA:-unknown}
        GIT_SUBJECT: ${GIT_SUBJECT:-unknown}
    restart: unless-stopped
    environment:
      DM_PASSWORD: ${DM_PASSWORD}
      PORT: 3000
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
      - ./triggers:/app/triggers
    ports:
      - "127.0.0.1:3030:3000"
    read_only: true
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    user: "1026:100"
    mem_limit: 512m
    tmpfs:
      - /tmp
```

Notes:
- Bind port to `127.0.0.1` only — the tunnel reaches it from the host.
- `DM_PASSWORD` lives in an owner-only `.env` file, never in git.
- `build.network: host` works around Synology's default bridge network being unable to resolve DNS for `apk`.

### Cloudflare Tunnel setup

1. Install `cloudflared` on the NAS — a container in host-network mode is the least painful option. Cloudflare's Zero Trust dashboard provides a one-line `docker run` command once you create the tunnel.
2. Zero Trust → Networks → Tunnels → Create a tunnel. Name it `dungeon-grid` (or whatever).
3. In the tunnel's Public Hostnames tab, add a hostname (e.g. `grid.example.dev`) pointing to `http://localhost:3030`.
4. Save. Ingress lives in the dashboard, not a local config file.

### Cloudflare Access setup

1. Zero Trust → Access → Applications → Add an application → Self-hosted.
2. Domain: the hostname from the tunnel step.
3. Policy: Include → Emails (list your players) or Email domain (your org).
4. Save. Every request to the hostname now hits a Cloudflare login first.

### Gotcha: WebSockets

Socket.IO needs WebSocket upgrades. Cloudflare Tunnel enables WS by default — if clients are falling back to long-polling, check the tunnel configuration.

### Deploy loop (PC → NAS)

Iterate on the PC, push to `main`, the NAS picks it up. Two paths:

- **Automatic polling.** DSM Task Scheduler runs `update.sh` on the NAS host every minute. The script `git fetch`es via a containerized git (`alpine/git` — no git binary on the host), and if `origin/main` has advanced, pulls, rebuilds, and restarts. Latency is under a minute plus build time.
- **Manual trigger from the DM UI.** The DM sidebar has a Deployment panel showing the running short SHA and commit subject, plus a **Check for Updates** button. Clicking it writes a marker file into the bind-mounted `triggers/` directory; the next `update.sh` tick sees it and forces a rebuild even if `origin/main` has not moved. Useful for "I just pushed, redeploy now."

`update.sh` is fail-closed: if `docker compose build` fails it logs and exits, leaving the old container running. A stale SHA in the DM panel is the signal that something is wrong — check `triggers/last.log`.

**Critical constraint:** `/var/run/docker.sock` is deliberately not mounted into the container. A container RCE must not become NAS root. The trigger-file + host-runner pattern exists specifically to avoid exposing the socket. The updater runs on the host under DSM Task Scheduler.

## Configuration

Environment variables:

- `DM_PASSWORD` — required. The DM role gate inside the app.
- `PORT` — optional, defaults to `3000`.

Persistent state:

- `data/grid.db` — SQLite database (WAL mode). Back this up; losing it loses all campaign state.
- `uploads/` — user-uploaded background and token images.

Both directories are gitignored and expected to be bind-mounted in Docker deployments.

## Data model

SQLite, one file at `data/grid.db`. Tables:

- `campaigns` — campaign-wide settings (ruleset, approval_mode, door_approval, show_other_hp)
- `maps` — per-campaign maps with grid type, size, background, active flag
- `tokens` — per-map tokens with HP, AC, light, facing, owner, size, kind
- `walls` — per-map wall and door segments keyed by cell edge
- `fog` — per-map revealed-cell JSON blob (DM brush overrides)
- `explored_cells` — per-map set of cells the party has ever seen lit (memory fog "ever-explored" layer)
- `cell_memory` — per-cell snapshot of what was last seen at each remembered cell (memory fog ghost layer)
- `sessions` — top-level tenant rows (`id`, `name`, `join_password_hash`, per-session approval/ruleset settings, `last_active_at`). Every map/player/catalog row is scoped to a session id.
- `instance_settings` — global key/value store (currently holds the DM password hash, shared across sessions; rotate via `PUT /api/instance/dm-password`)
- `players` — per-session login records with role (`dm` or `player`)
- `catalog` — reusable drag-on object library (table exists; the live object catalog ships from `lib/objects.js`)
- `events` — audit log placeholder (table exists; not currently written)

The app is multi-tenant as of Phase 1. Visit `/` to see the landing page with all sessions, create a new one, or deep-link to `/s/<id>` to join a specific session. Uploaded assets are stored under `uploads/<session_id>/`. The DM password is global to the instance and gates both DM login and new-session creation.

## Architecture

Express serves static files and upload endpoints; Socket.IO carries the realtime game state. Persistence is `better-sqlite3` for synchronous, durable SQLite access. The client is vanilla JavaScript rendering to HTML5 Canvas — no build step, no framework, no bundler. Pure game logic (dice, light presets, fog recompute, undo stack, snapshots) lives in `lib/logic.js` and `lib/maps.js` so it can be unit-tested without a server.

## Known limitations

- **No event log.** The `events` table exists but nothing writes to it.
- **Hex token placement uses square-cell indexing.** Tokens carry `x`, `y` cell coordinates and do not follow true offset-hex math. Visually fine for free-form drag, not suitable for strict hex movement rules.
- **Infravision is modeled as a regular 60 ft light source.** 1e infravision is darkness-only and heat-based; the simplification is intentional.
- **Wall occlusion is cell-edge only.** No raycasting against arbitrary line segments; walls live on grid lines.
- **Approval-mode pending moves are not on the DM undo stack.** They use a separate queue.
- **A handful of catalog entries are still placeholders.** Most creature, object, and spell icons are now CC BY 3.0 icons from [game-icons.net](https://game-icons.net/) (see [CREDITS.md](CREDITS.md)); the few entries without a good semantic match still use auto-generated letter-in-circle SVGs.

## Roadmap

See [`docs/roadmap.md`](docs/roadmap.md) for design notes on future work.

## Contributing / workflow

This project uses branch-per-feature with test-gated merges.

## Credits

Creature, object, and spell icons are from [game-icons.net](https://game-icons.net/) under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). See [CREDITS.md](CREDITS.md) for per-icon attribution. The published container image bundles these assets and is therefore CC-BY-3.0-compatible; attribution is preserved in `CREDITS.md` inside the image.

## License

MIT
