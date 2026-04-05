// shared/worldgen.js — deterministic sector generation (server + client)
// Both sides must produce identical output for a given (gx, gy).

(function (root) {
  'use strict';

  function seededRand(seed) {
    let s = seed >>> 0;
    return () => {
      s = Math.imul(s ^ (s >>> 15), s | 1);
      s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
      return ((s ^ (s >>> 14)) >>> 0) / 0xFFFFFFFF;
    };
  }

  // Visual info (server ignores color/tip)
  const ORE_DEFS = [
    { type: 'iron',       color: '#c9855a', tip: '#e8a070' },
    { type: 'carbon',     color: '#767676', tip: '#aaaaaa' },
    { type: 'helium3',    color: '#5aaa60', tip: '#8fff90' },
    { type: 'crystal',    color: '#3a9ccc', tip: '#8de8ff' },
    { type: 'titanium',   color: '#aaaacc', tip: '#ffffff' },
    { type: 'plasma_gel', color: '#cc6622', tip: '#ff9940' },
  ];

  // Returns full sector data: asteroid shape + ore deposits (with stable IDs).
  // C = { SECTOR_SIZE, SECTOR_GRID_W, SECTOR_GRID_H }
  function buildSector(gx, gy, C) {
    C = C || { SECTOR_SIZE: 6000, SECTOR_GRID_W: 8, SECTOR_GRID_H: 8 };

    const rand = seededRand(gx * 73856093 ^ gy * 19349663);
    const S  = C.SECTOR_SIZE;
    const cx = gx * S + S / 2;
    const cy = gy * S + S / 2;

    // ── Asteroid shape ────────────────────────────────────────────────────────
    const N = 9 + Math.floor(rand() * 4);
    const baseR = 900 + rand() * 500;   // 900–1400 units

    const angles = [];
    for (let i = 0; i < N; i++) angles.push(rand() * Math.PI * 2);
    angles.sort((a, b) => a - b);

    const asteroidPts = [];
    for (const a of angles) {
      asteroidPts.push({ a, r: baseR * (0.45 + rand() * 0.55) });
    }

    // ── Facets (visual detail) ────────────────────────────────────────────────
    const facets = [];
    for (let i = 0; i < 5; i++) {
      const fa     = rand() * Math.PI * 2;
      const fd     = baseR * (0.15 + rand() * 0.45);
      const fVerts = 3 + Math.floor(rand() * 3);
      const fR     = 40 + rand() * 90;
      const pts    = [];
      for (let j = 0; j < fVerts; j++) {
        const a = (j / fVerts) * Math.PI * 2 + rand() * 0.6;
        pts.push({ a, r: fR * (0.5 + rand() * 0.5) });
      }
      facets.push({ ox: cx + Math.cos(fa) * fd, oy: cy + Math.sin(fa) * fd, pts });
    }

    // ── Craters ───────────────────────────────────────────────────────────────
    const craters = [];
    for (let i = 0; i < 4; i++) {
      const ca = rand() * Math.PI * 2;
      const cd = baseR * (0.2 + rand() * 0.55);
      craters.push({
        x: cx + Math.cos(ca) * cd, y: cy + Math.sin(ca) * cd,
        r: 18 + rand() * 45,
        n: 5 + Math.floor(rand() * 3),
        rot: rand() * Math.PI * 2,
      });
    }

    // ── Ore deposits ──────────────────────────────────────────────────────────
    const count   = 4 + Math.floor(rand() * 5);
    const isHome  = (gx === Math.floor(C.SECTOR_GRID_W / 2) && gy === Math.floor(C.SECTOR_GRID_H / 2));
    const orePool = isHome ? ORE_DEFS.slice(0, 3) : ORE_DEFS;

    const ores = [];
    for (let i = 0; i < count; i++) {
      const a   = rand() * Math.PI * 2;
      const d   = baseR * 1.05 + 60 + rand() * 400;
      const def = orePool[Math.floor(rand() * orePool.length)];
      ores.push({
        id: `${gx}_${gy}_${i}`,
        x:  cx + Math.cos(a) * d,
        y:  cy + Math.sin(a) * d,
        type: def.type,
        color: def.color,
        tip:   def.tip,
      });
    }

    return { gx, gy, cx, cy, baseR, asteroidPts, facets, craters, ores };
  }

  const exports = { buildSector, seededRand, ORE_DEFS };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
