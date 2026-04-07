const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
app.use(express.json());

const file = {
	save: function(name,text){
		fs.writeFile(name,text,e=>{
			if(e) console.log(e);
		});
	},
	read: function(name,callback){
		fs.readFile(name,(error,buffer)=>{
			if (error) console.log(error);
			else callback(buffer.toString());
		});
	}
}

const port = 1301;
const path = __dirname+'/';

app.use(express.static(path+'site/'));
app.use('/assets', express.static(path+'assets/'));
app.use('/shared', express.static(path+'shared/'));

// ── Shared game libraries ─────────────────────────────────────────────────────
const CONSTANTS  = require('./shared/constants');
const Physics    = require('./shared/physics');
const Entities   = require('./shared/entity');
const Components = require('./shared/components');
const Weapons    = require('./shared/weapons');
const Resources  = require('./shared/resources');
const World      = require('./shared/world');

const { Vector2, AABB, circleCircle, sectorBoundaryForce } = Physics;
const { Entity, Avatar, Projectile }                        = Entities;
const { ShipGrid, createComponent, COMPONENT_REGISTRY }    = Components;
const { Weapon, createWeapon, WEAPON_REGISTRY, AMMO_TYPES } = Weapons;
const { RESOURCE_TYPES, ResourceDeposit, ResourceBag }      = Resources;
const { SolarSystem }                                        = World;
const { buildSector }                                        = require('./shared/worldgen');
const { BUILDING_REGISTRY }                                  = require('./shared/buildings');

// ── Player saves ──────────────────────────────────────────────────────────────
const nodePath = require('path');
const SAVES_DIR = path + 'saves/';
if (!fs.existsSync(SAVES_DIR)) fs.mkdirSync(SAVES_DIR, { recursive: true });

function savePlayer(playerId, data) {
	const dir = SAVES_DIR + playerId + '/';
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(dir + 'player.json', JSON.stringify(data, null, 2));
}

function loadPlayer(playerId) {
	const file = SAVES_DIR + playerId + '/player.json';
	if (!fs.existsSync(file)) return null;
	try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
	catch(e) { console.error('Failed to load player', playerId, e); return null; }
}

// ── Solar system (shared world state) ────────────────────────────────────────
const solarSystem = SolarSystem.generate();
console.log(`Solar system generated: ${solarSystem.gridW}×${solarSystem.gridH} sectors`);

// ── Asset sync ────────────────────────────────────────────────────────────────
const SftpClient = require('ssh2-sftp-client');
const REMOTE_HOST = 'msouthwick.com';
const REMOTE_USER = 'matthias';
const REMOTE_DIR  = '/srv/ftp/pub';
const ASSETS = path + 'assets/';

// list JSON files in assets/
app.get('/asset-list', (req, res) => {
	try {
		const files = fs.readdirSync(ASSETS).filter(f => f.endsWith('.json'));
		res.json({ files });
	} catch(e) {
		res.json({ files: [], error: e.message });
	}
});

// save JSON to assets/
app.post('/asset-save', (req, res) => {
	const { name, data } = req.body;
	if (!name || !data) return res.json({ ok: false, error: 'missing name or data' });
	const safe = require('path').basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
	const filename = safe.endsWith('.json') ? safe : safe + '.json';
	try {
		fs.writeFileSync(ASSETS + filename, JSON.stringify(data));
		res.json({ ok: true, filename });
	} catch(e) {
		res.json({ ok: false, error: e.message });
	}
});

// ── Beam assets ───────────────────────────────────────────────────────────────
const BEAMS = path + 'assets/beams/';
if (!fs.existsSync(BEAMS)) fs.mkdirSync(BEAMS, { recursive: true });
app.use('/beams', express.static(BEAMS));

app.get('/beam-list', (req, res) => {
	try {
		const files = fs.readdirSync(BEAMS).filter(f => f.endsWith('.json'));
		res.json({ files });
	} catch(e) {
		res.json({ files: [], error: e.message });
	}
});

app.post('/beam-save', (req, res) => {
	const { name, data } = req.body;
	if (!name || !data) return res.json({ ok: false, error: 'missing name or data' });
	const safe = require('path').basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
	const filename = safe.endsWith('.json') ? safe : safe + '.json';
	try {
		fs.writeFileSync(BEAMS + filename, JSON.stringify(data));
		res.json({ ok: true, filename });
	} catch(e) {
		res.json({ ok: false, error: e.message });
	}
});

// delete asset locally and from remote
app.post('/asset-delete', async (req, res) => {
	const { name } = req.body;
	if (!name) return res.json({ ok: false, error: 'missing name' });
	const safe = nodePath.basename(name);
	if (!safe || safe.includes('..')) return res.json({ ok: false, error: 'invalid name' });
	const localPath = ASSETS + safe;

	// delete locally
	try {
		if (fs.existsSync(localPath)) fs.unlinkSync(localPath);
	} catch(e) {
		return res.json({ ok: false, error: 'local delete failed: ' + e.message });
	}

	// delete from remote
	const sftp = new SftpClient();
	try {
		const os = require('os');
		const keyPath = process.env.SSH_KEY || nodePath.join(os.homedir(), '.ssh', 'id_ed25519');
		const connectOpts = { host: REMOTE_HOST, username: REMOTE_USER };
		if (fs.existsSync(keyPath)) connectOpts.privateKey = fs.readFileSync(keyPath);
		else if (process.env.SSH_AUTH_SOCK) connectOpts.agent = process.env.SSH_AUTH_SOCK;
		await sftp.connect(connectOpts);
		const remotePath = `${REMOTE_DIR}/${safe}`;
		const exists = await sftp.exists(remotePath);
		if (exists) await sftp.delete(remotePath);
		await sftp.end();
		res.json({ ok: true });
	} catch(e) {
		try { await sftp.end(); } catch(_) {}
		res.json({ ok: false, error: 'remote delete failed: ' + e.message });
	}
});

app.post('/sync', async (req, res) => {
	const sftp = new SftpClient();
	const lines = [];
	const log = (msg) => { lines.push(msg); console.log(msg); };

	try {
		const os = require('os');
		const nodePath = require('path');
		const keyPath = process.env.SSH_KEY || nodePath.join(os.homedir(), '.ssh', 'id_ed25519');
		const connectOpts = { host: REMOTE_HOST, username: REMOTE_USER };
		if (fs.existsSync(keyPath)) connectOpts.privateKey = fs.readFileSync(keyPath);
		else if (process.env.SSH_AUTH_SOCK) connectOpts.agent = process.env.SSH_AUTH_SOCK;
		await sftp.connect(connectOpts);
		log(`Connected to ${REMOTE_HOST}`);

		// local files: name → mtime in ms
		const localFiles = {};
		for (const f of fs.readdirSync(ASSETS)) {
			const stat = fs.statSync(ASSETS + f);
			if (stat.isFile()) localFiles[f] = stat.mtimeMs;
		}

		// remote files: name → mtime in ms
		const remoteFiles = {};
		for (const item of await sftp.list(REMOTE_DIR)) {
			if (item.type === '-') remoteFiles[item.name] = item.modifyTime; // already ms
		}

		const allNames = new Set([...Object.keys(localFiles), ...Object.keys(remoteFiles)]);
		let pushed = 0, pulled = 0, skipped = 0;

		for (const name of allNames) {
			const local  = localFiles[name];
			const remote = remoteFiles[name];
			const remotePath = `${REMOTE_DIR}/${name}`;
			const localPath  = ASSETS + name;

			if (local !== undefined && remote === undefined) {
				await sftp.put(localPath, remotePath);
				log(`↑ pushed  ${name}`);
				pushed++;
			} else if (remote !== undefined && local === undefined) {
				await sftp.get(remotePath, localPath);
				log(`↓ pulled  ${name}`);
				pulled++;
			} else if (local > remote + 1000) {
				await sftp.put(localPath, remotePath);
				log(`↑ pushed  ${name}  (local newer)`);
				pushed++;
			} else if (remote > local + 1000) {
				await sftp.get(remotePath, localPath);
				log(`↓ pulled  ${name}  (remote newer)`);
				pulled++;
			} else {
				skipped++;
			}
		}

		log(`\nDone — ↑${pushed} pushed  ↓${pulled} pulled  =${skipped} up-to-date`);
		await sftp.end();
		res.json({ ok: true, log: lines.join('\n') });
	} catch (e) {
		lines.push(`Error: ${e.message}`);
		try { await sftp.end(); } catch(_){}
		res.json({ ok: false, log: lines.join('\n') });
	}
});

app.get(/.*/,function(request,response){
	response.sendFile(path+'site/');
});

var users = [];

const THRUST    = 280;   // units/s²
const TURN_RATE = 2.8;   // rad/s
const DRAG      = 0.986;
const MAX_SPEED = 420;   // units/s
const BRAKE_MUL = 0.92;

class Game {
	static games   = [];
	static next_id = 0;

	constructor(users) {
		Game.games.push(this);
		this.id    = Game.next_id++;
		this.users = users;
		this.ships          = new Map(); // userId → ship state
		this.sectorDeposits = new Map(); // "gx_gy" → { depositId → ResourceDeposit }
		this.playerBags     = new Map(); // userId → ResourceBag
		this.bases          = new Map(); // "gx_gy" → Map("gx,gy" → { assetName, scale, rotation })

		const cx = CONSTANTS.SECTOR_SIZE * (CONSTANTS.SECTOR_GRID_W / 2);
		const cy = CONSTANTS.SECTOR_SIZE * (CONSTANTS.SECTOR_GRID_H / 2);

		for (const user of users) {
			const angle = Math.random() * Math.PI * 2;
			this.ships.set(user.id, {
				id: user.id, name: user.name,
				x: cx + Math.cos(angle) * 300,
				y: cy + Math.sin(angle) * 300,
				vx: 0, vy: 0,
				direction: angle,
				hp: 100, maxHp: 100,
				thrusting: false,
				input: {},
			});
			this.playerBags.set(user.id, new ResourceBag(500));
		}
	}

	// Lazily generate and cache deposits for a sector (matches client worldgen exactly)
	getSectorDeposits(gx, gy) {
		const key = `${gx}_${gy}`;
		if (!this.sectorDeposits.has(key)) {
			const { ores } = buildSector(gx, gy, CONSTANTS);
			const deps = {};
			for (const ore of ores) {
				deps[ore.id] = new ResourceDeposit({
					id: ore.id, resourceType: ore.type, x: ore.x, y: ore.y,
				});
			}
			this.sectorDeposits.set(key, deps);
		}
		return this.sectorDeposits.get(key);
	}

	// Returns { type, amount, depleted, bag } or null if invalid/out of range
	tryMine(userId, depositId) {
		const ship = this.ships.get(userId);
		if (!ship) return null;
		const [gx, gy] = depositId.split('_').map(Number);
		const dep = this.getSectorDeposits(gx, gy)[depositId];
		if (!dep || dep.depleted) return null;
		const dx = ship.x - dep.x, dy = ship.y - dep.y;
		if (dx * dx + dy * dy > 250 * 250) return null;
		const bag    = this.playerBags.get(userId);
		const mined  = dep.mine(5);
		if (mined > 0) bag.add(dep.resourceType, mined);
		return { depositId, type: dep.resourceType, amount: mined, depleted: dep.depleted, bag: { ...bag._contents } };
	}

	// Base building
	placeBuilding(sectorKey, gx, gy, assetName, scale, rotation) {
		if (!this.bases.has(sectorKey)) this.bases.set(sectorKey, new Map());
		this.bases.get(sectorKey).set(`${gx},${gy}`, { assetName, scale, rotation });
	}

	removeBuilding(sectorKey, gx, gy) {
		const base = this.bases.get(sectorKey);
		if (base) base.delete(`${gx},${gy}`);
	}

	getSectorBase(sectorKey) {
		const base = this.bases.get(sectorKey);
		if (!base || base.size === 0) return [];
		return [...base.entries()].map(([key, val]) => {
			const [gx, gy] = key.split(',').map(Number);
			return { gx, gy, ...val };
		});
	}

	applyInput(userId, input) {
		const ship = this.ships.get(userId);
		if (ship) ship.input = input;
	}

	tick(dt) {
		for (const ship of this.ships.values()) {
			const inp = ship.input || {};

			if (inp.turnLeft)  ship.direction -= TURN_RATE * dt;
			if (inp.turnRight) ship.direction += TURN_RATE * dt;

			if (inp.thrust) {
				ship.vx += Math.cos(ship.direction) * THRUST * dt;
				ship.vy += Math.sin(ship.direction) * THRUST * dt;
			}
			if (inp.brake) { ship.vx *= BRAKE_MUL; ship.vy *= BRAKE_MUL; }

			ship.vx *= DRAG;
			ship.vy *= DRAG;

			const spd = Math.sqrt(ship.vx ** 2 + ship.vy ** 2);
			if (spd > MAX_SPEED) {
				ship.vx = ship.vx / spd * MAX_SPEED;
				ship.vy = ship.vy / spd * MAX_SPEED;
			}

			ship.x += ship.vx * dt;
			ship.y += ship.vy * dt;
			ship.thrusting = !!inp.thrust;
		}
	}

	getState() {
		return {
			t: Date.now(),
			ships: [...this.ships.values()].map(
				({ id, name, x, y, vx, vy, direction, hp, maxHp, thrusting }) =>
				({ id, name, x, y, vx, vy, direction, hp, maxHp, thrusting })
			),
		};
	}
}

class User{
	static unique = 0;
	constructor(name,cb,ab,sg){
		this.name = name;
		this.id = User.unique++;
		this.in_lobby = true;
		this.request = cb;
		this.accept = ab;
		this.team = undefined;
		this.launch = sg;
		users.push(this);
	}
}

function updateUsers(){
	let users_in_lobby = users.filter(user=>user.in_lobby)
	io.emit('players',users_in_lobby);
}

let lastLoopTime = Date.now();

function loop() {
	const now = Date.now();
	const dt  = Math.min((now - lastLoopTime) / 1000, 0.1);
	lastLoopTime = now;

	for (const game of Game.games) {
		game.tick(dt);
		io.to('game_' + game.id).emit('gameState', game.getState());
	}
}

http.listen(port,()=>{console.log('Hosting at http://localhost:'+port)});

io.on('connection',socket=>{
	let logged_on = false;
	let me;
	let friends = [];
	let current_game;
	let playing = false;
	let team;
	function requestCallback(player){
		socket.emit('request_from',player);
	}
	function acceptCallback(player){
		if(!friends.includes(player)){
			friends.push(player);
			socket.emit('accepted',player);
		}
	}
	function startCallback(game){
		if(playing) return;
		playing = true;
		current_game = game;
		socket.join('game_' + game.id);
		socket.emit('start_game', { gameId: game.id, playerId: me.id });
		// Send current base state for all sectors that have buildings
		const baseState = {};
		for (const [sk, _] of game.bases) baseState[sk] = game.getSectorBase(sk);
		socket.emit('base:state', baseState);
		console.log(`${me.name} joined game ${game.id}`);
	}
	socket.on('accept', player => {
		const actual_player = users.find(e => e.id === player.id);
		if (!actual_player) return;
		// Tell the requester that me accepted (adds me to their friends list)
		actual_player.accept(me);
		// Also add them to MY friends list so either side can launch
		if (!friends.includes(actual_player)) {
			friends.push(actual_player);
			socket.emit('accepted', actual_player);
		}
	});
	socket.on('login',name=>{
		if(logged_on) return;
		me = new User(name,requestCallback,acceptCallback,startCallback);
		logged_on = true;
		friends.push(me);
		updateUsers();
	});
	socket.on('disconnect',()=>{
		if(!logged_on) return;
		users.splice(users.indexOf(me),1);
		updateUsers();
	});
	socket.on('request',id=>{
		let user = users.filter(e=>e.id==id);
		if(user.length){
			user = user[0];
			user.request(me);
			console.log(`Request from ${me.name} to ${user.name}`);
		} else{
			console.log(`Failed Request to ${id}.`);
		}
	});
	socket.on('playerInput', input => {
		if (!current_game) return;
		current_game.applyInput(me.id, input);
	});

	socket.on('mine', depositId => {
		if (!current_game) return;
		const result = current_game.tryMine(me.id, depositId);
		if (!result) return;
		if (result.depleted)
			io.to('game_' + current_game.id).emit('deposit:depleted', depositId);
		socket.emit('resources:update', result.bag);
	});

	socket.on('base:place', ({ sectorKey, gx, gy, assetName, scale, rotation }) => {
		if (!current_game) return;
		current_game.placeBuilding(sectorKey, gx, gy, assetName, scale, rotation);
		io.to('game_' + current_game.id).emit('base:placed', { sectorKey, gx, gy, assetName, scale, rotation });
	});

	socket.on('base:remove', ({ sectorKey, gx, gy }) => {
		if (!current_game) return;
		current_game.removeBuilding(sectorKey, gx, gy);
		io.to('game_' + current_game.id).emit('base:removed', { sectorKey, gx, gy });
	});
	socket.on('launch', () => {
		if (friends.length < 1) return;
		let g = new Game(friends);
		console.log(`Game ${g.id} started with: ${friends.map(f=>f.name).join(', ')}`);
		for (let p of friends) p.launch(g);
	});
});

setInterval(loop,1000/30);
