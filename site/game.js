// ── Game canvas ───────────────────────────────────────────────────────────────

const canvas = obj('#gamecanvas');
const ctx    = canvas.getContext('2d');

const C = (window.Shared && window.Shared.CONSTANTS) || {
  SECTOR_SIZE: 6000, SECTOR_GRID_W: 8, SECTOR_GRID_H: 8, BOUNDARY_WARN_DIST: 400,
};

// Sector generation shared with server
const _buildSector = (typeof buildSector !== 'undefined') ? buildSector : null;
const sectorCache  = new Map();
function getSector(gx, gy) {
  const key = `${gx}_${gy}`;
  if (!sectorCache.has(key)) sectorCache.set(key, _buildSector(gx, gy, C));
  return sectorCache.get(key);
}

// ── State ─────────────────────────────────────────────────────────────────────

let myPlayerId = null;
let gameActive = false;

const renderShips     = new Map();  // id → interpolated ship
const depleted        = new Set();  // deposit IDs that are exhausted
let   myResources     = {};         // { iron: 12, carbon: 4, ... }
let   nearDeposit     = null;       // nearest mineable deposit this frame
let   lastMineTime    = 0;
const MINE_INTERVAL   = 500;        // ms between mine events while holding E
const MINE_RANGE      = 250;        // world units

// Base placements: sectorKey → [{ gx, gy, assetName, scale, rotation }]
const basePlacements  = new Map();

// Polar object cache for building rendering: 'assetName::scale' → PolarObject
const _polarCache = new Map();
function _getPlacementPolar(assetName, scale) {
  const key = `${assetName}::${scale}`;
  if (!_polarCache.has(key)) {
    const p = new PolarObject(`/assets/${assetName}`);
    p.scale  = scale;
    p.onload = () => p.show();
    _polarCache.set(key, p);
  }
  return _polarCache.get(key);
}

let buildModeActive = false;

const cam = { x: 0, y: 0 };
const CAM_LERP = 0.08;

const keys         = {};
let lastInputSent  = {};
let lastFrameTime  = 0;
const DRAG_CLIENT  = 0.986;

// ── Stars (world-space, seeded) ───────────────────────────────────────────────

const stars = [];
(function () {
  let s = 0xDEADBEEF >>> 0;
  const rand = () => {
    s = Math.imul(s ^ (s >>> 15), s | 1);
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 0xFFFFFFFF;
  };
  const W = C.SECTOR_SIZE * C.SECTOR_GRID_W;
  const H = C.SECTOR_SIZE * C.SECTOR_GRID_H;
  for (let i = 0; i < 2000; i++)
    stars.push({ x: rand() * W, y: rand() * H, r: rand() < 0.08 ? 2 : 1, a: 0.25 + rand() * 0.75 });
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

socket.on('start_game', ({ gameId, playerId }) => { initGame(playerId); });

socket.on('gameState', state => {
  for (const s of state.ships) {
    if (!renderShips.has(s.id)) {
      renderShips.set(s.id, { ...s });
      if (s.id === myPlayerId && cam.x === 0 && cam.y === 0) { cam.x = s.x; cam.y = s.y; }
    } else {
      Object.assign(renderShips.get(s.id), s);
    }
  }
  for (const id of renderShips.keys())
    if (!state.ships.find(s => s.id === id)) renderShips.delete(id);
});

socket.on('deposit:depleted', id => { depleted.add(id); });

socket.on('resources:update', bag => { myResources = bag; });

socket.on('base:state', state => {
  for (const [sk, list] of Object.entries(state)) {
    basePlacements.set(sk, list);
  }
});

socket.on('base:placed', ({ sectorKey, gx, gy, assetName, scale, rotation }) => {
  if (!basePlacements.has(sectorKey)) basePlacements.set(sectorKey, []);
  const list = basePlacements.get(sectorKey);
  if (!list.find(b => b.gx === gx && b.gy === gy))
    list.push({ gx, gy, assetName, scale, rotation });
});

socket.on('base:removed', ({ sectorKey, gx, gy }) => {
  const list = basePlacements.get(sectorKey);
  if (list) {
    const i = list.findIndex(b => b.gx === gx && b.gy === gy);
    if (i !== -1) list.splice(i, 1);
  }
});

// ── Input ─────────────────────────────────────────────────────────────────────

window.addEventListener('keydown', e => {
  if (!gameActive) return;
  keys[e.code] = true;
  const blocked = ['KeyW','KeyA','KeyS','KeyD','KeyE','Space',
                   'ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];
  if (blocked.includes(e.code)) e.preventDefault();

  if (e.code === 'KeyB') {
    if (buildModeActive) {
      buildModeActive = false;
      exitBuildMode();
    } else {
      const me = renderShips.get(myPlayerId);
      if (!me) return;
      const S  = C.SECTOR_SIZE;
      const gx = Math.floor(me.x / S), gy = Math.floor(me.y / S);
      const cx = gx * S + S / 2, cy = gy * S + S / 2;
      // Build system origin = asteroid center; pass camera relative to that
      const initialCam = { x: cam.x - cx, y: cam.y - cy, zoom: 1 };
      buildModeActive = true;
      startBuildMode(true, `${gx}_${gy}`, initialCam);
    }
  }
}, { passive: false });

window.addEventListener('keyup', e => { keys[e.code] = false; });

function buildInput() {
  if (buildModeActive) return {};
  return {
    thrust:    !!(keys['KeyW'] || keys['ArrowUp']),
    brake:     !!(keys['KeyS'] || keys['ArrowDown']),
    turnLeft:  !!(keys['KeyA'] || keys['ArrowLeft']),
    turnRight: !!(keys['KeyD'] || keys['ArrowRight']),
  };
}

function sendInputIfChanged() {
  const inp = buildInput();
  const b   = lastInputSent;
  if (inp.thrust !== b.thrust || inp.brake !== b.brake ||
      inp.turnLeft !== b.turnLeft || inp.turnRight !== b.turnRight) {
    socket.emit('playerInput', inp);
    lastInputSent = { ...inp };
  }
}

function tryMine(timestamp) {
  if (!keys['KeyE'] || !nearDeposit) return;
  if (timestamp - lastMineTime < MINE_INTERVAL) return;
  lastMineTime = timestamp;
  socket.emit('mine', nearDeposit.id);
}

// ── Render loop ───────────────────────────────────────────────────────────────

function renderLoop(timestamp) {
  if (!gameActive) return;
  requestAnimationFrame(renderLoop);

  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.05);
  lastFrameTime = timestamp;

  sendInputIfChanged();
  tryMine(timestamp);

  // Dead-reckon all ships
  for (const r of renderShips.values()) {
    r.x  += r.vx * dt;
    r.y  += r.vy * dt;
    r.vx *= Math.pow(DRAG_CLIENT, dt * 30);
    r.vy *= Math.pow(DRAG_CLIENT, dt * 30);
  }

  const me = renderShips.get(myPlayerId);
  if (me) {
    cam.x += (me.x - cam.x) * CAM_LERP;
    cam.y += (me.y - cam.y) * CAM_LERP;
    nearDeposit = findNearDeposit(me);
  }

  const W = canvas.width, H = canvas.height;
  const ox = W / 2 - cam.x, oy = H / 2 - cam.y;

  ctx.fillStyle = '#03050d';
  ctx.fillRect(0, 0, W, H);

  drawStars(ox, oy, W, H);
  drawVisibleSectors(ox, oy, W, H);
  drawSectorGrid(ox, oy, W, H);

  for (const ship of renderShips.values())
    drawShip(ship, ox, oy, ship.id === myPlayerId);

  if (me) {
    if (keys['KeyE'] && nearDeposit) drawMiningLaser(me, nearDeposit, ox, oy);
    if (nearDeposit) drawMinePrompt(nearDeposit, ox, oy);
    drawBoundaryWarning(me);
    drawHUD(me);
  }
}

// ── Mining helpers ────────────────────────────────────────────────────────────

function findNearDeposit(ship) {
  const S  = C.SECTOR_SIZE;
  const gx = Math.floor(ship.x / S), gy = Math.floor(ship.y / S);
  if (!_buildSector) return null;
  const sec = getSector(gx, gy);
  let best = null, bestDist = MINE_RANGE;
  for (const ore of sec.ores) {
    if (depleted.has(ore.id)) continue;
    const dx = ship.x - ore.x, dy = ship.y - ore.y;
    const d  = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) { bestDist = d; best = ore; }
  }
  return best;
}

function drawMiningLaser(ship, ore, ox, oy) {
  const sx    = ship.x + ox, sy = ship.y + oy;
  const ex    = ore.x  + ox, ey = ore.y  + oy;
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 80);

  ctx.save();

  // Outer glow beam
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = ore.tip;
  ctx.lineWidth   = 2 + pulse * 1.5;
  ctx.shadowColor = ore.tip;
  ctx.shadowBlur  = 12 + pulse * 10;
  ctx.globalAlpha = 0.55 + pulse * 0.25;
  ctx.stroke();

  // Bright inner core
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(ex, ey);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 0.6;
  ctx.shadowBlur  = 4;
  ctx.globalAlpha = 0.7 + pulse * 0.3;
  ctx.stroke();

  // Impact spark at the ore end
  ctx.beginPath();
  ctx.arc(ex, ey, 3 + pulse * 2, 0, Math.PI * 2);
  ctx.fillStyle   = ore.tip;
  ctx.shadowColor = ore.tip;
  ctx.shadowBlur  = 18 + pulse * 12;
  ctx.globalAlpha = 0.8 + pulse * 0.2;
  ctx.fill();

  ctx.restore();
}

function drawMinePrompt(ore, ox, oy) {
  const sx = ore.x + ox, sy = ore.y + oy;
  ctx.save();
  ctx.font      = 'bold 11px monospace';
  ctx.textAlign = 'center';
  // Pulsing alpha
  const pulse = 0.65 + 0.35 * Math.sin(Date.now() / 300);
  ctx.globalAlpha = pulse;
  ctx.fillStyle   = ore.tip || '#fff';
  ctx.fillText(`E  — mine ${ore.type}`, sx, sy - 22);
  ctx.globalAlpha = 1;
  ctx.restore();
}

// ── Scene drawing ─────────────────────────────────────────────────────────────

function drawStars(ox, oy, W, H) {
  ctx.save();
  for (const s of stars) {
    const sx = s.x + ox, sy = s.y + oy;
    if (sx < -2 || sx > W + 2 || sy < -2 || sy > H + 2) continue;
    ctx.globalAlpha = s.a;
    ctx.fillStyle   = '#ffffff';
    ctx.fillRect(sx - s.r, sy - s.r, s.r * 2, s.r * 2);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawVisibleSectors(ox, oy, W, H) {
  if (!_buildSector) return;
  const S = C.SECTOR_SIZE;
  const gxMin = Math.max(0, Math.floor(-ox / S));
  const gyMin = Math.max(0, Math.floor(-oy / S));
  const gxMax = Math.min(C.SECTOR_GRID_W - 1, Math.floor((W - ox) / S));
  const gyMax = Math.min(C.SECTOR_GRID_H - 1, Math.floor((H - oy) / S));

  for (let gy = gyMin; gy <= gyMax; gy++) {
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const sec = getSector(gx, gy);
      drawAsteroid(sec, ox, oy);
      drawOres(sec, ox, oy);
      drawBasePlacements(gx, gy, ox, oy);
    }
  }
}

// ── Asteroid ──────────────────────────────────────────────────────────────────

function polyPath(pts, cx, cy) {
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

  const grd = ctx.createRadialGradient(sx, sy, baseR * 0.6, sx, sy, baseR * 1.4);
  grd.addColorStop(0, 'rgba(60,52,44,0.14)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(sx, sy, baseR * 1.4, 0, Math.PI * 2); ctx.fill();

  polyPath(asteroidPts, sx, sy);
  ctx.fillStyle   = '#1e1b17';
  ctx.fill();
  ctx.strokeStyle = '#5a5040';
  ctx.lineWidth   = 2.5;
  ctx.stroke();

  ctx.lineWidth = 1;
  for (const f of facets) {
    const fx = f.ox + ox, fy = f.oy + oy;
    ctx.beginPath();
    ctx.moveTo(fx + Math.cos(f.pts[0].a) * f.pts[0].r, fy + Math.sin(f.pts[0].a) * f.pts[0].r);
    for (const p of f.pts)
      ctx.lineTo(fx + Math.cos(p.a) * p.r, fy + Math.sin(p.a) * p.r);
    ctx.closePath();
    ctx.fillStyle   = 'rgba(80,72,58,0.55)';
    ctx.fill();
    ctx.strokeStyle = '#6a5e48';
    ctx.stroke();
  }

  for (const c of craters) {
    const cx2 = c.x + ox, cy2 = c.y + oy;
    regularPoly(c.n, cx2, cy2, c.r, c.rot);
    ctx.fillStyle   = '#141210';
    ctx.fill();
    ctx.strokeStyle = '#4a4030';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    regularPoly(c.n, cx2, cy2, c.r * 0.45, c.rot + Math.PI / c.n);
    ctx.fillStyle = 'rgba(100,88,68,0.4)';
    ctx.fill();
  }
}

// ── Ores ──────────────────────────────────────────────────────────────────────

const ORE_VEIN_ASSETS = {
  iron:              'vein1.json',
  carbon:            'vein2.json',
  helium3:           'vein3.json',
  crystal:           'vein4.json',
  titanium:          'vein5.json',
  plasma_gel:        'vein1.json',
  void_crystal:      'vein2.json',
  fusion_fragment:   'vein3.json',
  ancient_schematic: 'vein4.json',
};

const _orePolarCache = new Map();

function _getOrePolar(oreType) {
  if (_orePolarCache.has(oreType)) return _orePolarCache.get(oreType);
  const asset = ORE_VEIN_ASSETS[oreType];
  if (!asset) {
    if (!_warnedPolarKeys.has(`ore:${oreType}`)) {
      console.log(`[PolarObject] no vein asset for ore type "${oreType}"`);
      _warnedPolarKeys.add(`ore:${oreType}`);
    }
    _orePolarCache.set(oreType, null);
    return null;
  }
  const p = new PolarObject(`/assets/${asset}`);
  p.scale = 3;
  p.onload = () => p.show();
  _orePolarCache.set(oreType, p);
  return p;
}

function drawOres({ ores }, ox, oy) {
  for (const ore of ores) {
    const sx         = ore.x + ox, sy = ore.y + oy;
    const isNear     = nearDeposit && nearDeposit.id === ore.id;
    const isDepleted = depleted.has(ore.id);
    const polar      = _getOrePolar(ore.type);

    ctx.save();
    ctx.globalAlpha = isDepleted ? 0.25 : 1;
    if (!isDepleted) {
      ctx.shadowColor = ore.tip;
      ctx.shadowBlur  = isNear ? 16 : 6;
    }

    if (polar) {
      polar.x             = sx;
      polar.y             = sy;
      polar.colorOverride = isDepleted ? '#666' : ore.color;
      polar.lineWidth     = isNear ? 2.5 : 1.5;
      polar.render(ctx);
    } else {
      // Fallback rect — vein asset JSON not found for this ore type
      ctx.fillStyle = isDepleted ? '#444' : ore.color;
      ctx.fillRect(sx - 8, sy - 8, 16, 16);
    }
    ctx.restore();

    ctx.font        = '9px monospace';
    ctx.fillStyle   = isDepleted ? '#555' : ore.tip;
    ctx.textAlign   = 'center';
    ctx.globalAlpha = isDepleted ? 0.4 : 1;
    ctx.fillText(isDepleted ? 'depleted' : ore.type, sx, sy + 14);
    ctx.globalAlpha = 1;
  }
}

// ── Base placements (in-game view) ────────────────────────────────────────────

function drawBasePlacements(gx, gy, ox, oy) {
  const sectorKey = `${gx}_${gy}`;
  const list = basePlacements.get(sectorKey);
  if (!list || list.length === 0) return;

  const S  = C.SECTOR_SIZE;
  const cx = gx * S + S / 2;
  const cy = gy * S + S / 2;

  // CELL size matches build_system.js constant (80 world units)
  const CELL = 80;

  for (const b of list) {
    const scale = b.scale || 5;
    const polar = _getPlacementPolar(b.assetName, scale);
    // Center of cell: asteroid origin + (col + 0.5) * CELL
    polar.x         = cx + (b.gx + 0.5) * CELL + ox;
    polar.y         = cy + (b.gy + 0.5) * CELL + oy;
    polar.direction = b.rotation || 0;
    polar.render(ctx);
  }
}

// ── Sector grid ───────────────────────────────────────────────────────────────

function drawSectorGrid(ox, oy, W, H) {
  ctx.save();
  ctx.strokeStyle = 'rgba(60,90,140,0.15)';
  ctx.lineWidth   = 1;
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

// Cache: templateKey → PolarObject (or null when no asset defined)
const _shipPolarCache  = new Map();
const _warnedPolarKeys = new Set();

function _getShipPolar(templateKey) {
  if (_shipPolarCache.has(templateKey)) return _shipPolarCache.get(templateKey);
  const tpl = (typeof SHIP_TEMPLATES !== 'undefined')
    ? SHIP_TEMPLATES.find(t => t.key === templateKey) : null;
  if (!tpl || !tpl.asset) {
    if (!_warnedPolarKeys.has(templateKey)) {
      console.log(`[PolarObject] no asset defined for ship template "${templateKey}"`);
      _warnedPolarKeys.add(templateKey);
    }
    _shipPolarCache.set(templateKey, null);
    return null;
  }
  const p = new PolarObject(`/assets/${tpl.asset}`);
  p.scale = tpl.scale || 5;
  p.onload = () => p.show();
  _shipPolarCache.set(templateKey, p);
  return p;
}

function drawShip(ship, ox, oy, isMe) {
  const sx = ship.x + ox, sy = ship.y + oy;

  const tpl = ship.templateKey && typeof SHIP_TEMPLATES !== 'undefined'
    ? SHIP_TEMPLATES.find(t => t.key === ship.templateKey) : null;
  const S = tpl ? 1.0 + (tpl.gridW * tpl.gridH - 36) / 64 * 0.6 : 1.0;

  const polar = ship.templateKey ? _getShipPolar(ship.templateKey) : null;

  // Thruster glow (ship-local space)
  if (ship.thrusting) {
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(ship.direction);
    const gr = ctx.createRadialGradient(-22 * S, 0, 2, -22 * S, 0, 20 * S);
    gr.addColorStop(0, isMe ? 'rgba(80,200,255,0.8)' : 'rgba(255,160,60,0.8)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(-22 * S, 0, 20 * S, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.shadowColor = isMe ? 'rgba(40,160,255,0.4)' : 'rgba(255,120,40,0.4)';
  ctx.shadowBlur  = 10;

  if (polar) {
    polar.x         = sx;
    polar.y         = sy;
    // Assets face up (270°); +90 aligns nose to ship's travel direction
    polar.direction = ship.direction * (180 / Math.PI) + 90;
    polar.render(ctx);
  } else {
    // Fallback rect — asset JSON not found for this template
    ctx.translate(sx, sy);
    ctx.rotate(ship.direction);
    ctx.fillStyle = isMe ? '#4af' : '#f84';
    ctx.fillRect(-15 * S, -10 * S, 30 * S, 20 * S);
  }
  ctx.restore();

  // Name label
  ctx.font      = '10px monospace';
  ctx.fillStyle = isMe ? '#7cf' : '#fa8';
  ctx.textAlign = 'center';
  ctx.fillText(ship.name, sx, sy - Math.round(30 * S));
}

// ── Boundary warning ──────────────────────────────────────────────────────────

function drawBoundaryWarning(ship) {
  const S = C.SECTOR_SIZE;
  const gx = Math.floor(ship.x / S), gy = Math.floor(ship.y / S);
  const dx = Math.min(ship.x - gx * S, (gx + 1) * S - ship.x);
  const dy = Math.min(ship.y - gy * S, (gy + 1) * S - ship.y);
  const d  = Math.min(dx, dy);
  if (d >= C.BOUNDARY_WARN_DIST) return;
  const alpha = (1 - d / C.BOUNDARY_WARN_DIST) * 0.4;
  const W = canvas.width, H = canvas.height;
  const grd = ctx.createRadialGradient(W/2,H/2,H*0.3, W/2,H/2,H*0.85);
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

  // ── Ship status panel ─────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 10, 10, 210, 90, 4); ctx.fill();

  ctx.font      = 'bold 12px monospace';
  ctx.fillStyle = '#4af';
  ctx.textAlign = 'left';
  ctx.fillText(ship.name, 18, 30);

  ctx.fillStyle = '#222';
  ctx.fillRect(18, 36, 160, 7);
  ctx.fillStyle = ship.hp > 50 ? '#3f8' : ship.hp > 25 ? '#fa3' : '#f33';
  ctx.fillRect(18, 36, Math.round(160 * ship.hp / ship.maxHp), 7);
  ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
  ctx.strokeRect(18, 36, 160, 7);

  ctx.font      = '11px monospace';
  ctx.fillStyle = '#89a';
  ctx.fillText(`Sector  (${gx}, ${gy})`, 18, 58);
  ctx.fillText(`Speed   ${spd} u/s`,     18, 72);
  ctx.fillText(`Pos     ${Math.round(ship.x)}, ${Math.round(ship.y)}`, 18, 86);

  // ── Resource panel ────────────────────────────────────────────────────────
  const entries  = Object.entries(myResources).filter(([, v]) => v > 0);
  const panelH   = 18 + entries.length * 16 + 8;
  const panelY   = 108;
  ctx.fillStyle  = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 10, panelY, 210, panelH, 4); ctx.fill();

  ctx.font      = 'bold 10px monospace';
  ctx.fillStyle = '#6af';
  ctx.fillText('CARGO', 18, panelY + 14);

  if (entries.length === 0) {
    ctx.font      = '10px monospace';
    ctx.fillStyle = '#445';
    ctx.fillText('empty', 18, panelY + 28);
  } else {
    for (let i = 0; i < entries.length; i++) {
      const [type, amount] = entries[i];
      ctx.font      = '11px monospace';
      ctx.fillStyle = '#aac';
      ctx.fillText(`${type}`, 18, panelY + 28 + i * 16);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(`${amount}`, 215, panelY + 28 + i * 16);
      ctx.textAlign = 'left';
    }
  }

  // ── Controls hint ─────────────────────────────────────────────────────────
  ctx.textAlign  = 'right';
  ctx.fillStyle  = 'rgba(120,140,180,0.55)';
  ctx.font       = '10px monospace';
  ctx.fillText('W/S — thrust/brake   A/D — rotate   E — mine   B — build', W - 12, 22);

  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y,     x + w, y + r,     r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x,     y + h, x,     y + h - r, r);
  ctx.lineTo(x,     y + r); ctx.arcTo(x,     y,     x + r, y,         r);
  ctx.closePath();
}
