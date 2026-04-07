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

function drawOres({ ores }, ox, oy) {
  for (const ore of ores) {
    const sx = ore.x + ox, sy = ore.y + oy;
    const s  = 10;
    const isNear    = nearDeposit && nearDeposit.id === ore.id;
    const isDepleted = depleted.has(ore.id);

    ctx.save();
    if (isDepleted) {
      ctx.globalAlpha = 0.25;
    } else if (isNear) {
      ctx.shadowColor = ore.tip;
      ctx.shadowBlur  = 16;
    } else {
      ctx.shadowColor = ore.tip;
      ctx.shadowBlur  = 6;
    }

    ctx.beginPath();
    ctx.moveTo(sx,     sy - s);
    ctx.lineTo(sx + s, sy + s * 0.6);
    ctx.lineTo(sx - s, sy + s * 0.6);
    ctx.closePath();
    ctx.fillStyle   = isDepleted ? '#444' : ore.color;
    ctx.fill();
    ctx.strokeStyle = isDepleted ? '#333' : ore.tip;
    ctx.lineWidth   = isNear ? 2 : 1;
    ctx.stroke();
    ctx.restore();

    ctx.font      = '9px monospace';
    ctx.fillStyle = isDepleted ? '#555' : ore.tip;
    ctx.textAlign = 'center';
    ctx.globalAlpha = isDepleted ? 0.4 : 1;
    ctx.fillText(isDepleted ? 'depleted' : ore.type, sx, sy + s + 12);
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

  ctx.shadowColor = isMe ? 'rgba(40,160,255,0.4)' : 'rgba(255,120,40,0.4)';
  ctx.shadowBlur  = 10;
  ctx.fillStyle   = isMe ? '#28a' : '#b52';
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-10,16); ctx.lineTo(-16,10); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-10,-16); ctx.lineTo(-16,-10); ctx.closePath(); ctx.fill();

  ctx.fillStyle   = isMe ? '#4af' : '#f84';
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(24,0); ctx.lineTo(-12,10); ctx.lineTo(-6,0); ctx.lineTo(-12,-10);
  ctx.closePath(); ctx.fill(); ctx.stroke();

  ctx.restore();
  ctx.font      = '10px monospace';
  ctx.fillStyle = isMe ? '#7cf' : '#fa8';
  ctx.textAlign = 'center';
  ctx.fillText(ship.name, sx, sy - 30);
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
