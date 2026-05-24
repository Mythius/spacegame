var socket = io();

let logged_in    = false;
let game_started = false;
let game_id, my_player_id;

obj('#name').focus();

obj('#start').on('click', login);
obj('#launch').on('click', launch);

document.on('keydown', e => {
	if (e.key == 'Enter') login();
});

document.on('click', launch);

function launch(e) {
	if (e.target != obj('#launch')) return;
	if (logged_in && !game_started) {
		socket.emit('launch');
	}
}

function login() {
	if (logged_in) return;
	let name = obj('#name').value;
	if (name.length == 0) name = 'Unnamed';
	socket.emit('login', name);
	hide(obj('login'));
	logged_in = true;
	show(obj('lobby'));
	obj('lobby').style.opacity = .8;

	buildShipCards();
	selectShip(selectedShipKey); // send default immediately
}

socket.on('players', players => {
	let list = obj('#players');
	let children = list.children;
	let child_count = children.length;
	while (child_count--) children[child_count].remove();
	for (let player of players) {
		let li = create('li', player.name);
		li.on('click', e => { socket.emit('request', player.id); });
		list.appendChild(li);
	}
});

socket.on('request_from', player => {
	let div = create('request', `Request to Join from ${player.name} `);
	let a = create('button', 'Join');
	let b = create('button', 'Decline');
	div.appendChild(a);
	div.appendChild(b);
	div.appendChild(create('br'));
	a.on('click', e => { socket.emit('accept', player); div.remove(); });
	b.on('click', e => { div.remove(); });
	obj('main').appendChild(div);
});

socket.on('accepted', player => {
	obj('main').innerHTML += player.name + ' joined party!<br>';
});

socket.on('start_game', ({ gameId, playerId }) => {
	game_id      = gameId;
	my_player_id = playerId;
	hide(obj('lobby'));
	obj('game').style.visibility = 'visible';
});

// ── Ship selection ─────────────────────────────────────────────

let selectedShipKey = 'scout';

// Mini-grid component shape cache — rebuilds ship cards on first load of each asset
const _miniShapeCache = new Map();
function _getMiniShape(asset) {
  if (!_miniShapeCache.has(asset)) {
    const p = new PolarObject(`/assets/${asset}`);
    p.lineWidth = 1;
    p.onload = () => { p.show(); buildShipCards(); };
    _miniShapeCache.set(asset, p);
  }
  return _miniShapeCache.get(asset);
}

// Color mapping for mini-grid rendering
const _MINI_COLORS = [
	['core',        '#f84'],
	['armor',       '#7a9'],
	['thruster',    '#48f'],
	['shield',      '#4cf'],
	['storage',     '#4b8'],
	['weapon',      '#f55'],
	['drill',       '#ca4'],
	['tether',      '#a6f'],
	['fabricator',  '#f6a'],
	['drone',       '#4db'],
	['conveyor',    '#8c6'],
	['pipe',        '#69b'],
	['liquid',      '#4bf'],
	['process',     '#c74'],
	['power',       '#fd4'],
	['system',      '#b8f'],
];

function _compColor(typeKey) {
	for (const [prefix, color] of _MINI_COLORS) {
		if (typeKey.startsWith(prefix)) return color;
	}
	return '#556';
}

function buildShipCards() {
	const container = document.getElementById('ship-cards');
	if (!container || typeof SHIP_TEMPLATES === 'undefined') return;
	container.innerHTML = '';

	for (const tpl of SHIP_TEMPLATES) {
		const card = document.createElement('div');
		card.className = 'ship-card' + (tpl.key === selectedShipKey ? ' sel' : '');
		card.dataset.key = tpl.key;
		card.style.setProperty('--c', tpl.color);

		// Mini grid canvas
		const cvs = document.createElement('canvas');
		renderMiniGrid(cvs, tpl);
		card.appendChild(cvs);

		// Name
		const nameEl = document.createElement('div');
		nameEl.className = 'scard-name';
		nameEl.textContent = tpl.name;
		card.appendChild(nameEl);

		// Description
		const descEl = document.createElement('div');
		descEl.className = 'scard-desc';
		descEl.textContent = tpl.desc;
		card.appendChild(descEl);

		// Stats bars
		const phys = shipPhysics(tpl);
		const bars = [
			{ label: 'Speed', value: phys.maxSpeed, max: 520, color: '#48f' },
			{ label: 'Turn',  value: phys.turnRate, max: 3.5,  color: '#4cf' },
			{ label: 'HP',    value: phys.maxHp,    max: 1500, color: '#4a8' },
		];
		for (const bar of bars) {
			const pct = Math.round(Math.min(1, bar.value / bar.max) * 100);
			const row = document.createElement('div');
			row.className = 'sbar-row';
			row.innerHTML = `<span class="sbar-lbl">${bar.label}</span>` +
				`<div class="sbar-track"><div class="sbar-fill" style="width:${pct}%;background:${bar.color}"></div></div>`;
			card.appendChild(row);
		}

		card.addEventListener('click', () => selectShip(tpl.key));
		container.appendChild(card);
	}
}

function selectShip(key) {
	selectedShipKey = key;
	document.querySelectorAll('.ship-card').forEach(c => {
		c.classList.toggle('sel', c.dataset.key === key);
	});
	socket.emit('selectShip', key);
}

function renderMiniGrid(canvas, template) {
	const SIZE = 108;
	const CELL = Math.floor(SIZE / Math.max(template.gridW, template.gridH));
	canvas.width  = template.gridW * CELL;
	canvas.height = template.gridH * CELL;

	const cx = canvas.getContext('2d');
	cx.fillStyle = '#050b14';
	cx.fillRect(0, 0, canvas.width, canvas.height);

	// Grid lines
	cx.strokeStyle = '#0d1a28';
	cx.lineWidth = 0.5;
	for (let x = 0; x <= template.gridW; x++) {
		cx.beginPath(); cx.moveTo(x * CELL + 0.5, 0); cx.lineTo(x * CELL + 0.5, canvas.height); cx.stroke();
	}
	for (let y = 0; y <= template.gridH; y++) {
		cx.beginPath(); cx.moveTo(0, y * CELL + 0.5); cx.lineTo(canvas.width, y * CELL + 0.5); cx.stroke();
	}

	// Components
	const placed = new Set();
	for (const entry of template.layout) {
		if (placed.has(`${entry.x},${entry.y}`)) continue;
		const reg = COMPONENT_REGISTRY[entry.typeKey];
		if (!reg) continue;
		const def = reg.defaults;
		const col = _compColor(entry.typeKey);
		const px  = entry.x * CELL + 1;
		const py  = entry.y * CELL + 1;
		const pw  = def.gridW * CELL - 2;
		const ph  = def.gridH * CELL - 2;

		cx.fillStyle   = col + '33';
		cx.fillRect(px, py, pw, ph);
		cx.strokeStyle = col;
		cx.lineWidth   = 1;
		cx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);

		const regEntry  = (typeof COMPONENT_REGISTRY !== 'undefined') ? COMPONENT_REGISTRY[entry.typeKey] : null;
		const miniAsset = regEntry ? regEntry.asset : null;
		if (miniAsset && CELL >= 10) {
			const shape = _getMiniShape(miniAsset);
			if (shape.loaded) {
				cx.save();
				cx.beginPath();
				cx.rect(px, py, pw, ph);
				cx.clip();
				shape.x     = px + pw / 2;
				shape.y     = py + ph / 2;
				shape.scale = (Math.min(pw, ph) * 0.4) / 7;
				shape.render(cx);
				cx.restore();
			}
		}

		for (let dy = 0; dy < def.gridH; dy++)
			for (let dx = 0; dx < def.gridW; dx++)
				placed.add(`${entry.x + dx},${entry.y + dy}`);
	}
}

// ── Initial hide ───────────────────────────────────────────────
hide(obj('lobby'));
hide(obj('game'));
