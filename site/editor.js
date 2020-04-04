const canvas = obj('canvas');
const ctx = canvas.getContext('2d');

canvas.width = 600;
canvas.height = 600;


let tw,th;

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
	constructor(x1,y1,x2,y2){
		this.pointA = new Vector(x1,y1);
		this.pointB = new Vector(x2,y2);
	}
	draw(color='white'){
		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.lineWidth = 2;
		ctx.moveTo(this.pointA.x,this.pointA.y);
		ctx.lineTo(this.pointB.x,this.pointB.y);
		ctx.stroke();
	}
}

class Shape{
	constructor(){
		this.points = [];
	}
	addPoint(point){
		this.points.push(point);
	}
	close(){
		if(this.points.length>2){
			this.points.push(this.points[0]);
			last_point = this.points[0];
		}
	}
	draw(color='green',fill=false){
		if(this.points.length == 0) return;
		ctx.beginPath();
		ctx.strokeStyle = color;
		ctx.moveTo(this.points[0].x,this.points[0].y);
		for(let i=1;i<this.points.length;i++){
			ctx.lineTo(this.points[i].x,this.points[i].y);
		}
		ctx.stroke();
		ctx.fillStyle = '#444';
		if(fill) ctx.fill();
		ctx.closePath();
	}
}

let current_shape = new Shape();
let shapes = [];
let last_point;

const center = new Vector(canvas.width/2,canvas.height/2);

let corners = true;

function adjustMouse(){
	if(!corners){
		MOUSE.pos.x = Math.floor(MOUSE.pos.x / tw ) * tw + tw/2; 
		MOUSE.pos.y = Math.floor(MOUSE.pos.y / th ) * th + th/2;
	} else {
		MOUSE.pos.x = Math.round(MOUSE.pos.x / tw) * tw;
		MOUSE.pos.y = Math.round(MOUSE.pos.y / th) * th;
	}
}

function loop(){
	adjustMouse();
	ctx.clearRect(-2,-2,canvas.width+2,canvas.height+2);
	drawGrid(25,25);
	ctx.lineWidth = 6;
	for(let s of shapes) s.draw('cyan',true);
	current_shape.draw('red');
	if(last_point){
		drawPoint(last_point,5,'green');
	}
	drawPoint(MOUSE.pos,5,'blue');
	drawPoint(center,10,'white');
	let dir = Line.getDir(center.x-MOUSE.pos.x,center.y-MOUSE.pos.y);
	obj('p').innerHTML = dir;
}

function drawPoint(vector,radius,color){
	ctx.beginPath();
	ctx.fillStyle = color;
	ctx.arc(vector.x,vector.y,radius,0,Math.PI*2);
	ctx.fill();
}

function drawGrid(w,h){
	tw = canvas.width / w;
	th = canvas.height / h;
	for(let x=0;x<canvas.width;x+=tw){
		for(let y=0;y<canvas.height;y+=th){
			ctx.beginPath();
			ctx.lineWidth = 1;
			ctx.strokeStyle = 'white';
			ctx.rect(x,y,tw,th);
			ctx.stroke();
		}
	}
}

document.on('mousedown',e=>{
	adjustMouse();
	if(e.which != 1) return;
	last_point = new Vector(MOUSE.pos.x,MOUSE.pos.y);
	current_shape.addPoint(last_point);
});
document.on('contextmenu',e=>{
	if(e.target == canvas){
		shapes.push(current_shape);
		current_shape = new Shape();
		e.preventDefault();
		last_point = null;
	}
});
document.on('keydown',e=>{
	if(e.key == ' ' ){
		current_shape.close();
	} else if (e.key == 'd'){
		current_shape.points.pop();
		last_point = current_shape.points[current_shape.points.length-1];
	} else if (e.key == 'c'){
		corners = !corners;
	} else if (e.key == 's'){
		save();
	} else if (e.key == 'f'){
		shapes.pop();
	}
});

function save(){
	let file_data = [];
	for(let shape of shapes){
		let shape_arr = [];
		for(let point of shape.points){
			let dir = Line.getDir(center.x-point.x,center.y-point.y);
			let dist = Line.distance(center.x,center.y,point.x,point.y);
			shape_arr.push({a:dir,d:dist});
		}
		file_data.push(shape_arr);
	}
	download('untitled.json',JSON.stringify(file_data));
}


setInterval(loop,1000/30);