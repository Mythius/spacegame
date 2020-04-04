var socket = io();

let logged_in = false;
let game_started = false;
let game_id,color,team;

obj('#name').focus();

obj('#launch').on('click',launch);

document.on('keydown',e=>{
	if(e.key == 'Enter') login();
});


document.on('click',launch);

function launch(e){
	if(e.target != obj('#launch')) return;
	if(logged_in && !game_started){
		socket.emit('launch');
	}
}

function login(){
	if(logged_in) return;
	let name = obj('#name').value;
	if(name.length == 0) name = "Unamed";
	socket.emit('login',name);
	hide(obj('login'));
	logged_in = true;
	show(obj('lobby'));
	obj('lobby').style.opacity = .8;
	// document.documentElement.requestFullscreen();
}

socket.on('players',players=>{
	let list = obj('#players');
	let children = list.children;
	let child_count = children.length;
	while(child_count--) children[child_count].remove();
	for(let player of players){
		let li = create('li',player.name);
		li.on('click',e=>{
			socket.emit('request',player.id);
		});
		list.appendChild(li);
	}
});

socket.on('request_from',player=>{
	let div = create('request',`Request to Join from ${player.name} `);
	let a = create('button','Join');
	let b = create('button','Decline');
	div.appendChild(a);
	div.appendChild(b);
	div.appendChild(create('br'));
	a.on('click',e=>{
		socket.emit('accept',player);
		div.remove();
	});
	b.on('click',e=>{
		div.remove();
	});
	obj('main').appendChild(div);
});

socket.on('accepted',player=>{
	obj('main').innerHTML += player.name + ' joined party!<br>';
});

socket.on('start_game',(gdata)=>{
	hide(obj('lobby'));
	show(obj('game'));
	game_id = gdata.id;
	team = gdata.team;
	color = gdata.team.color;
});

// hide(obj('login'));
hide(obj('lobby'));
hide(obj('game'));