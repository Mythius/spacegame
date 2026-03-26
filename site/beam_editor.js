const canvas = obj('canvas');
const ctx = canvas.getContext('2d');
canvas.width  = 700;
canvas.height = 300;

const SX   = 50;                        // source x
const SY   = canvas.height / 2;        // source y
const PMAX = canvas.width - SX - 20;   // max preview beam length (630)

// ── State ─────────────────────────────────────────────────────
let beamDef = {
	name: 'new_beam',
	drawMode: 'immediate',
	drawSpeed: 600,
	layers: []
};
let selIdx  = null;   // selected layer index
let growing = false;  // continuous-mode animation active
let pLen    = PMAX;
let phase   = 0;
let lastTs  = null;

// ── Preview loop ──────────────────────────────────────────────
function loop(ts) {
	const dt = lastTs !== null ? Math.min((ts - lastTs) / 1000, 0.1) : 0;
	lastTs = ts;
	phase += dt * 4;

	if (beamDef.drawMode === 'immediate' || !growing) {
		pLen = PMAX;
	} else {
		pLen += beamDef.drawSpeed * dt;
		if (pLen >= PMAX) pLen = 0;
	}

	drawPreview();
	requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ── Draw ──────────────────────────────────────────────────────
function drawPreview() {
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.fillStyle = '#030312';
	ctx.fillRect(0, 0, canvas.width, canvas.height);

	// axis guide
	ctx.save();
	ctx.setLineDash([3, 7]);
	ctx.strokeStyle = '#181830';
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(SX, SY);
	ctx.lineTo(canvas.width - 10, SY);
	ctx.stroke();
	ctx.setLineDash([]);
	ctx.restore();

	// amplitude guides for selected sin/zigzag layer
	if (selIdx !== null) {
		const sl = beamDef.layers[selIdx];
		if (sl && sl.type !== 'line' && (sl.amplitude || 0) > 0) {
			ctx.save();
			ctx.setLineDash([2, 6]);
			ctx.strokeStyle = 'rgba(100,180,255,0.2)';
			ctx.lineWidth = 1;
			for (const dy of [-sl.amplitude, sl.amplitude]) {
				ctx.beginPath();
				ctx.moveTo(SX, SY + dy);
				ctx.lineTo(canvas.width - 10, SY + dy);
				ctx.stroke();
			}
			ctx.setLineDash([]);
			ctx.restore();
		}
	}

	// beam layers
	ctx.save();
	ctx.translate(SX, SY);
	for (const layer of beamDef.layers) drawLayer(layer);
	ctx.restore();

	// source glow — outer halo
	const g1 = ctx.createRadialGradient(SX, SY, 0, SX, SY, 70);
	g1.addColorStop(0,   'rgba(140,210,255,0.18)');
	g1.addColorStop(1,   'rgba(140,210,255,0)');
	ctx.beginPath();
	ctx.arc(SX, SY, 70, 0, Math.PI * 2);
	ctx.fillStyle = g1;
	ctx.fill();
	// source glow — mid ring
	const g2 = ctx.createRadialGradient(SX, SY, 0, SX, SY, 30);
	g2.addColorStop(0,   'rgba(180,230,255,0.55)');
	g2.addColorStop(1,   'rgba(140,210,255,0)');
	ctx.beginPath();
	ctx.arc(SX, SY, 30, 0, Math.PI * 2);
	ctx.fillStyle = g2;
	ctx.fill();
	// source glow — bright core
	const g3 = ctx.createRadialGradient(SX, SY, 0, SX, SY, 10);
	g3.addColorStop(0,   'rgba(255,255,255,1)');
	g3.addColorStop(0.4, 'rgba(180,230,255,0.9)');
	g3.addColorStop(1,   'rgba(140,210,255,0)');
	ctx.beginPath();
	ctx.arc(SX, SY, 10, 0, Math.PI * 2);
	ctx.fillStyle = g3;
	ctx.fill();
}

function drawLayer(layer) {
	ctx.save();
	ctx.globalAlpha = layer.opacity !== undefined ? layer.opacity : 1;
	ctx.strokeStyle = layer.color     || '#ffffff';
	ctx.lineWidth   = layer.thickness || 2;
	ctx.lineCap     = 'round';
	ctx.lineJoin    = 'round';
	ctx.shadowColor = layer.color     || '#ffffff';
	ctx.shadowBlur  = (layer.thickness || 2) * 4 + 6;
	ctx.beginPath();

	const amp = layer.amplitude    || 10;
	const wl  = Math.max(layer.wavelength || 60, 1);
	const ss  = layer.shiftSpeed  !== undefined ? layer.shiftSpeed  : 1;
	const po  = layer.phaseOffset !== undefined ? layer.phaseOffset : 0;
	const len = pLen;

	if (layer.type === 'sin') {
		for (let x = 0; x <= len; x += 2) {
			const y = amp * Math.sin(x / wl * Math.PI * 2 + phase * ss + po * Math.PI * 2);
			x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
	} else if (layer.type === 'zigzag') {
		const shift = phase * ss * wl / (Math.PI * 2) + po * wl;
		for (let x = 0; x <= len; x++) {
			const xs = x + shift;
			const t = ((xs % wl) + wl) % wl / wl;
			let y;
			if (t < 0.25)      y = amp * t * 4;
			else if (t < 0.75) y = amp * (1 - (t - 0.25) * 4);
			else               y = amp * ((t - 0.75) * 4 - 1);
			x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
	} else {
		ctx.moveTo(0, 0);
		ctx.lineTo(len, 0);
	}
	ctx.stroke();
	ctx.restore();
}

// ── Layers panel ──────────────────────────────────────────────
const TYPE_LABEL = { line: 'LINE', sin: 'SIN', zigzag: 'ZIG' };

function updateLayersList() {
	const list = obj('#layers-list');
	list.innerHTML = '';
	beamDef.layers.forEach((layer, i) => {
		const row = document.createElement('div');
		row.className = 'layer-row' + (i === selIdx ? ' selected' : '');

		const moveBtns = document.createElement('div');
		moveBtns.className = 'layer-move-btns';
		['▲', '▼'].forEach((sym, di) => {
			const b = document.createElement('button');
			b.textContent = sym;
			b.onclick = e => { e.stopPropagation(); moveLayer(i, di === 0 ? -1 : 1); };
			moveBtns.appendChild(b);
		});
		row.appendChild(moveBtns);

		const num = document.createElement('span');
		num.className = 'layer-num';
		num.textContent = `#${i + 1}`;
		row.appendChild(num);

		const badge = document.createElement('span');
		badge.className = `layer-badge ${layer.type}`;
		badge.textContent = TYPE_LABEL[layer.type] || layer.type.toUpperCase();
		row.appendChild(badge);

		const colorInp = document.createElement('input');
		colorInp.type      = 'color';
		colorInp.value     = layer.color || '#ffffff';
		colorInp.className = 'layer-color-inp';
		colorInp.oninput   = e => { beamDef.layers[i].color = e.target.value; };
		colorInp.onclick   = e => e.stopPropagation();
		row.appendChild(colorInp);

		const del = document.createElement('button');
		del.className   = 'layer-del';
		del.textContent = '✕';
		del.onclick = e => { e.stopPropagation(); deleteLayer(i); };
		row.appendChild(del);

		row.onclick = () => selectLayer(i);
		list.appendChild(row);
	});
}

function selectLayer(i) {
	selIdx = selIdx === i ? null : i;
	updateLayersList();
	updateLayerProps();
}

function addLayer() {
	const type  = obj('#new-layer-type').value;
	const extra = type !== 'line' ? { amplitude: 15, wavelength: 80, shiftSpeed: 1, phaseOffset: 0 } : {};
	beamDef.layers.push({ type, color: '#ffffff', thickness: 2, opacity: 1, ...extra });
	selIdx = beamDef.layers.length - 1;
	updateLayersList();
	updateLayerProps();
}

function deleteLayer(i) {
	beamDef.layers.splice(i, 1);
	if (selIdx !== null) {
		if (beamDef.layers.length === 0) selIdx = null;
		else if (selIdx >= beamDef.layers.length) selIdx = beamDef.layers.length - 1;
	}
	updateLayersList();
	updateLayerProps();
}

function moveLayer(i, d) {
	const j = i + d;
	if (j < 0 || j >= beamDef.layers.length) return;
	[beamDef.layers[i], beamDef.layers[j]] = [beamDef.layers[j], beamDef.layers[i]];
	if (selIdx === i) selIdx = j;
	else if (selIdx === j) selIdx = i;
	updateLayersList();
}

// ── Layer properties ──────────────────────────────────────────
function updateLayerProps() {
	const panel = obj('#layer-props');
	if (selIdx === null || !beamDef.layers[selIdx]) {
		panel.innerHTML = '<div class="no-layer">Select a layer to edit</div>';
		return;
	}
	const L    = beamDef.layers[selIdx];
	const wavy = L.type !== 'line';

	panel.innerHTML = `
		<div class="prop-row">
			<label>Type</label>
			<select id="lp-type">
				<option value="line"   ${L.type==='line'   ?'selected':''}>Line</option>
				<option value="sin"    ${L.type==='sin'    ?'selected':''}>Sin Wave</option>
				<option value="zigzag" ${L.type==='zigzag' ?'selected':''}>Zigzag</option>
			</select>
		</div>
		<div class="prop-row">
			<label>Thickness</label>
			<div class="slider-row">
				<input type="range"  id="lp-th-r" min="0.5" max="50" step="0.5" value="${L.thickness||2}">
				<input type="number" id="lp-th-n" min="0.5" max="50" step="0.5" value="${L.thickness||2}" class="num-in">
			</div>
		</div>
		<div class="prop-row">
			<label>Opacity</label>
			<div class="slider-row">
				<input type="range"  id="lp-op-r" min="0" max="1" step="0.05" value="${L.opacity!==undefined?L.opacity:1}">
				<input type="number" id="lp-op-n" min="0" max="1" step="0.05" value="${L.opacity!==undefined?L.opacity:1}" class="num-in">
			</div>
		</div>
		${wavy ? `
		<div class="prop-row">
			<label>Amplitude (px)</label>
			<div class="slider-row">
				<input type="range"  id="lp-amp-r" min="1" max="130" step="1" value="${L.amplitude||15}">
				<input type="number" id="lp-amp-n" min="1" max="130" step="1" value="${L.amplitude||15}" class="num-in">
			</div>
		</div>
		<div class="prop-row">
			<label>Wavelength (px)</label>
			<div class="slider-row">
				<input type="range"  id="lp-wl-r" min="10" max="400" step="5" value="${L.wavelength||80}">
				<input type="number" id="lp-wl-n" min="10" max="400" step="5" value="${L.wavelength||80}" class="num-in">
			</div>
		</div>
		<div class="prop-row">
			<label>Shift Speed</label>
			<div class="slider-row">
				<input type="range"  id="lp-ss-r" min="-5" max="5" step="0.1" value="${L.shiftSpeed!==undefined?L.shiftSpeed:1}">
				<input type="number" id="lp-ss-n" min="-5" max="5" step="0.1" value="${L.shiftSpeed!==undefined?L.shiftSpeed:1}" class="num-in">
			</div>
		</div>
		<div class="prop-row">
			<label>Phase Offset (cycles)</label>
			<div class="slider-row">
				<input type="range"  id="lp-po-r" min="0" max="1" step="0.01" value="${L.phaseOffset!==undefined?L.phaseOffset:0}">
				<input type="number" id="lp-po-n" min="0" max="1" step="0.01" value="${L.phaseOffset!==undefined?L.phaseOffset:0}" class="num-in">
			</div>
		</div>` : ''}
	`;

	obj('#lp-type').onchange = e => {
		L.type = e.target.value;
		if (L.type !== 'line') {
			L.amplitude   = L.amplitude   || 15;
			L.wavelength  = L.wavelength  || 80;
			L.shiftSpeed  = L.shiftSpeed  !== undefined ? L.shiftSpeed  : 1;
			L.phaseOffset = L.phaseOffset !== undefined ? L.phaseOffset : 0;
		}
		updateLayersList();
		updateLayerProps();
	};
	bind('lp-th', v => L.thickness = v);
	bind('lp-op', v => L.opacity   = v);
	if (wavy) {
		bind('lp-amp', v => L.amplitude   = v);
		bind('lp-wl',  v => L.wavelength  = v);
		bind('lp-ss',  v => L.shiftSpeed  = v);
		bind('lp-po',  v => L.phaseOffset = v);
	}
}

function bind(id, fn) {
	const r = obj(`#${id}-r`), n = obj(`#${id}-n`);
	if (!r || !n) return;
	r.oninput = () => { n.value = r.value; fn(parseFloat(r.value)); };
	n.oninput = () => { r.value = n.value; fn(parseFloat(n.value)); };
}

// ── Beam-level controls ───────────────────────────────────────
function initControls() {
	obj('#beam-name').oninput  = e => { beamDef.name = e.target.value; };
	obj('#mode-imm').onclick   = () => setMode('immediate');
	obj('#mode-cont').onclick  = () => setMode('continuous');
	obj('#draw-speed').oninput = e => { beamDef.drawSpeed = parseFloat(e.target.value) || 600; };

	obj('#play-btn').onclick = () => {
		if (beamDef.drawMode !== 'continuous') return;
		growing = !growing;
		if (growing) pLen = 0;
		obj('#play-btn').textContent = growing ? '■ Stop' : '▶ Play';
		obj('#play-btn').classList.toggle('playing', growing);
		obj('#canvas-info').textContent = growing ? 'animating beam growth…' : 'continuous — click ▶ Play to animate';
	};

	obj('#add-layer-btn').onclick = addLayer;
	setMode('immediate');
}

function setMode(mode) {
	beamDef.drawMode = mode;
	obj('#mode-imm').classList.toggle('active', mode === 'immediate');
	obj('#mode-cont').classList.toggle('active', mode === 'continuous');
	obj('#draw-speed-row').style.display = mode === 'continuous' ? 'block' : 'none';
	if (mode === 'immediate') {
		growing = false;
		obj('#play-btn').textContent = '▶ Play';
		obj('#play-btn').classList.remove('playing');
		obj('#canvas-info').textContent = 'immediate — full beam shown';
	} else {
		obj('#canvas-info').textContent = 'continuous — click ▶ Play to animate';
	}
}

// ── Save / Load ───────────────────────────────────────────────
function buildSaveData() {
	return {
		name:      beamDef.name,
		drawMode:  beamDef.drawMode,
		drawSpeed: beamDef.drawSpeed,
		layers:    beamDef.layers.map(l => ({ ...l }))
	};
}

function loadBeam(data) {
	beamDef = {
		name:      data.name      || 'beam',
		drawMode:  data.drawMode  || 'immediate',
		drawSpeed: data.drawSpeed || 600,
		layers:    (data.layers   || []).map(l => ({ ...l }))
	};
	selIdx = null; growing = false;
	obj('#beam-name').value  = beamDef.name;
	obj('#draw-speed').value = beamDef.drawSpeed;
	setMode(beamDef.drawMode);
	updateLayersList();
	updateLayerProps();
}

document.on('keydown', e => {
	if (['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return;
	if (e.key === 's') download(`${beamDef.name || 'beam'}.json`, JSON.stringify(buildSaveData(), null, 2));
	if (e.key === 'i') obj('#import-input').click();
});

const importInput = document.createElement('input');
importInput.type = 'file'; importInput.accept = '.json';
importInput.id = 'import-input'; importInput.style.display = 'none';
document.body.appendChild(importInput);
importInput.on('change', e => {
	const f = e.target.files[0]; if (!f) return;
	const r = new FileReader();
	r.onload = ev => loadBeam(JSON.parse(ev.target.result));
	r.readAsText(f); importInput.value = '';
});

// ── Init ──────────────────────────────────────────────────────
initControls();
updateLayersList();
updateLayerProps();
