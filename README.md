# Dungeon Grid

A self-hosted, pencil-and-paper-aesthetic virtual tabletop for D&D. Built for small groups who want the feel of graph paper and hand-drawn maps over a remote session — not a video game, not a Roll20/Foundry replacement.

<!-- TODO: add screenshot -->

## Features

### Grid & maps
- Hex or square grid, toggleable per map
- Uploadable background image (scanned graph paper, hand drawings)
- Per-map settings: grid type, cell size, width, height
- Map Library: DM can create, rename, duplicate, activate, delete maps. Tokens, walls, and fog are per-map; duplicating carries them along.

### Tokens
- Drag-and-drop, named, HP/AC, color, optional uploaded image
- Kinds: PC / NPC / monster / object
- Owner assignment — which player controls which token
- Size multiplier
- 8-way facing; rotate with Q/E when selected

### Light & fog of war
- 1e preset light table: none, candle (2), torch (3), lantern (6), bullseye (12 cone), light spell (4), continual (12), infravision (12). Custom radius override supported.
- Bullseye renders as a 60-degree cone in the token's facing direction.
- Dynamic fog: server-side flood-fill from each party token's light source (kind `pc` or any token with an owner). Walls and closed doors block light; diagonal propagation requires both orthogonal gaps clear.
- Fog recomputes on any token move, create, update, delete, or map change.
- DM fog brushes (reveal, hide, clear, cover-all) remain for edge cases. The next token move overrides them.

### Walls & doors
- Edge tool — click a cell edge to toggle a wall segment
- Room (drag) tool — drag to outline rectangular rooms with perimeter walls
- Door tool — cycles a cell edge through none → closed → open → none; replaces walls
- Closed doors block light like walls; open doors pass light
- Players can click a visible door to request open/close; DM approves. Pending doors show a red `?` to everyone. Controlled by the `door_approval` campaign setting.

### Approval mode
- Campaign setting `approval_mode` gates player token moves
- On drag, the player's token snaps back and a dashed ghost circle with connector line shows on all clients
- DM gets a Pending actions panel (top-right) with Approve / Deny for moves and door requests
- Pending state is in memory only; clears on server restart

### Player line of sight
- Players see opaque fog; DM sees 55% alpha to keep oversight
- Tokens, walls, doors, and light glows in fogged cells are hidden from players
- Players always see their own token, even in darkness

### Chat & dice
- Shared chat panel
- Dice roller: d4, d6, d8, d10, d12, d20, d100, plus custom expressions like `2d6+3`
- Rolls post to chat
- DM `clear` button wipes chat for everyone

### Undo (DM only)
- In-memory stack, 50 entries, Ctrl+Z or toolbar button
- Covers: token move / create / update / delete, map settings, fog overrides, wall toggle / clear / rect, door cycle
- Stack clears on active-map change
- Does not cover: chat, dice, campaign settings, login flows, approval-mode pending queue, door requests

### DM vs player UI
- Collapsible, resizable left and right sidebars (180–600 px)
- DM toolbar exposes map library, walls, doors, fog brushes, approval queue, undo, and the deployment panel
- Player UI hides DM tools and respects fog

## Quick start

```bash
git clone https://github.com/jampick/dungeon-grid.git
cd dungeon-grid
npm install
DM_PASSWORD=your-secret npm start
```

Requires Node 22. Open `http://localhost:3000` in two browser windows — use Incognito for the second so they do not share localStorage. Log in as DM with the password set above; join as a player by name in the other window.

## Running the tests

```bash
npm test
```

Uses Node's built-in `node:test` runner. Nine test files covering chat, dice, fog, light, maps, undo, visibility, walls, and deployment wiring.

## Deployment: Synology NAS + Cloudflare Tunnel + Cloudflare Access

The app is designed to run as a single Docker container on a NAS (Synology, but anything with Docker works), reached through a Cloudflare Tunnel gated by Cloudflare Access. This gives two independent auth layers:

- **Cloudflare Access** gates the perimeter (email allowlist, one-time PIN, GitHub SSO, etc.). No inbound port forwarding or firewall holes.
- **Cloudflare Tunnel** punches an outbound-only connection from the NAS to Cloudflare. The app never listens on a public interface.
- **`DM_PASSWORD`** gates the DM role inside the app. Defense in depth — set it to something strong even with Access in front.

### docker-compose.yml

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

<!-- maintainer note: production deploy is live at grid.thesweetmojo.com -->

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
- `fog` — per-map revealed-cell JSON blob
- `players` — per-campaign login records with role (`dm` or `player`)
- `catalog` — reusable drag-on object library (table exists; UI not yet wired)
- `events` — audit log placeholder (table exists; not currently written)

Exactly one campaign is supported today. Multi-tenant session isolation is a deferred refactor.

## Architecture

Express serves static files and upload endpoints; Socket.IO carries the realtime game state. Persistence is `better-sqlite3` for synchronous, durable SQLite access. The client is vanilla JavaScript rendering to HTML5 Canvas — no build step, no framework, no bundler. Pure game logic (dice, light presets, fog recompute, undo stack, snapshots) lives in `lib/logic.js` and `lib/maps.js` so it can be unit-tested without a server.

## Known limitations

- **Single campaign.** Exactly one global game; multi-tenant session support is a deferred refactor.
- **No event log.** The `events` table exists but nothing writes to it.
- **Hex token placement uses square-cell indexing.** Tokens carry `x`, `y` cell coordinates and do not follow true offset-hex math. Visually fine for free-form drag, not suitable for strict hex movement rules.
- **Infravision is modeled as a regular 60 ft light source.** 1e infravision is darkness-only and heat-based; the simplification is intentional.
- **Wall occlusion is cell-edge only.** No raycasting against arbitrary line segments; walls live on grid lines.
- **Approval-mode pending moves are not on the DM undo stack.** They use a separate queue.

## Contributing / workflow

This project uses branch-per-feature with test-gated merges. Conventions, data model notes, and the deferred session-refactor brief live in [`docs/HANDOFF.md`](docs/HANDOFF.md).

## License

MIT
