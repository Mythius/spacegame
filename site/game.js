const canvas = obj('canvas');
const ctx = canvas.getContext('2d');


class DO{ // Drawable Object
	static getXY(dt,offset,oa=0){
		let x = offset.x + dt.d * Math.cos((dt.a+oa)*Math.PI/180);
		let y = offset.y + dt.d * Math.sin((dt.a+oa)*Math.PI/180);
		return {x,y};
	}
	constructor(objdata){
		this.objdata = objdata;
		this.offset = {x:200,y:200};
		this.offsetAngle = 0;
	}
	draw(color='white'){
		for(let shape of this.objdata){
			if(shape.length == 0) continue;
			debugger;
			let sp = DO.getXY(shape[0],this.offset,this.offsetAngle);
			ctx.beginPath();
			ctx.strokeStyle = 'black';
			ctx.fillStyle = 
			ctx.lineWidth = 4;
			ctx.fillStyle = color;
			ctx.moveTo(sp.x,sp.y);
			for(let i=0;i<shape.length+1;i++){
				let sh = shape[i%shape.length];
				let np = DO.getXY(sh,this.offset,this.offsetAngle);
				ctx.lineTo(np.x,np.y);
			}
			ctx.fill();
			ctx.stroke();
		}
	}
}

canvas.width = 850;
canvas.height = 600;

let once = true;

let a = 0;

socket.on('render',data=>{
	if(typeof game_id != 'number') return;
	ctx.clearRect(-2,-2,canvas.width+2,canvas.height+2);
	let dt = data[game_id].teams[0].mothership.image_data;
	if(once){
		console.log(dt)
		once = false;
	}
	// return;
	let ms = new DO(dt);
	ms.offsetAngle = (a++)%360;
	ms.draw(color);
});

