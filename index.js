const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const fs = require('fs');
const system = require('child_process');


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

const port = 80;
const path = __dirname+'/';

app.use(express.static(path+'site/'));

app.get(/.*/,function(request,response){
	response.sendFile(path+'site/');
});

var users = [];

class Game{
	static games = [];
	static next_id = 0;
	constructor(users){
		Game.games.push(this);
		this.id = Game.next_id++;
		this.space = new Space();
		let sectors = [{x:0,y:0},{x:7,y:0},{x:7,y:7},{x:0,y:7}];
		let colors = ['orange','green','cyan','gold'];
		this.users = users;
		this.things = [];
		this.teams = [];
		this.userInput = [];
		for(let i=0;i<4;i++){
			let team = new Team(colors[i],users[i].name,this.space.getSectorAt(sectors[i].x,sectors[i].y),users[i]);
			this.teams.push(team);
			// users[i].team = team; CAUSES STACK OVERFLOW
		}
	}
	parseInput(){
		for(let team of this.teams){
			// For structure data see Game.input
			let usrinpt = this.userInput.filter(data=>data.user == team.user);
			if(usrinpt) usrinpt = usrinpt[0];
			else continue;
			team.mothership.update(usrinpt.input);
		}
	}
	input(user,input){
		this.userInput.push({user,input});
	}
}

class Vector{
	constructor(x,y){
		this.x = x;
		this.y = y;
	}
}

class Line{
	static radians(deg){return deg*Math.PI/180}
	static distance(x1,y1,x2,y2){return Math.sqrt((x2-x1)**2+(y2-y1)**2)}
	static getDir(x,y){return(Math.atan(y/x)+(x<0?0:Math.PI))*180/Math.PI}
	static getPointIn(dir,dist,ox=0,oy=0){
		let x = ox + Math.cos(dir) * dist;
		let y = oy + Math.sin(dir) * dist;
		return new Vector(x,y);
	}
	constructor(px1,py1,px2,py2){
		this.pointA = new Vector(px1,py1);
		this.pointB = new Vector(px2,py2);
	}
	setPos(px1,py1,px2,py2){
		this.pointA.x = px1;
		this.pointA.y = py1;
		this.pointB.x = px2;
		this.pointB.y = py2;
	}
	touches(line){
		const x1 = this.pointA.x;
		const y1 = this.pointA.y;
		const x2 = this.pointB.x;
		const y2 = this.pointB.y;
		const x3 = line.pointA.x;
		const y3 = line.pointA.y;
		const x4 = line.pointB.x;
		const y4 = line.pointB.y;

		const den=(x1-x2)*(y3-y4)-(y1-y2)*(x3-x4);

		if(den==0) return;

		const t=((x1-x3)*(y3-y4)-(y1-y3)*(x3-x4))/den;
		const u=-((x1-x2)*(y1-y3)-(y1-y2)*(x1-x3))/den;

		if(t>=0&&t<=1&&u>=0&&u<=1){
			const pt = new Vector();

			pt.x=x1+t*(x2-x1);
			pt.y=y1+t*(y2-y1);

			return pt;
		} else return;
	}
}

class Sector{
	static size = 600;
	constructor(tx,ty){
		this.x = tx;
		this.y = ty;
	}
	hasPoint(x,y){
		let size = Sector.size;
		return x>=this.x*size&&x<this.x*size+size&&y>=this.y*size&&y<this.y*size+size;
	}
}

class Thing{
	constructor(position,speed,direction,name){
		this.position = position;
		this.speed = speed;
		this.direction = direction;
		this.name = name;
		this.color = 'white';
		this.alive = true;
	}
	loadImageVector(path){
		if(typeof path == 'string'){
			file.read(__dirname+'/'+path,text=>{
				try{
					// NOTE TO SELF:
					// Image saved as JSON, 2D array
					// Each sub-array is a new path
					// Each element should have a distance / direction 
					// from the center (radial geometry)
					let paths = JSON.parse(text);
					this.image_data = paths;
				} catch(e){
					console.log(e);
				}
			});
		} else {
			this.image_data = path;
		}
	}
	update(target){
		let x = this.position.x;
		let y = this.position.y;
		if(target instanceof 'Vector'){ // turn towards target if targed moved
			let new_direction = Line.getDir(target.x-x,target.y-y);
			this.direction = new_direction;
		}
		let nextPosition = Line.getPointIn(this.direction,this.speed,x,y);
		this.position.x = nextPosition.x;
		this.position.y = nextPosition.y;
	}
}

class Team{
	static max_ship_count = 200;
	constructor(color,name,start_sector,user){
		this.user = user;
		this.color = color;
		this.name = name;
		this.mothership = new Mothership(new Vector(start_sector.x,start_sector.y),0,0);
		this.ships = [];
		this.bullets = [];
	}
	addShip(name,health,max_speed,reload_speed,bullet_damage,max_cargo,bullet_speed){
		if(this.mothership.hanger.length >= Team.max_ship_count) return false;
		let ship = new Ship(this.mothership.position,0,0,name);
		ship.max_speed = max_speed;
		ship.reload_speed = reload_speed;
		ship.bullet_damage = bullet_damage;
		ship.max_cargo = max_cargo;
		ship.bullet_speed = bullet_speed;
		ship.health = health;
		ship.team = this;
		ship.color = this.color;
		ship.visible = false;
		this.mothership.hanger.push(ship);
		this.ships.push(ship);
		Team.teams.push(this);
		return true;
	}
}

class Bullet extends Thing{
	constructor(...args){
		super(...args);
		this.bullet_damage = 1;
		this.team = null;
		this.visible = true;
	}
}

class Ship extends Thing{
	constructor(...args){
		super(...args);
		this.reload_speed = 5; // in frames
		this.reload = 0;
		this.health = 20;
		this.bullet_damage = 1;
		this.bullet_speed = 5;
		this.team = null;
		this.cargo = [];
		this.max_cargo = 0;
		this.selected = false;
		this.max_speed = 10;
	}
	assignTask(procedure){
		this.procedure = procedure;
	}
	shoot(){
		if(this.reload != 0) return;
		this.reload = this.reload_speed;
		let b = new Bullet(this.position,this.bullet_speed,this.direction);
		b.team = this.team;
		b.color = this.color;
		this.team.bullets.push(b);
	}
	update(task=0,target){
		switch(task){
			case 0: break;
			case 1: this.shoot(); break;
			case 2: this.dropBomb(); break;
		}
		this.reload = Math.max(this.reload-1,0);
		super.update(target);
	}
}

class Mothership extends Ship{
	constructor(...args){
		super(...args);
		this.hanger = [];
		this.max_cargo = 2000;
		this.loadImageVector('assets/mythius.json');
		// this.team = team;
	}
	buildShips(ships){
		this.hanger = this.hanger.append(ships);
	}
	update(userInput){
		super.update() // probably unnecisary because speed 0
		// example of userInput (JSON)
		// {
		// 	selectedShips: [Ship,Ship,Ship,Ship] (Must send selected ships every tick or they get unselected)
		//  mission: "String"
		//  shipsToBuild: {number:"Number",stats: { @Param for Team.addShip } }
		//  useWeapon: {active: "Boolean", sector: "Sector"}
		//  view: {sector:"Sector",offset:"Vector"}
		//  trade: {material:"Material",amount:"Number",from:"TradingPost"}
		//  chat: "String"
		//  
		// }
	}
}

class Asteroid extends Thing{
}

class Bomb extends Thing{
	constructor(wait,radius,...args){
		super(...args);
		this.countdown = wait;
		this.speed = 0;
	}
	update(target){
		super.update(target);
		this.countdown--;
		if(this.countdown == 0){
			// TODO: Explode
		}
	}
}

class Space{
	static width = 8;
	static height = 8;
	static team_count = 4;
	constructor(){
		this.sectors = [];
		for(let x=0;x<Space.width;x++){
			let col = [];
			for(let y=0;y<Space.height;y++){
				col.push(new Sector(x,y));
			}
			this.sectors.push(col);
		}
		// Hopefully Removing this doesn't cause issues
		// this.teams = [];
		// let start_sectors = []
		// for(let i=0;i<Space.team_count;i++){

		// }
	}
	forEach(callback){
		for(let col of this.sectors){
			for(let sector of col){
				let stop = callback(sector);
				if(stop) return;
			}
		}
	}
	getSectorWithPoint(point){
		if(!point instanceof 'Vector') return;
		let result;
		this.forEach(sector=>{
			if(sector.hasPoint(point.x,point.y)){
				result = sector;
				return true; // Stop search when found
			}
		});
		return result;
	}
	getSectorAt(x,y){
		if(x>=0&&x<Space.width&&y>=0&&y<Space.height){
			return this.sectors[x][y];
		}
	}
}

class TradingPost{
}

class Material{
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

function loop(){
	io.emit('render',Game.games);
	for(let game of Game.games){
		updateGame(game);
	}
	io.emit('getInput');
}

function updateGame(game){
}

http.listen(port,()=>{console.log('Serving Port: '+port)});

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
		let t = game.teams.filter(e=>e.user == me)[0];
		team = t;
		socket.emit('start_game',{id:game.id,team:t});
		console.log(t);
		console.log(`${me.name} is in party.`);
	}
	socket.on('accept',player=>{
		let actual_player = users.filter(e=>e.id == player.id);
		if(actual_player.length){
			actual_player = actual_player[0];
			actual_player.accept(me);
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
	socket.on('input',input_data=>{
		if(!current_game) return;
		current_game.input(me,input_data);
	});
	socket.on('launch',()=>{
		if(friends.length != 4){
			// TODO: Send Do Stuff
			console.log('Need 4 People');
			console.log(friends);
			return;
		}
		let g = new Game(friends);
		console.log(`Party Started`);
		for(let p of friends){
			p.launch(g);
		}
	});
});

setInterval(loop,1000/30);