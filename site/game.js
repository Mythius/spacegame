// ── Game canvas ───────────────────────────────────────────────────────────────

const canvas = obj('#gamecanvas');
const ctx    = canvas.getContext('2d');

const C = (window.Shared && window.Shared.CONSTANTS) || {
  SECTOR_SIZE: 6000, SECTOR_GRID_W: 8, SECTOR_GRID_H: 8,
  BOUNDARY_WARN_DIST: 400,
};

// ── State ─────────────────────────────────────────────────────────────────────

let myPlayerId = null;
let gameActive = false;

// Last authoritative state from server
let serverState = { t: 0, ships: [] };
// Per-ship smoothed render positions (dead-reckoning + lerp)
const renderShips = new Map(); // id → { x, y, direction, ... }

const cam = { x: 0, y: 0 };
const CAM_LERP = 0.08;

const keys = {};
let lastInputSent = {};

// ── Seeded world generation ───────────────────────────────────────────────────
// Each sector gets a deterministic asteroid + ore layout based on (gx, gy).

const sectorCache = new Map();

function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
}

const ORE_DEFS = [
  { type: 'iron',       color: '#c9855a', tip: '#e8a070' },
  { type: 'carbon',     color: '#767676', tip: '#aaaaaa' },
  { type: 'helium3',    color: '#5aaa60', tip: '#8fff90' },
  { type: 'crystal',    color: '#3a9ccc', tip: '#8de8ff' },
  { type: 'titanium',   color: '#aaaacc', tip: '#ffffff' },
  { type: 'plasma_gel', color: '#cc6622', tip: '#ff9940' },
];

function buildSector(gx, gy) {
  const key = `${gx}_${gy}`;
  if (sectorCache.has(key)) return sectorCache.get(key);

  const rand = seededRand(gx * 73856093 ^ gy * 19349663);
  const S  = C.SECTOR_SIZE;
  const cx = gx * S + S / 2;
  const cy = gy * S + S / 2;

  // ── Main asteroid body — hard-edged polygon ──────────────────────────────
  // Use fewer, more irregular vertices with sharp angle jumps for a chiseled look
  const N    = 9 + Math.floor(rand() * 4);   // 9–12 sides
  const baseR = 380 + rand() * 220;
  const asteroidPts = [];
  // Sort random angles so polygon is convex-ish but still jagged
  const angles = [];
  for (let i = 0; i < N; i++) angles.push(rand() * Math.PI * 2);
  angles.sort((a, b) => a - b);
  for (const a of angles) {
    const r = baseR * (0.45 + rand() * 0.55);   // wide variance → spiky silhouette
    asteroidPts.push({ a, r });
  }

  // ── Inner facets — smaller polygons inside for surface detail ────────────
  const facets = [];
  for (let i = 0; i < 5; i++) {
    const fa    = rand() * Math.PI * 2;
    const fd    = baseR * (0.15 + rand() * 0.45);
    const fVerts = 3 + Math.floor(rand() * 3);   // triangles to pentagons
    const fR    = 40 + rand() * 90;
    const pts   = [];
    for (let j = 0; j < fVerts; j++) {
      const a = (j / fVerts) * Math.PI * 2 + rand() * 0.6;
      pts.push({ a, r: fR * (0.5 + rand() * 0.5) });
    }
    facets.push({ ox: cx + Math.cos(fa) * fd, oy: cy + Math.sin(fa) * fd, pts });
  }

  // ── Crater rings — flat hexagons / pentagons ──────────────────────────────
  const craters = [];
  for (let i = 0; i < 4; i++) {
    const ca  = rand() * Math.PI * 2;
    const cd  = baseR * (0.2 + rand() * 0.55);
    const cr  = 18 + rand() * 45;
    const cn  = 5 + Math.floor(rand() * 3);      // 5–7 sides
    craters.push({
      x: cx + Math.cos(ca) * cd,
      y: cy + Math.sin(ca) * cd,
      r: cr, n: cn,
      rot: rand() * Math.PI * 2,
    });
  }

  // ── Ore deposits ─────────────────────────────────────────────────────────
  const ores = [];
  const count = 4 + Math.floor(rand() * 5);
  const isHome = (gx === Math.floor(C.SECTOR_GRID_W / 2) && gy === Math.floor(C.SECTOR_GRID_H / 2));
  const orePool = isHome ? ORE_DEFS.slice(0, 3) : ORE_DEFS;

  for (let i = 0; i < count; i++) {
    const a   = rand() * Math.PI * 2;
    const d   = baseR * 1.1 + 40 + rand() * 350;
    const def = orePool[Math.floor(rand() * orePool.length)];
    ores.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, ...def });
  }

  const sector = { cx, cy, baseR, asteroidPts, facets, craters, ores };
  sectorCache.set(key, sector);
  return sector;
}

// ── Stars (world-space, generated once) ──────────────────────────────────────

const stars = [];
(function () {
  const rand = seededRand(0xDEADBEEF);
  const W = C.SECTOR_SIZE * C.SECTOR_GRID_W;
  const H = C.SECTOR_SIZE * C.SECTOR_GRID_H;
  for (let i = 0; i < 2000; i++) {
    stars.push({
      x: rand() * W, y: rand() * H,
      r: rand() < 0.08 ? 2 : 1,
      a: 0.25 + rand() * 0.75,
    });
  }
})();

// ── Init ──────────────────────────────────────────────────────────────────────

function initGame(playerId) {
  myPlayerId = playerId;
  gameActive = true;
  resizeCanvas();
  requestAnimationFrame(ts => { lastFrameTime = ts; requestAnimationFrame(renderLoop); });
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', () => { if (gameActive) resizeCanvas(); });

// ── Socket ────────────────────────────────────────────────────────────────────

socket.on('start_game', ({ gameId, playerId }) => {
  initGame(playerId);
});

socket.on('gameState', state => {
  serverState = state;

  // Merge into renderShips — snap new ships, correct existing ones
  for (const s of state.ships) {
    if (!renderShips.has(s.id)) {
      // First time seeing this ship — snap immediately
      renderShips.set(s.id, { ...s });
      if (s.id === myPlayerId && cam.x === 0 && cam.y === 0) {
        cam.x = s.x; cam.y = s.y;
      }
    } else {
      // Snap position — we'll dead-reckon forward each frame
      const r = renderShips.get(s.id);
      Object.assign(r, s);
    }
  }
  // Remove ships that left
  for (const id of renderShips.keys()) {
    if (!state.ships.find(s => s.id === id)) renderShips.delete(id);
  }
});

// ── Input ─────────────────────────────────────────────────────────────────────

window.addEventListener('keydown', e => {
  if (!gameActive) return;
  keys[e.code] = true;
  if (['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
    e.preventDefault();
}, { passive: false });

window.addEventListener('keyup', e => { keys[e.code] = false; });

function buildInput() {
  return {
    thrust:    !!(keys['KeyW'] || keys['ArrowUp']),
    brake:     !!(keys['KeyS'] || keys['ArrowDown']),
    turnLeft:  !!(keys['KeyA'] || keys['ArrowLeft']),
    turnRight: !!(keys['KeyD'] || keys['ArrowRight']),
    fire:      !!(keys['Space']),
  };
}

function sendInputIfChanged() {
  const inp = buildInput();
  const a = inp, b = lastInputSent;
  if (a.thrust !== b.thrust || a.brake !== b.brake ||
      a.turnLeft !== b.turnLeft || a.turnRight !== b.turnRight || a.fire !== b.fire) {
    socket.emit('playerInput', inp);
    lastInputSent = { ...inp };
  }
}

// ── Render loop ───────────────────────────────────────────────────────────────

const DRAG_CLIENT = 0.986;
let lastFrameTime = 0;

function renderLoop(timestamp) {
  if (!gameActive) return;
  requestAnimationFrame(renderLoop);
  sendInputIfChanged();

  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
  lastFrameTime = timestamp;

  // Dead-reckon every ship forward by one frame using its velocity
  for (const r of renderShips.values()) {
    r.x  += r.vx * dt;
    r.y  += r.vy * dt;
    // Mirror server drag so positions stay in sync
    r.vx *= Math.pow(DRAG_CLIENT, dt * 30);
    r.vy *= Math.pow(DRAG_CLIENT, dt * 30);
  }

  // Camera tracks own ship's render position (already moving smoothly)
  const me = renderShips.get(myPlayerId);
  if (me) {
    cam.x += (me.x - cam.x) * CAM_LERP;
    cam.y += (me.y - cam.y) * CAM_LERP;
  }

  const W = canvas.width, H = canvas.height;
  const ox = W / 2 - cam.x;
  const oy = H / 2 - cam.y;

  ctx.fillStyle = '#03050d';
  ctx.fillRect(0, 0, W, H);

  drawStars(ox, oy, W, H);
  drawVisibleSectors(ox, oy, W, H);
  drawSectorGrid(ox, oy, W, H);

  for (const ship of renderShips.values())
    drawShip(ship, ox, oy, ship.id === myPlayerId);

  if (me) {
    drawBoundaryWarning(me);
    drawHUD(me);
  }
}

// ── Scene drawing ─────────────────────────────────────────────────────────────

function drawStars(ox, oy, W, H) {
  ctx.save();
  for (const s of stars) {
    const sx = s.x + ox, sy = s.y + oy;
    if (sx < -2 || sx > W + 2 || sy < -2 || sy > H + 2) continue;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(sx - s.r, sy - s.r, s.r * 2, s.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawVisibleSectors(ox, oy, W, H) {
  const S = C.SECTOR_SIZE;
  // Which sectors are on screen?
  const gxMin = Math.max(0, Math.floor(-ox / S));
  const gyMin = Math.max(0, Math.floor(-oy / S));
  const gxMax = Math.min(C.SECTOR_GRID_W - 1, Math.floor((W - ox) / S));
  const gyMax = Math.min(C.SECTOR_GRID_H - 1, Math.floor((H - oy) / S));

  for (let gy = gyMin; gy <= gyMax; gy++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const sec = buildSector(gx, gy);
      drawAsteroid(sec, ox, oy);
      drawOres(sec, ox, oy);
    }
  }
}

function polyPath(pts, cx, cy) {
  // pts = [{a, r}], draws a closed polygon centered at cx,cy
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(pts[0].a) * pts[0].r, cy + Math.sin(pts[0].a) * pts[0].r);
  for (let i = 1; i < pts.length; i++)
    ctx.lineTo(cx + Math.cos(pts[i].a) * pts[i].r, cy + Math.sin(pts[i].a) * pts[i].r);
  ctx.closePath();
}

function regularPoly(n, cx, cy, r, rot) {
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2 + rot;
    i === 0 ? ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r)
            : ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawAsteroid({ cx, cy, baseR, asteroidPts, facets, craters }, ox, oy) {
  const sx = cx + ox, sy = cy + oy;

  // Outer dust halo
  const grd = ctx.createRadialGradient(sx, sy, baseR * 0.6, sx, sy, baseR * 1.4);
  grd.addColorStop(0, 'rgba(60,52,44,0.14)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(sx, sy, baseR * 1.4, 0, Math.PI * 2); ctx.fill();

  // Main body — hard polygon
  polyPath(asteroidPts, sx, sy);
  ctx.fillStyle = '#1e1b17';
  ctx.fill();
  ctx.strokeStyle = '#5a5040';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Inner facets — lighter polygon patches for geometric surface detail
  ctx.lineWidth = 1;
  for (const f of facets) {
    const fx = f.ox + ox, fy = f.oy + oy;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(f.pts[0].a) * f.pts[0].r, fy + Math.sin(f.pts[0].a) * f.pts[0].r);
    for (const p of f.pts)
      ctx.lineTo(fx + Math.cos(p.a) * p.r, fy + Math.sin(p.a) * p.r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(80,72,58,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#6a5e48';
    ctx.stroke();
  }

  // Craters — regular polygons (hexagonal/pentagonal rings)
  for (const c of craters) {
    const cx2 = c.x + ox, cy2 = c.y + oy;
    // Outer ring
    regularPoly(c.n, cx2, cy2, c.r, c.rot);
    ctx.fillStyle = '#141210';
    ctx.fill();
    ctx.strokeStyle = '#4a4030';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Inner highlight
    regularPoly(c.n, cx2, cy2, c.r * 0.45, c.rot + Math.PI / c.n);
    ctx.fillStyle = 'rgba(100,88,68,0.4)';
    ctx.fill();
  }
}

function drawOres({ ores }, ox, oy) {
  for (const ore of ores) {
    const sx = ore.x + ox, sy = ore.y + oy;
    const s = 10; // triangle half-size

    ctx.save();
    ctx.shadowColor = ore.tip;
    ctx.shadowBlur  = 8;

    ctx.beginPath();
    ctx.moveTo(sx,     sy - s);       // top
    ctx.lineTo(sx + s, sy + s * 0.6); // bottom-right
    ctx.lineTo(sx - s, sy + s * 0.6); // bottom-left
    ctx.closePath();
    ctx.fillStyle = ore.color;
    ctx.fill();
    ctx.strokeStyle = ore.tip;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.restore();

    // Label at close zoom (placeholder — always shown for now)
    ctx.font = '9px monospace';
    ctx.fillStyle = ore.tip;
    ctx.textAlign = 'center';
    ctx.fillText(ore.type, sx, sy + s + 12);
  }
}

function drawSectorGrid(ox, oy, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(60,90,140,0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 10]);

  const S = C.SECTOR_SIZE;
  for (let gx = 0; gx <= C.SECTOR_GRID_W; gx++) {
    const sx = gx * S + ox;
    if (sx < 0 || sx > W) continue;
    ctx.beginPath(); ctx.moveTo(sx, oy); ctx.lineTo(sx, C.SECTOR_GRID_H * S + oy); ctx.stroke();
  }
  for (let gy = 0; gy <= C.SECTOR_GRID_H; gy++) {
    const sy = gy * S + oy;
    if (sy < 0 || sy > H) continue;
    ctx.beginPath(); ctx.moveTo(ox, sy); ctx.lineTo(C.SECTOR_GRID_W * S + ox, sy); ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

// ── Ship ──────────────────────────────────────────────────────────────────────

function drawShip(ship, ox, oy, isMe) {
  const sx = ship.x + ox, sy = ship.y + oy;

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ship.direction);

  if (ship.thrusting) {
    const grd = ctx.createRadialGradient(-22, 0, 2, -22, 0, 20);
    grd.addColorStop(0, isMe ? 'rgba(80,200,255,0.8)' : 'rgba(255,160,60,0.8)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(-22, 0, 20, 0, Math.PI * 2); ctx.fill();
  }

  const bodyCol = isMe ? '#4af' : '#f84';
  const wingCol = isMe ? '#28a' : '#b52';
  const glow    = isMe ? 'rgba(40,160,255,0.4)' : 'rgba(255,120,40,0.4)';

  ctx.shadowColor = glow;
  ctx.shadowBlur  = 10;

  // Wings
  ctx.fillStyle = wingCol;
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-10,16); ctx.lineTo(-16,10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-10,-16); ctx.lineTo(-16,-10); ctx.closePath(); ctx.fill();

  // Hull
  ctx.fillStyle   = bodyCol;
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo( 24,  0);
  ctx.lineTo(-12, 10);
  ctx.lineTo( -6,  0);
  ctx.lineTo(-12,-10);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  // Name tag
  ctx.font = '10px monospace';
  ctx.fillStyle = isMe ? '#7cf' : '#fa8';
  ctx.textAlign = 'center';
  ctx.fillText(ship.name, sx, sy - 30);
}

// ── Boundary warning ──────────────────────────────────────────────────────────

function drawBoundaryWarning(ship) {
  const S  = C.SECTOR_SIZE;
  const gx = Math.floor(ship.x / S), gy = Math.floor(ship.y / S);
  const dx = Math.min(ship.x - gx * S, (gx + 1) * S - ship.x);
  const dy = Math.min(ship.y - gy * S, (gy + 1) * S - ship.y);
  const d  = Math.min(dx, dy);
  if (d >= C.BOUNDARY_WARN_DIST) return;

  const alpha = (1 - d / C.BOUNDARY_WARN_DIST) * 0.4;
  const W = canvas.width, H = canvas.height;
  const grd = ctx.createRadialGradient(W/2, H/2, H*0.3, W/2, H/2, H*0.85);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(255,50,10,${alpha})`);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, H);
}

// ── HUD ───────────────────────────────────────────────────────────────────────

function drawHUD(ship) {
  const S   = C.SECTOR_SIZE;
  const gx  = Math.floor(ship.x / S), gy = Math.floor(ship.y / S);
  const spd = Math.round(Math.sqrt(ship.vx ** 2 + ship.vy ** 2));
  const W   = canvas.width;

  ctx.save();

  // Panel
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, 10, 10, 210, 90, 4);
  ctx.fill();

  ctx.fillStyle = '#4af';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText(ship.name, 18, 30);

  // HP bar
  ctx.fillStyle = '#222';
  ctx.fillRect(18, 36, 160, 7);
  const hpColor = ship.hp > 50 ? '#3f8' : ship.hp > 25 ? '#fa3' : '#f33';
  ctx.fillStyle = hpColor;
  ctx.fillRect(18, 36, Math.round(160 * ship.hp / ship.maxHp), 7);
  ctx.strokeStyle = '#444';
  ctx.lineWidth = 1;
  ctx.strokeRect(18, 36, 160, 7);

  ctx.font = '11px monospace';
  ctx.fillStyle = '#89a';
  ctx.fillText(`Sector  (${gx}, ${gy})`, 18, 58);
  ctx.fillText(`Speed   ${spd} u/s`,     18, 72);
  ctx.fillText(`Pos     ${Math.round(ship.x)}, ${Math.round(ship.y)}`, 18, 86);

  // Controls hint
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(120,140,180,0.55)';
  ctx.font = '10px monospace';
  ctx.fillText('W/S — thrust/brake   A/D — rotate', W - 12, 22);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r);
  ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}
