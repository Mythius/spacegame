// ── Constants ─────────────────────────────────────────────────────────────────
const CELL           = 80;   // world units between grid snap points
const CELL_SIZES     = [1, 2, 4, 8, 16];  // snap sizes in grid cells
const BASE_CELL_SCALE = CELL / 16;        // scale so 1 cell ≈ asset diameter
const PAN_SPEED  = 5;    // world units per frame (divided by zoom)
const ZOOM_MIN   = 0.25;
const ZOOM_MAX   = 4;
const INIT_ZOOM  = 1.5;

// ── Camera ────────────────────────────────────────────────────────────────────
class Camera {
	constructor() {
		this.x    = 0;
		this.y    = 0;
		this.zoom = INIT_ZOOM;
	}
	applyTransform(ctx, canvas) {
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.scale(this.zoom, this.zoom);
		ctx.translate(-this.x, -this.y);
	}
	screenToWorld(sx, sy, canvas) {
		return {
			x: this.x + (sx - canvas.width  / 2) / this.zoom,
			y: this.y + (sy - canvas.height / 2) / this.zoom
		};
	}
	pan(dx, dy) {
		this.x += dx;
		this.y += dy;
	}
	zoomAt(delta, sx, sy, canvas) {
		let before = this.screenToWorld(sx, sy, canvas);
		this.zoom  = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.zoom * (1 + delta)));
		let after  = this.screenToWorld(sx, sy, canvas);
		this.x    += before.x - after.x;
		this.y    += before.y - after.y;
	}
}

// ── PlacedObject ──────────────────────────────────────────────────────────────
class PlacedObject {
	constructor(assetName, gx, gy, scale) {
		this.assetName = assetName;
		this.gx = gx;
		this.gy = gy;
		this.polar = new PolarObject(`/assets/${assetName}`);
		this.polar.scale = scale;
		this.polar.onload = () => this.polar.show();
	}
	render(ctx) {
		this.polar.x = this.gx * CELL;
		this.polar.y = this.gy * CELL;
		this.polar.render(ctx);
	}
}

// ── BuildSystem ───────────────────────────────────────────────────────────────
class BuildSystem {
	constructor(canvas) {
		this.canvas      = canvas;
		this.ctx         = canvas.getContext('2d');
		this.camera      = new Camera();
		this.placed      = new Map();   // "gx,gy" → PlacedObject
		this.assets      = [];
		this.selectedAsset = null;
		this.sizeIndex   = 1;           // index into CELL_SIZES (default = 2 cells)
		this.preview     = null;        // PolarObject ghost
		this.hoverCell   = { gx: 0, gy: 0 };
		this.mouseScreen = { x: 0, y: 0 };
		this.keys        = {};
		this.active      = true;

		this._bindEvents();
		this._loadAssets();
		this._loop();
	}

	_loadAssets() {
		fetch('/asset-list')
			.then(r => r.json())
			.then(({ files }) => {
				this.assets = (files || []).filter(f => f.endsWith('.json'));
				this._buildPalette();
			});
	}

	_buildPalette() {
		let palette = document.querySelector('#build-palette');
		palette.innerHTML = '';
		for (let name of this.assets) {
			let btn = document.createElement('button');
			btn.className = 'palette-btn';
			btn.textContent = name.replace('.json', '');
			btn.dataset.name = name;
			btn.addEventListener('click', () => this.selectAsset(name));
			palette.appendChild(btn);
		}
	}

	selectAsset(name) {
		this.selectedAsset = name;
		document.querySelectorAll('.palette-btn').forEach(b =>
			b.classList.toggle('selected', b.dataset.name === name)
		);
		this.preview = new PolarObject(`/assets/${name}`);
		this.preview.scale = this._placementScale();
		this.preview.onload = () => this.preview.show();
	}

	_placementScale() {
		return CELL_SIZES[this.sizeIndex] * BASE_CELL_SCALE;
	}

	_updateSizeLabel() {
		let el = document.querySelector('#build-size-label');
		if (el) el.textContent = `Size: ${CELL_SIZES[this.sizeIndex]} cell${CELL_SIZES[this.sizeIndex] > 1 ? 's' : ''}`;
	}

	deselect() {
		this.selectedAsset = null;
		this.preview = null;
		document.querySelectorAll('.palette-btn').forEach(b => b.classList.remove('selected'));
	}

	_bindEvents() {
		document.addEventListener('keydown', e => {
			if (!this.active) return;
			this.keys[e.key.toLowerCase()] = true;
			if (e.key === 'Escape') this.deselect();
		});
		document.addEventListener('keyup', e => {
			this.keys[e.key.toLowerCase()] = false;
		});

		this.canvas.addEventListener('mousemove', e => {
			let r = this.canvas.getBoundingClientRect();
			this.mouseScreen = { x: e.clientX - r.left, y: e.clientY - r.top };
			let w = this.camera.screenToWorld(this.mouseScreen.x, this.mouseScreen.y, this.canvas);
			this.hoverCell = {
				gx: Math.round(w.x / CELL),
				gy: Math.round(w.y / CELL)
			};
		});

		this.canvas.addEventListener('click', e => {
			if (!this.selectedAsset) return;
			let { gx, gy } = this.hoverCell;
			let key = `${gx},${gy}`;
			if (gx === 0 && gy === 0) return;
			if (!this.placed.has(key)) {
				this.placed.set(key, new PlacedObject(this.selectedAsset, gx, gy, this._placementScale()));
			}
		});

		this.canvas.addEventListener('contextmenu', e => {
			e.preventDefault();
			let { gx, gy } = this.hoverCell;
			this.placed.delete(`${gx},${gy}`);
		});

		this.canvas.addEventListener('wheel', e => {
			e.preventDefault();
			if (e.ctrlKey) {
				// Ctrl+Scroll: cycle placement size
				this.sizeIndex = Math.max(0, Math.min(CELL_SIZES.length - 1,
					this.sizeIndex + (e.deltaY > 0 ? -1 : 1)
				));
				// update preview scale
				if (this.preview) this.preview.scale = this._placementScale();
				this._updateSizeLabel();
			} else {
				this.camera.zoomAt(
					e.deltaY > 0 ? -0.1 : 0.1,
					this.mouseScreen.x, this.mouseScreen.y,
					this.canvas
				);
			}
		}, { passive: false });
	}

	_update() {
		if (!this.active) return;
		let spd = PAN_SPEED / this.camera.zoom;
		if (this.keys['w'] || this.keys['arrowup'])    this.camera.pan(0, -spd);
		if (this.keys['s'] || this.keys['arrowdown'])  this.camera.pan(0,  spd);
		if (this.keys['a'] || this.keys['arrowleft'])  this.camera.pan(-spd, 0);
		if (this.keys['d'] || this.keys['arrowright']) this.camera.pan( spd, 0);
	}

	_drawGrid(ctx) {
		let tl = this.camera.screenToWorld(0, 0, this.canvas);
		let br = this.camera.screenToWorld(this.canvas.width, this.canvas.height, this.canvas);
		let x0 = Math.floor(tl.x / CELL) - 1;
		let y0 = Math.floor(tl.y / CELL) - 1;
		let x1 = Math.ceil(br.x  / CELL) + 1;
		let y1 = Math.ceil(br.y  / CELL) + 1;

		ctx.beginPath();
		ctx.strokeStyle = 'rgba(255,255,255,0.07)';
		ctx.lineWidth   = 1 / this.camera.zoom;
		for (let gx = x0; gx <= x1; gx++) {
			ctx.moveTo(gx * CELL, y0 * CELL);
			ctx.lineTo(gx * CELL, y1 * CELL);
		}
		for (let gy = y0; gy <= y1; gy++) {
			ctx.moveTo(x0 * CELL, gy * CELL);
			ctx.lineTo(x1 * CELL, gy * CELL);
		}
		ctx.stroke();

		// highlight axes
		ctx.beginPath();
		ctx.strokeStyle = 'rgba(100,180,255,0.18)';
		ctx.lineWidth   = 1.5 / this.camera.zoom;
		ctx.moveTo(x0 * CELL, 0); ctx.lineTo(x1 * CELL, 0);
		ctx.moveTo(0, y0 * CELL); ctx.lineTo(0, y1 * CELL);
		ctx.stroke();
	}

	_drawBase(ctx) {
		let lw = 2 / this.camera.zoom;
		let s  = CELL * 0.42;

		// outer ring
		ctx.beginPath();
		ctx.strokeStyle = '#4af';
		ctx.lineWidth   = lw;
		ctx.arc(0, 0, s, 0, Math.PI * 2);
		ctx.stroke();

		// cross
		ctx.beginPath();
		ctx.strokeStyle = '#4af';
		ctx.lineWidth   = lw;
		ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
		ctx.moveTo(0, -s); ctx.lineTo(0, s);
		ctx.stroke();

		// center dot
		ctx.beginPath();
		ctx.fillStyle = '#7cf';
		ctx.arc(0, 0, 5 / this.camera.zoom, 0, Math.PI * 2);
		ctx.fill();

		// label
		ctx.fillStyle   = 'rgba(100,200,255,0.6)';
		ctx.font        = `${11 / this.camera.zoom}px monospace`;
		ctx.textAlign   = 'center';
		ctx.fillText('BASE', 0, s + 14 / this.camera.zoom);
	}

	_drawHoverCell(ctx) {
		if (!this.selectedAsset) return;
		let { gx, gy } = this.hoverCell;
		let cx  = gx * CELL, cy = gy * CELL;
		let key = `${gx},${gy}`;
		let isBase    = gx === 0 && gy === 0;
		let occupied  = this.placed.has(key);
		let canPlace  = !isBase && !occupied;

		ctx.fillStyle = canPlace
			? 'rgba(80,255,120,0.12)'
			: 'rgba(255,60,60,0.18)';
		ctx.fillRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);
		ctx.strokeStyle = canPlace ? 'rgba(80,255,120,0.4)' : 'rgba(255,80,80,0.4)';
		ctx.lineWidth   = 1 / this.camera.zoom;
		ctx.strokeRect(cx - CELL / 2, cy - CELL / 2, CELL, CELL);

		if (this.preview && canPlace) {
			ctx.save();
			ctx.globalAlpha = 0.45;
			this.preview.x = cx;
			this.preview.y = cy;
			this.preview.render(ctx);
			ctx.restore();
		}
	}

	_render() {
		let { ctx, canvas } = this;
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// background
		ctx.fillStyle = '#03060f';
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		ctx.save();
		this.camera.applyTransform(ctx, canvas);

		this._drawGrid(ctx);

		// placed objects (behind base)
		for (let item of this.placed.values()) item.render(ctx);

		this._drawBase(ctx);
		this._drawHoverCell(ctx);

		ctx.restore();
	}

	_loop() {
		this._update();
		this._render();
		requestAnimationFrame(() => this._loop());
	}

	resize() {
		this.canvas.width  = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	stop() {
		this.active = false;
	}
}

// ── Entry point ───────────────────────────────────────────────────────────────
let buildSystem = null;

function startBuildMode() {
	document.querySelector('login').style.display   = 'none';
	document.querySelector('#build').style.display  = 'flex';
	let canvas = document.querySelector('#build-canvas');
	buildSystem = new BuildSystem(canvas);
	buildSystem.resize();
	window.addEventListener('resize', () => buildSystem && buildSystem.resize());
}

function exitBuildMode() {
	document.querySelector('#build').style.display = 'none';
	document.querySelector('login').style.display  = '';
	if (buildSystem) { buildSystem.stop(); buildSystem = null; }
}
