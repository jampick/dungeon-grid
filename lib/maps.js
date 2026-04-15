// Map library DB helpers. Pure DB operations — no Socket.IO, no filesystem.
// Callers (server.js, tests) supply a better-sqlite3 database handle.

export function listMaps(db, campaignId) {
  return db.prepare('SELECT * FROM maps WHERE campaign_id=? ORDER BY id').all(campaignId);
}

export function getMap(db, id) {
  return db.prepare('SELECT * FROM maps WHERE id=?').get(id);
}

export function getActiveMap(db, campaignId) {
  if (campaignId != null) {
    return db.prepare('SELECT * FROM maps WHERE campaign_id=? AND active=1 ORDER BY id LIMIT 1').get(campaignId);
  }
  return db.prepare('SELECT * FROM maps WHERE active=1 ORDER BY id LIMIT 1').get();
}

export function createMap(db, campaignId, data = {}) {
  const info = db.prepare(
    'INSERT INTO maps (campaign_id, name, grid_type, grid_size, width, height, cell_feet) VALUES (?,?,?,?,?,?,?)'
  ).run(
    campaignId,
    data.name || 'New Map',
    data.grid_type || 'square',
    data.grid_size || 50,
    data.width || 30,
    data.height || 20,
    data.cell_feet || 5
  );
  return info.lastInsertRowid;
}

export function renameMap(db, id, name) {
  if (typeof name !== 'string' || !name.trim()) return false;
  const info = db.prepare('UPDATE maps SET name=? WHERE id=?').run(name.trim(), id);
  return info.changes > 0;
}

export function activateMap(db, id) {
  const m = db.prepare('SELECT campaign_id FROM maps WHERE id=?').get(id);
  if (!m) return false;
  const tx = db.transaction(() => {
    db.prepare('UPDATE maps SET active=0 WHERE campaign_id=?').run(m.campaign_id);
    db.prepare('UPDATE maps SET active=1 WHERE id=?').run(id);
  });
  tx();
  return true;
}

// Copy a map row plus all per-map child rows (tokens, walls, fog).
// Returns the new map id. New map starts inactive.
export function duplicateMap(db, id) {
  const src = db.prepare('SELECT * FROM maps WHERE id=?').get(id);
  if (!src) return null;
  let newId;
  const tx = db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO maps (campaign_id, name, grid_type, grid_size, width, height, background, active, cell_feet) VALUES (?,?,?,?,?,?,?,0,?)'
    ).run(
      src.campaign_id,
      `${src.name} (copy)`,
      src.grid_type,
      src.grid_size,
      src.width,
      src.height,
      src.background,
      src.cell_feet || 5
    );
    newId = info.lastInsertRowid;

    const tokens = db.prepare('SELECT * FROM tokens WHERE map_id=?').all(id);
    const insToken = db.prepare(
      `INSERT INTO tokens (map_id,kind,name,image,x,y,hp_current,hp_max,ac,light_radius,light_type,facing,color,owner_id,size)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    );
    for (const t of tokens) {
      insToken.run(
        newId, t.kind, t.name, t.image, t.x, t.y,
        t.hp_current, t.hp_max, t.ac,
        t.light_radius, t.light_type, t.facing,
        t.color, t.owner_id, t.size
      );
    }

    const walls = db.prepare('SELECT cx, cy, side, kind, open FROM walls WHERE map_id=?').all(id);
    const insWall = db.prepare(
      'INSERT INTO walls (map_id, cx, cy, side, kind, open) VALUES (?,?,?,?,?,?)'
    );
    for (const w of walls) insWall.run(newId, w.cx, w.cy, w.side, w.kind, w.open);

    const fogRow = db.prepare('SELECT data FROM fog WHERE map_id=?').get(id);
    if (fogRow) {
      db.prepare('INSERT INTO fog (map_id, data) VALUES (?,?)').run(newId, fogRow.data);
    }

    // Terrain cells copy with the duplicate so the new map starts as an
    // exact visual clone. Wrapped in try so older test DBs without the
    // terrain table don't break duplicateMap.
    try {
      const terrain = db.prepare('SELECT cx, cy, kind FROM terrain WHERE map_id=?').all(id);
      const insT = db.prepare('INSERT INTO terrain (map_id, cx, cy, kind) VALUES (?,?,?,?)');
      for (const t of terrain) insT.run(newId, t.cx, t.cy, t.kind);
    } catch {}
  });
  tx();
  return newId;
}

// Delete a map and all its per-map children. Refuses to delete the last map
// in a campaign (throws). If the deleted map was active, activates another map.
export function deleteMap(db, id) {
  const src = db.prepare('SELECT campaign_id, active FROM maps WHERE id=?').get(id);
  if (!src) return false;
  const count = db.prepare('SELECT COUNT(*) c FROM maps WHERE campaign_id=?').get(src.campaign_id).c;
  if (count <= 1) {
    throw new Error('cannot delete the last map in a campaign');
  }
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM tokens WHERE map_id=?').run(id);
    db.prepare('DELETE FROM walls WHERE map_id=?').run(id);
    db.prepare('DELETE FROM fog WHERE map_id=?').run(id);
    try { db.prepare('DELETE FROM terrain WHERE map_id=?').run(id); } catch {}
    db.prepare('DELETE FROM maps WHERE id=?').run(id);
    if (src.active) {
      const next = db.prepare('SELECT id FROM maps WHERE campaign_id=? ORDER BY id LIMIT 1').get(src.campaign_id);
      if (next) db.prepare('UPDATE maps SET active=1 WHERE id=?').run(next.id);
    }
    // Cascade-null any teleport links that pointed at the deleted map so
    // tokens on other maps don't keep dangling references.
    try {
      db.prepare('UPDATE tokens SET link_map_id=NULL, link_x=NULL, link_y=NULL WHERE link_map_id=?').run(id);
    } catch {}
  });
  tx();
  return true;
}

// Null out any tokens' link_map_id/x/y that point at the given mapId. Used
// when a map is deleted so surviving tokens on other maps don't carry
// dangling teleport links. Safe to call even if the column doesn't exist
// (older test DBs); in that case it's a no-op.
export function nullLinksToMap(db, mapId) {
  try {
    db.prepare('UPDATE tokens SET link_map_id=NULL, link_x=NULL, link_y=NULL WHERE link_map_id=?').run(mapId);
  } catch {}
}

// Travel helper. Relocates every token on linkToken.map_id owned by
// userId to the linked map/destination cell. Returns a summary object:
//   { ok: true, movedIds, fromMapId, toMapId, prev }
// where `prev` captures the pre-move state for undo. Returns
//   { ok: false, reason }
// when the link token is missing, unlinked, or the target map is gone.
// Pure DB operation — no Socket.IO. Extract point for testability.
export function performTravel(db, userId, linkTokenId) {
  const linkToken = db.prepare('SELECT * FROM tokens WHERE id=?').get(linkTokenId);
  if (!linkToken) return { ok: false, reason: 'no-link-token' };
  if (linkToken.link_map_id == null) return { ok: false, reason: 'not-a-link' };
  const targetMap = db.prepare('SELECT * FROM maps WHERE id=?').get(linkToken.link_map_id);
  if (!targetMap) return { ok: false, reason: 'target-missing' };

  const myTokens = db.prepare('SELECT * FROM tokens WHERE map_id=? AND owner_id=?').all(linkToken.map_id, userId);
  if (!myTokens.length) return { ok: false, reason: 'no-owned-token' };

  const destX = linkToken.link_x ?? 5;
  const destY = linkToken.link_y ?? 5;
  const prev = myTokens.map(t => ({ id: t.id, map_id: t.map_id, x: t.x, y: t.y }));
  const upd = db.prepare('UPDATE tokens SET map_id=?, x=?, y=? WHERE id=?');
  const tx = db.transaction(() => {
    for (const t of myTokens) upd.run(targetMap.id, destX, destY, t.id);
  });
  tx();
  return {
    ok: true,
    movedIds: myTokens.map(t => t.id),
    fromMapId: linkToken.map_id,
    toMapId: targetMap.id,
    prev,
  };
}
