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

function getPickerColor(){
	return obj('#color-picker').value;
}

class Shape{
	constructor(){
		this.segments = [[]];
		this.segmentColors = [getPickerColor()];
	}
	currentSegment(){
		return this.segments[this.segments.length-1];
	}
	addPoint(point){
		this.currentSegment().push(point);
	}
	breakPath(){
		if(this.currentSegment().length > 0){
			this.segments.push([]);
			this.segmentColors.push(getPickerColor());
		}
	}
	undoPoint(){
		let seg = this.currentSegment();
		seg.pop();
		if(seg.length === 0 && this.segments.length > 1){
			this.segments.pop();
			this.segmentColors.pop();
		}
		let cur = this.currentSegment();
		last_point = cur.length > 0 ? cur[cur.length-1] : null;
	}
	close(){
		let first = this.segments[0][0];
		let allPts = this.segments.flat();
		if(allPts.length > 2 && first){
			this.currentSegment().push(first);
			last_point = first;
		}
	}
	// liveColor: overrides the active segment's color (used while drawing)
	// highlight: draws all segments in neon yellow for hover effect
	draw(liveColor=null, highlight=false){
		let allPts = this.segments.flat();
		if(allPts.length === 0) return;

		for(let i=0;i<this.segments.length;i++){
			let seg = this.segments[i];
			if(seg.length === 0) continue;
			let color = highlight ? '#ccff00'
				: (liveColor && i === this.segments.length-1) ? liveColor
				: this.segmentColors[i];
			ctx.beginPath();
			ctx.strokeStyle = color;
			ctx.lineWidth = highlight ? 9 : 6;
			ctx.moveTo(seg[0].x,seg[0].y);
			for(let j=1;j<seg.length;j++) ctx.lineTo(seg[j].x,seg[j].y);
			ctx.stroke();
		}
	}
}

let current_shape = new Shape();
let shapes = [];
let last_point;
let hoveredShapeIndex = null;

const center = new Vector(canvas.width/2,canvas.height/2);

// 0 = grid corners, 1 = edge midpoints, 2 = cell centers
let snapMode = 0;
const SNAP_NAMES = ['Grid corners', 'Edge midpoints', 'Cell centers'];

// 0 = grid + centerpoint, 1 = clean (no grid, no center), 2 = blueprint
let gridMode = 0;
const GRID_MODE_NAMES = ['Grid + Center', 'Clean', 'Blueprint'];
const BLUEPRINT_BG   = '#001f4d';
const BLUEPRINT_GRID = 'rgba(100,160,255,0.35)';

function adjustMouse(){
	if(snapMode === 0){
		MOUSE.pos.x = Math.round(MOUSE.pos.x / tw) * tw;
		MOUSE.pos.y = Math.round(MOUSE.pos.y / th) * th;
	} else if(snapMode === 1){
		// nearest edge midpoint — either (corner_x, half_y) or (half_x, corner_y)
		let cornerX  = Math.round(MOUSE.pos.x / tw) * tw;
		let cornerY  = Math.round(MOUSE.pos.y / th) * th;
		let halfX    = Math.floor(MOUSE.pos.x / tw) * tw + tw/2;
		let halfY    = Math.floor(MOUSE.pos.y / th) * th + th/2;
		let dHoriz   = Math.hypot(MOUSE.pos.x - cornerX, MOUSE.pos.y - halfY);
		let dVert    = Math.hypot(MOUSE.pos.x - halfX,   MOUSE.pos.y - cornerY);
		if(dHoriz <= dVert){
			MOUSE.pos.x = cornerX;
			MOUSE.pos.y = halfY;
		} else {
			MOUSE.pos.x = halfX;
			MOUSE.pos.y = cornerY;
		}
	} else {
		MOUSE.pos.x = Math.floor(MOUSE.pos.x / tw) * tw + tw/2;
		MOUSE.pos.y = Math.floor(MOUSE.pos.y / th) * th + th/2;
	}
}

function loop(){
	adjustMouse();
	ctx.clearRect(-2,-2,canvas.width+2,canvas.height+2);

	if(gridMode === 2){
		ctx.fillStyle = BLUEPRINT_BG;
		ctx.fillRect(0,0,canvas.width,canvas.height);
		drawGrid(25,25);
	} else if(gridMode === 0){
		drawGrid(25,25);
	}

	for(let i=0;i<shapes.length;i++) shapes[i].draw(null, i===hoveredShapeIndex);
	current_shape.draw(getPickerColor());
	if(last_point){
		drawPoint(last_point,5,'green');
	}
	drawPoint(MOUSE.pos,5,'blue');
	if(gridMode !== 1) drawPoint(center,10,'white');
	let dir = Line.getDir(center.x-MOUSE.pos.x,center.y-MOUSE.pos.y);
	let gx = Math.round((MOUSE.pos.x - center.x) / tw * 10) / 10;
	let gy = Math.round((center.y - MOUSE.pos.y) / th * 10) / 10;
	obj('p').innerHTML = `angle: ${Math.round(dir*10)/10}°  &nbsp; x: ${gx}  y: ${gy}`;
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
			ctx.strokeStyle = gridMode === 2 ? BLUEPRINT_GRID : 'white';
			ctx.rect(x,y,tw,th);
			ctx.stroke();
		}
	}
}

document.on('mousedown',e=>{
	if(e.target !== canvas) return;
	adjustMouse();
	if(e.which != 1) return;
	last_point = new Vector(MOUSE.pos.x,MOUSE.pos.y);
	current_shape.addPoint(last_point);
});
document.on('contextmenu',e=>{
	if(e.target == canvas){
		current_shape.close();
		current_shape.segmentColors[current_shape.segmentColors.length-1] = getPickerColor();
		shapes.push(current_shape);
		current_shape = new Shape();
		e.preventDefault();
		last_point = null;
		updateShapesPanel();
	}
});
document.on('keydown',e=>{
	if(e.key == ' '){
		current_shape.close();
	} else if(e.key == 'x' || (e.ctrlKey && e.key == 'z')){
		current_shape.undoPoint();
	} else if(e.key == 'v'){
		if(current_shape.segments.flat().length > 0){
			current_shape.segmentColors[current_shape.segmentColors.length-1] = getPickerColor();
			shapes.push(current_shape);
			current_shape = new Shape();
			updateShapesPanel();
		}
		last_point = null;
	} else if(e.key == 'g'){
		gridMode = (gridMode + 1) % 3;
		obj('#grid-label').textContent = GRID_MODE_NAMES[gridMode];
	} else if(e.key == 'c'){
		snapMode = (snapMode + 1) % 3;
		obj('#snap-label').textContent = SNAP_NAMES[snapMode];
	} else if(e.key == 's'){
		save();
	} else if(e.key == 'f'){
		shapes.pop();
		updateShapesPanel();
	} else if(e.key == 'i'){
		obj('#import-input').click();
	}
});

// ── Shapes panel ─────────────────────────────────────────────────────────────

function updateShapesPanel(){
	let list = obj('#shapes-list');
	list.innerHTML = '';
	shapes.forEach((shape, si) => {
		let row = document.createElement('div');
		row.className = 'shape-row';

		let label = document.createElement('span');
		label.className = 'shape-index';
		label.textContent = `#${si+1}`;
		row.appendChild(label);

		let colorWrap = document.createElement('div');
		colorWrap.className = 'seg-colors';
		shape.segmentColors.forEach((color, ci) => {
			let inp = document.createElement('input');
			inp.type = 'color';
			inp.value = color;
			inp.className = 'seg-color-inp';
			inp.title = `Segment ${ci+1} color`;
			inp.addEventListener('input', e => {
				shapes[si].segmentColors[ci] = e.target.value;
			});
			colorWrap.appendChild(inp);
		});
		row.appendChild(colorWrap);

		let del = document.createElement('button');
		del.className = 'shape-delete';
		del.textContent = '✕';
		del.addEventListener('click', () => {
			shapes.splice(si, 1);
			updateShapesPanel();
		});
		row.appendChild(del);

		row.addEventListener('mouseenter', () => { hoveredShapeIndex = si; });
		row.addEventListener('mouseleave', () => { hoveredShapeIndex = null; });

		list.appendChild(row);
	});
}

// ── Save ──────────────────────────────────────────────────────────────────────

function pointToPolar(point){
	let a = Math.round(Line.getDir(center.x-point.x, center.y-point.y) * 10) / 10;
	let d = Math.round(Line.distance(center.x,center.y,point.x,point.y) / tw * 100) / 100;
	return {a, d};
}

function save(){
	let file_data = [];
	for(let shape of shapes){
		let shape_segs = [];
		for(let i=0;i<shape.segments.length;i++){
			let seg = shape.segments[i];
			if(seg.length === 0) continue;
			let len = (seg.length > 1 && seg[seg.length-1] === seg[0]) ? seg.length-1 : seg.length;
			shape_segs.push({
				color: shape.segmentColors[i],
				points: seg.slice(0,len).map(pointToPolar)
			});
		}
		if(shape_segs.length > 0) file_data.push(shape_segs);
	}
	download('untitled.json',JSON.stringify(file_data));
}

// ── Import ────────────────────────────────────────────────────────────────────

function polarToCanvas(p){
	let dist = p.d * tw;
	let rad = p.a * Math.PI / 180;
	let x = center.x + Math.cos(rad) * dist;
	let y = center.y + Math.sin(rad) * dist;
	return new Vector(x, y);
}

function loadJSON(json_str){
	let data = JSON.parse(json_str);
	shapes = [];
	for(let shape_data of data){
		let shape = new Shape();
		shape.segments = [];
		shape.segmentColors = [];
		// detect format: new [{color,points}] vs old (array of point arrays or flat points)
		let isSegmented = shape_data.length > 0 && Array.isArray(shape_data[0]);
		let isColored   = shape_data.length > 0 && !Array.isArray(shape_data[0]) && shape_data[0].color !== undefined;

		if(isColored){
			// current format: [{color, points}, ...]
			for(let seg_data of shape_data){
				shape.segments.push(seg_data.points.map(polarToCanvas));
				shape.segmentColors.push(seg_data.color);
			}
		} else if(isSegmented){
			// previous format: [[{a,d},...], ...]
			for(let seg_data of shape_data){
				shape.segments.push(seg_data.map(polarToCanvas));
				shape.segmentColors.push('#ffffff');
			}
		} else {
			// oldest format: [{a,d},...]
			shape.segments.push(shape_data.map(polarToCanvas));
			shape.segmentColors.push('#ffffff');
		}
		shapes.push(shape);
	}
	updateShapesPanel();
}

// hidden file input for import
let importInput = document.createElement('input');
importInput.type = 'file';
importInput.accept = '.json';
importInput.id = 'import-input';
importInput.style.display = 'none';
document.body.appendChild(importInput);
importInput.on('change', e=>{
	let file = e.target.files[0];
	if(!file) return;
	let reader = new FileReader();
	reader.onload = ev => loadJSON(ev.target.result);
	reader.readAsText(file);
	importInput.value = '';
});


setInterval(loop,1000/30);
