// ── Constants ──────────────────────────────────────────────────────────────────
const CELL           = 80;
const BASE_CELL_SCALE = CELL / 16;   // scale so asset fits 1 cell ≈ asset diameter
const PAN_SPEED      = 5;
const ZOOM_MIN       = 0.25;
const ZOOM_MAX       = 4;
const INIT_ZOOM      = 1;

// ── Camera ────────────────────────────────────────────────────────────────────
class Camera {
	constructor() { this.x = 0; this.y = 0; this.zoom = INIT_ZOOM; }

	applyTransform(ctx, canvas) {
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.scale(this.zoom, this.zoom);
		ctx.translate(-this.x, -this.y);
	}

	screenToWorld(sx, sy, canvas) {
		return {
			x: this.x + (sx - canvas.width  / 2) / this.zoom,
			y: this.y + (sy - canvas.height / 2) / this.zoom,
		};
	}

	pan(dx, dy) { this.x += dx; this.y += dy; }

	zoomAt(delta, sx, sy, canvas) {
		const before = this.screenToWorld(sx, sy, canvas);
		this.zoom    = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * (1 + delta)));
		const after  = this.screenToWorld(sx, sy, canvas);
		this.x      += before.x - after.x;
		this.y      += before.y - after.y;
	}
}

// ── PlacedBuilding ────────────────────────────────────────────────────────────
class PlacedBuilding {
	constructor(buildingId, originGx, originGy, building, rotation = 0) {
		this.buildingId = buildingId;
		this.originGx   = originGx;
		this.originGy   = originGy;
		this.rotation   = rotation;

		// At 90° or 270° the footprint is transposed
		const swapped = (rotation === 90 || rotation === 270);
		this.gridW    = swapped ? building.gridH : building.gridW;
		this.gridH    = swapped ? building.gridW : building.gridH;

		const scale = Math.max(building.gridW, building.gridH) * BASE_CELL_SCALE;
		this.polar           = new PolarObject(`/assets/${building.asset}`);
		this.polar.scale     = scale;
		this.polar.direction = rotation;
		this.polar.lineWidth = building.lineWidth || 2;
		this.polar.onload    = () => this.polar.show();
	}

	render(ctx) {
		this.polar.x = (this.originGx + this.gridW / 2) * CELL;
		this.polar.y = (this.originGy + this.gridH / 2) * CELL;
		this.polar.render(ctx);
	}
}

// ── BuildSystem ───────────────────────────────────────────────────────────────
class BuildSystem {
	constructor(canvas, sectorKey, initialCam) {
		this.canvas    = canvas;
		this.ctx       = canvas.getContext('2d');
		this.camera    = new Camera();
		this.sectorKey = sectorKey || null;

		// placed:    origin-key → PlacedBuilding
		// occupancy: any-cell-key → origin-key  (fast collision lookup)
		this.placed    = new Map();
		this.occupancy = new Map();

		this.selectedBuildingId = null;
		this.preview            = null;
		this.hoverCell          = { gx: 0, gy: 0 };
		this.mouseScreen        = { x: 0, y: 0 };
		this.keys               = {};
		this.rotation           = 0;       // current placement rotation: 0, 90, 180, 270
		this.active             = true;
		this.interactive        = false;   // set true by setInteractive() in startBuildMode
		this.validCells         = null;

		if (initialCam) {
			this.camera.x    = initialCam.x;
			this.camera.y    = initialCam.y;
			this.camera.zoom = initialCam.zoom || 1;
		}

		this._sector = null;
		if (sectorKey && typeof buildSector !== 'undefined') {
			const _C = (window.Shared && window.Shared.CONSTANTS) ||
			           { SECTOR_SIZE: 6000, SECTOR_GRID_W: 8, SECTOR_GRID_H: 8 };
			const [gx, gy] = sectorKey.split('_').map(Number);
			this._sector    = buildSector(gx, gy, _C);
			this.validCells = this._computeValidCells(this._sector);
		}

		this._bindEvents();
		this._buildPalette();
		this._loop();
	}

	// ── Asteroid rendering ───────────────────────────────────────────────────

	_drawAsteroid(ctx) {
		const s = this._sector;
		if (!s) return;

		// Asteroid polygon verts are stored as { a, r } polar, centered at (cx,cy)
		// in world coords. In build-mode canvas (0,0) = asteroid center.
		const toLocal = p => ({ x: Math.cos(p.a) * p.r, y: Math.sin(p.a) * p.r });
		const verts = s.asteroidPts.map(toLocal);

		// ── Body fill ────────────────────────────────────────────────────────
		ctx.beginPath();
		ctx.moveTo(verts[0].x, verts[0].y);
		for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
		ctx.closePath();
		ctx.fillStyle   = '#1a1410';
		ctx.fill();
		ctx.strokeStyle = '#3a2e22';
		ctx.lineWidth   = 3;
		ctx.stroke();

		// ── Facets ───────────────────────────────────────────────────────────
		ctx.strokeStyle = '#2a2018';
		ctx.lineWidth   = 1.5;
		for (const f of s.facets) {
			// facet origin is in absolute world coords → subtract asteroid center
			const ox = f.ox - s.cx, oy = f.oy - s.cy;
			ctx.beginPath();
			const last = f.pts[f.pts.length - 1];
			ctx.moveTo(ox + Math.cos(last.a) * last.r, oy + Math.sin(last.a) * last.r);
			for (const pt of f.pts)
				ctx.lineTo(ox + Math.cos(pt.a) * pt.r, oy + Math.sin(pt.a) * pt.r);
			ctx.closePath();
			ctx.stroke();
		}

		// ── Craters ──────────────────────────────────────────────────────────
		ctx.strokeStyle = '#2e2416';
		ctx.lineWidth   = 1.5;
		for (const c of s.craters) {
			const cx = c.x - s.cx, cy = c.y - s.cy;
			ctx.beginPath();
			for (let i = 0; i <= c.n; i++) {
				const a   = c.rot + (i / c.n) * Math.PI * 2;
				const r   = c.r * (i % 2 === 0 ? 1 : 0.7);
				const x   = cx + Math.cos(a) * r;
				const y   = cy + Math.sin(a) * r;
				i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.stroke();
			// Inner ring
			ctx.beginPath();
			ctx.arc(cx, cy, c.r * 0.35, 0, Math.PI * 2);
			ctx.strokeStyle = '#201c14';
			ctx.stroke();
			ctx.strokeStyle = '#2e2416';
		}

		// ── Ore deposits (snapped to grid cell centers) ───────────────────
		for (const ore of s.ores) {
			// Snap to nearest cell center: floor(coord/CELL)*CELL + CELL/2
			const ox = Math.floor((ore.x - s.cx) / CELL) * CELL + CELL / 2;
			const oy = Math.floor((ore.y - s.cy) / CELL) * CELL + CELL / 2;

			// Glow
			const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, 60);
			grad.addColorStop(0, ore.color + '55');
			grad.addColorStop(1, ore.color + '00');
			ctx.fillStyle = grad;
			ctx.beginPath();
			ctx.arc(ox, oy, 60, 0, Math.PI * 2);
			ctx.fill();

			// Core cluster (3 small circles)
			for (let i = 0; i < 3; i++) {
				const a = (i / 3) * Math.PI * 2;
				const dx = Math.cos(a) * 14, dy = Math.sin(a) * 14;
				ctx.beginPath();
				ctx.arc(ox + dx, oy + dy, 10, 0, Math.PI * 2);
				ctx.fillStyle   = ore.color + 'cc';
				ctx.strokeStyle = ore.tip;
				ctx.lineWidth   = 1;
				ctx.fill();
				ctx.stroke();
			}
			// Center dot
			ctx.beginPath();
			ctx.arc(ox, oy, 6, 0, Math.PI * 2);
			ctx.fillStyle = ore.tip;
			ctx.fill();

			// Label (only in active build mode)
			if (this.interactive) {
				ctx.fillStyle    = ore.tip + 'cc';
				ctx.font         = '10px monospace';
				ctx.textAlign    = 'center';
				ctx.textBaseline = 'top';
				ctx.fillText(ore.type, ox, oy + 20);
			}
		}
	}

	// ── Valid-cell helpers ────────────────────────────────────────────────────

	_pointInPoly(px, py, verts) {
		let inside = false;
		for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
			const xi = verts[i].x, yi = verts[i].y;
			const xj = verts[j].x, yj = verts[j].y;
			if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
				inside = !inside;
		}
		return inside;
	}

	_computeValidCells({ asteroidPts, baseR }) {
		const verts = asteroidPts.map(p => ({
			x: Math.cos(p.a) * p.r,
			y: Math.sin(p.a) * p.r,
		}));
		const cells = new Set();
		const r = Math.ceil(baseR / CELL) + 1;
		for (let cy = -r; cy <= r; cy++)
			for (let cx = -r; cx <= r; cx++)
				// Test cell center (+ CELL/2) so cells touching the edge aren't falsely included
			if (this._pointInPoly((cx + 0.5) * CELL, (cy + 0.5) * CELL, verts))
					cells.add(`${cx},${cy}`);
		return cells;
	}

	_canPlace(gx, gy, gridW, gridH) {
		for (let dy = 0; dy < gridH; dy++)
			for (let dx = 0; dx < gridW; dx++) {
				const key = `${gx + dx},${gy + dy}`;
				if (this.validCells && !this.validCells.has(key)) return false;
				if (this.occupancy.has(key)) return false;
			}
		return true;
	}

	// ── Palette ───────────────────────────────────────────────────────────────

	_buildPalette() {
		const palette = document.querySelector('#build-palette');
		if (!palette) return;
		palette.innerHTML = '';

		const reg = (typeof BUILDING_REGISTRY !== 'undefined') ? BUILDING_REGISTRY : {};

		for (const [id, bld] of Object.entries(reg)) {
			const card = document.createElement('div');
			card.className  = 'building-card';
			card.dataset.id = id;

			const costHtml = Object.entries(bld.cost || {})
				.map(([t, v]) => `<span class="bcard-res">${v} ${t}</span>`)
				.join('');

			card.innerHTML = `
				<div class="bcard-name">${bld.name}</div>
				<div class="bcard-meta">${bld.gridW}×${bld.gridH} &nbsp;·&nbsp; ${bld.hp} HP</div>
				<div class="bcard-cost">${costHtml || '<span class="bcard-res">free</span>'}</div>
				${bld.description ? `<div class="bcard-desc">${bld.description}</div>` : ''}
			`;
			card.addEventListener('click', () => this.selectBuilding(id));
			palette.appendChild(card);
		}
	}

	selectBuilding(id) {
		const reg = (typeof BUILDING_REGISTRY !== 'undefined') ? BUILDING_REGISTRY : {};
		const bld = reg[id];
		if (!bld) return;

		this.selectedBuildingId = id;
		document.querySelectorAll('.building-card').forEach(c =>
			c.classList.toggle('selected', c.dataset.id === id)
		);

		this.rotation = 0;
		const scale = Math.max(bld.gridW, bld.gridH) * BASE_CELL_SCALE;
		this.preview           = new PolarObject(`/assets/${bld.asset}`);
		this.preview.scale     = scale;
		this.preview.direction = this.rotation;
		this.preview.lineWidth = bld.lineWidth || 2;
		this.preview.onload    = () => this.preview.show();
	}

	deselect() {
		this.selectedBuildingId = null;
		this.preview = null;
		document.querySelectorAll('.building-card').forEach(c => c.classList.remove('selected'));
	}

	// ── Events ────────────────────────────────────────────────────────────────

	_bindEvents() {
		document.addEventListener('keydown', e => {
			if (!this.active) return;
			this.keys[e.key.toLowerCase()] = true;
			if (e.key === 'Escape') this.deselect();
			if (e.key.toLowerCase() === 'r' && !e.repeat && this.selectedBuildingId) {
				this.rotation = (this.rotation + 45) % 360;
				if (this.preview) this.preview.direction = this.rotation;
			}
		});
		document.addEventListener('keyup', e => {
			this.keys[e.key.toLowerCase()] = false;
		});

		this.canvas.addEventListener('mousemove', e => {
			const r = this.canvas.getBoundingClientRect();
			this.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top };
			const w = this.camera.screenToWorld(this.mouseScreen.x, this.mouseScreen.y, this.canvas);
			this.hoverCell = {
				gx: Math.floor(w.x / CELL),
				gy: Math.floor(w.y / CELL),
			};
		});

		this.canvas.addEventListener('click', () => {
			if (!this.interactive || !this.selectedBuildingId) return;
			const reg = (typeof BUILDING_REGISTRY !== 'undefined') ? BUILDING_REGISTRY : {};
			const bld = reg[this.selectedBuildingId];
			if (!bld) return;

			const { gx, gy } = this.hoverCell;
			// Effective footprint respects rotation
			const swapped = (this.rotation === 90 || this.rotation === 270);
			const eW = swapped ? bld.gridH : bld.gridW;
			const eH = swapped ? bld.gridW : bld.gridH;
			if (!this._canPlace(gx, gy, eW, eH)) return;

			const originKey = `${gx},${gy}`;
			const obj = new PlacedBuilding(this.selectedBuildingId, gx, gy, bld, this.rotation);
			this.placed.set(originKey, obj);
			for (let dy = 0; dy < eH; dy++)
				for (let dx = 0; dx < eW; dx++)
					this.occupancy.set(`${gx + dx},${gy + dy}`, originKey);

			if (this.sectorKey && typeof socket !== 'undefined') {
				socket.emit('base:place', {
					sectorKey:  this.sectorKey,
					gx, gy,
					assetName:  bld.asset,
					scale:      Math.max(bld.gridW, bld.gridH) * BASE_CELL_SCALE,
					rotation:   this.rotation,
					buildingId: this.selectedBuildingId,
				});
			}
		});

		this.canvas.addEventListener('contextmenu', e => {
			e.preventDefault();
			if (!this.interactive) return;
			const cellKey   = `${this.hoverCell.gx},${this.hoverCell.gy}`;
			const originKey = this.occupancy.get(cellKey);
			if (!originKey) return;

			const obj = this.placed.get(originKey);
			if (!obj) return;

			for (let dy = 0; dy < obj.gridH; dy++)
				for (let dx = 0; dx < obj.gridW; dx++)
					this.occupancy.delete(`${obj.originGx + dx},${obj.originGy + dy}`);
			this.placed.delete(originKey);

			if (this.sectorKey && typeof socket !== 'undefined') {
				socket.emit('base:remove', {
					sectorKey: this.sectorKey,
					gx: obj.originGx, gy: obj.originGy,
				});
			}
		});

		this.canvas.addEventListener('wheel', e => {
			e.preventDefault();
			if (!this.interactive) return;
			this.camera.zoomAt(
				e.deltaY > 0 ? -0.1 : 0.1,
				this.mouseScreen.x, this.mouseScreen.y, this.canvas
			);
		}, { passive: false });
	}

	// ── Update / Render ───────────────────────────────────────────────────────

	_update() {
		if (!this.interactive) return;
		const spd = PAN_SPEED / this.camera.zoom;
		if (this.keys['w'] || this.keys['arrowup'])    this.camera.pan(0, -spd);
		if (this.keys['s'] || this.keys['arrowdown'])  this.camera.pan(0,  spd);
		if (this.keys['a'] || this.keys['arrowleft'])  this.camera.pan(-spd, 0);
		if (this.keys['d'] || this.keys['arrowright']) this.camera.pan( spd, 0);
	}

	setInteractive(on) {
		this.interactive              = on;
		this.canvas.style.pointerEvents = on ? '' : 'none';
		if (!on) this.deselect();
	}

	_drawGrid(ctx) {
		const tl = this.camera.screenToWorld(0, 0, this.canvas);
		const br = this.camera.screenToWorld(this.canvas.width, this.canvas.height, this.canvas);
		const x0 = Math.floor(tl.x / CELL) - 1, y0 = Math.floor(tl.y / CELL) - 1;
		const x1 = Math.ceil (br.x / CELL) + 1, y1 = Math.ceil (br.y / CELL) + 1;

		// Tint valid (on-asteroid) cells
		if (this.validCells) {
			ctx.fillStyle = 'rgba(80,160,100,0.10)';
			for (const key of this.validCells) {
				const [cx, cy] = key.split(',').map(Number);
				if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
				ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
			}
		}

		// Grid lines
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(255,255,255,0.13)';
		ctx.lineWidth   = 1 / this.camera.zoom;
		for (let gx = x0; gx <= x1; gx++) {
			ctx.moveTo(gx * CELL, y0 * CELL); ctx.lineTo(gx * CELL, y1 * CELL);
		}
		for (let gy = y0; gy <= y1; gy++) {
			ctx.moveTo(x0 * CELL, gy * CELL); ctx.lineTo(x1 * CELL, gy * CELL);
		}
		ctx.stroke();
	}

	_drawHoverCell(ctx) {
		if (!this.selectedBuildingId) return;
		const reg = (typeof BUILDING_REGISTRY !== 'undefined') ? BUILDING_REGISTRY : {};
		const bld = reg[this.selectedBuildingId];
		if (!bld) return;

		// Effective footprint accounts for 90°/270° transpose
		const swapped = (this.rotation === 90 || this.rotation === 270);
		const eW = swapped ? bld.gridH : bld.gridW;
		const eH = swapped ? bld.gridW : bld.gridH;

		const { gx, gy } = this.hoverCell;
		const canPlace   = this._canPlace(gx, gy, eW, eH);
		const x0 = gx * CELL, y0 = gy * CELL;
		const w  = eW * CELL, h  = eH * CELL;

		ctx.fillStyle   = canPlace ? 'rgba(80,255,120,0.15)' : 'rgba(255,60,60,0.15)';
		ctx.strokeStyle = canPlace ? 'rgba(80,255,120,0.6)'  : 'rgba(255,80,80,0.5)';
		ctx.lineWidth   = 1.5 / this.camera.zoom;
		ctx.fillRect(x0, y0, w, h);
		ctx.strokeRect(x0, y0, w, h);

		if (this.preview && canPlace) {
			ctx.save();
			ctx.globalAlpha = 0.5;
			this.preview.direction = this.rotation;
			this.preview.x = (gx + eW / 2) * CELL;
			this.preview.y = (gy + eH / 2) * CELL;
			this.preview.render(ctx);
			ctx.restore();
		}
	}

	_render() {
		const { ctx, canvas } = this;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Background + stars in standalone mode (not overlaid on combat)
		if (this._sector) {
			ctx.fillStyle = '#02040a';
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			this._drawStars(ctx);
		}

		ctx.save();
		this.camera.applyTransform(ctx, canvas);
		this._drawAsteroid(ctx);
		if (this.interactive) this._drawGrid(ctx);
		for (const obj of this.placed.values()) obj.render(ctx);
		if (this.interactive) this._drawHoverCell(ctx);
		ctx.restore();

		// HUD: rotation hint while a building is selected
		if (this.interactive && this.selectedBuildingId) {
			const label = `R — Rotate  |  ${this.rotation}°`;
			ctx.save();
			ctx.font         = '13px monospace';
			ctx.textAlign    = 'left';
			ctx.textBaseline = 'middle';
			const tw = ctx.measureText(label).width;
			ctx.fillStyle = 'rgba(0,0,0,0.55)';
			ctx.fillRect(10, canvas.height - 38, tw + 20, 26);
			ctx.fillStyle = '#aaffcc';
			ctx.fillText(label, 20, canvas.height - 25);
			ctx.restore();
		}
	}

	_drawStars(ctx) {
		if (!this._stars) {
			// Generate a stable set of stars in screen space (not world space)
			const rand = seededRand ? seededRand(0xdeadbeef) : Math.random.bind(Math);
			this._stars = Array.from({ length: 120 }, () => ({
				sx: rand(), sy: rand(), r: rand() * 1.2 + 0.3, a: rand() * 0.6 + 0.2,
			}));
		}
		const { width, height } = ctx.canvas;
		for (const s of this._stars) {
			ctx.beginPath();
			ctx.arc(s.sx * width, s.sy * height, s.r, 0, Math.PI * 2);
			ctx.fillStyle = `rgba(200,215,255,${s.a})`;
			ctx.fill();
		}
	}

	_loop() {
		if (!this.active) return;
		this._update();
		this._render();
		requestAnimationFrame(() => this._loop());
	}

	resize() {
		this.canvas.width  = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	stop() { this.active = false; }
}

// ── Entry points ──────────────────────────────────────────────────────────────
let buildSystem    = null;
let buildContext   = 'lobby';
let buildSectorKey = null;

function startBuildMode(fromGame, sectorKey, initialCam) {
	buildContext   = fromGame ? 'game' : 'lobby';
	buildSectorKey = sectorKey || null;

	// Raise build canvas above login/lobby/game
	document.querySelector('#build').style.zIndex = '999';
	document.querySelector('#build-ui').style.display = 'flex';

	if (!fromGame) document.querySelector('login').style.display = 'none';

	if (buildSystem && buildSystem.sectorKey === buildSectorKey) {
		// Re-entering same sector — just re-enable interaction
		buildSystem.setInteractive(true);
		return;
	}

	// First entry or sector change — create a fresh BuildSystem
	if (buildSystem) buildSystem.stop();
	const canvas = document.querySelector('#build-canvas');
	buildSystem = new BuildSystem(canvas, buildSectorKey, initialCam || null);
	buildSystem.resize();
	// Call setInteractive after construction so the first loop renders correctly
	buildSystem.setInteractive(true);
	window.addEventListener('resize', () => buildSystem && buildSystem.resize());
}

function exitBuildMode() {
	// Drop canvas to background (behind login/lobby/game in DOM order)
	document.querySelector('#build').style.zIndex = '';
	document.querySelector('#build-ui').style.display = 'none';

	if (buildContext === 'lobby') document.querySelector('login').style.display = '';
	if (buildSystem) buildSystem.setInteractive(false);

	buildSectorKey = null;
	if (typeof buildModeActive !== 'undefined') buildModeActive = false;
}

// ── Auto-init background render ───────────────────────────────────────────────
// Initialise a passive BuildSystem immediately so the asteroid renders behind
// the login/lobby screens before the player ever clicks "Build Mode".
window.addEventListener('load', () => {
	const canvas = document.querySelector('#build-canvas');
	buildSystem  = new BuildSystem(canvas, '4_4', { x: 0, y: 0, zoom: 0.4 });
	buildSystem.resize();
	// interactive stays false — passive render only
	window.addEventListener('resize', () => buildSystem && buildSystem.resize());
});
