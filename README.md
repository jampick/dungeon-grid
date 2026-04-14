# Dungeon Grid

A self-hosted, pencil-and-paper-aesthetic virtual tabletop for D&D. Built for small groups who want the feel of graph paper and hand-drawn maps over a remote session — not a video game.

## Features (MVP)

- **Hex or square grid**, toggleable per map
- **Real-time sync** across DM and up to ~8 players via websockets
- **DM and player roles** — DM password + named player sessions
- **Token drag-and-drop** with names, HP/AC, color, optional uploaded image
- **HP visibility rules** — players see their own HP; DM sees everything; DM can toggle health bars on for other tokens
- **Light sources** — tokens can carry a radius; rendered as soft glow (no raycasted occlusion — by design)
- **DM-painted fog of war** — brush-based reveal/hide
- **Background maps** — upload a scanned grid-paper map or hand drawing
- **Dice roller** (`d4`–`d100`, custom like `2d6+3`) with chat log
- **Approval mode** — DM can require approval for player actions, or allow live edits
- **Configurable ruleset** field (1e default; 2e, 5e options present — rules engine is deliberately minimal)
- **SQLite persistence** — encounters survive restarts

## Quick start

```bash
npm install
DM_PASSWORD=your-secret npm start
```

Open `http://localhost:3000`. Log in as DM with your password, or join as a player by name.

## Deployment

Designed to run as a single Docker container on a NAS. Put Cloudflare Access (or similar) in front for public exposure. Never expose the DM password externally — it's the only admin gate.

## Scope (what this deliberately is *not*)

- Not a Roll20/Foundry replacement
- No dynamic line-of-sight / raycasted vision (fights the paper aesthetic and is a month of work)
- No character sheets or automated rules resolution — the DM adjudicates

## License

MIT
