class PolarObject {
	constructor(path) {
		this.x = 0;
		this.y = 0;
		this.scale = 1;
		this.direction = 0;
		this.flipH = false;
		this.flipV = false;
		this.visible = false;
		this._shapes = [];
		this.loaded = false;
		this.onload = null;

		fetch(path)
			.then(r => r.json())
			.then(data => {
				this._load(data);
				this.loaded = true;
				if(this.onload) this.onload();
			});
	}

	_load(data){
		this._shapes = [];
		for(let shape_data of data){
			let closed = false;
			let segs;
			// format: { closed, segs: [{color, points}] }
			if(shape_data && shape_data.segs){
				closed = !!shape_data.closed;
				segs = shape_data.segs;
			// format: [{color, points}, ...]
			} else if(Array.isArray(shape_data)){
				segs = shape_data;
			} else {
				continue;
			}
			this._shapes.push({ closed, segs });
		}
	}

	// convert a polar point {a, d} to canvas coords relative to this object
	_toCanvas(a, d){
		let rad = (a + this.direction) * Math.PI / 180;
		let lx = Math.cos(rad) * d * this.scale;
		let ly = Math.sin(rad) * d * this.scale;
		if (this.flipH) lx = -lx;
		if (this.flipV) ly = -ly;
		return { x: this.x + lx, y: this.y + ly };
	}

	show(){ this.visible = true; }
	hide(){ this.visible = false; }

	render(ctx){
		if(!this.visible || !this.loaded) return;
		for(let shape of this._shapes){
			for(let i = 0; i < shape.segs.length; i++){
				let seg = shape.segs[i];
				if(!seg.points || seg.points.length === 0) continue;
				ctx.beginPath();
				ctx.strokeStyle = seg.color || '#ffffff';
				ctx.lineWidth = 2;
				let first = this._toCanvas(seg.points[0].a, seg.points[0].d);
				ctx.moveTo(first.x, first.y);
				for(let j = 1; j < seg.points.length; j++){
					let pt = this._toCanvas(seg.points[j].a, seg.points[j].d);
					ctx.lineTo(pt.x, pt.y);
				}
				if(shape.closed && i === shape.segs.length - 1) ctx.closePath();
				ctx.stroke();
			}
		}
	}

	getBoundingBox(){
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for(let shape of this._shapes){
			for(let seg of shape.segs){
				for(let pt of seg.points){
					let c = this._toCanvas(pt.a, pt.d);
					if(c.x < minX) minX = c.x;
					if(c.y < minY) minY = c.y;
					if(c.x > maxX) maxX = c.x;
					if(c.y > maxY) maxY = c.y;
				}
			}
		}
		if(minX === Infinity) return { x: this.x, y: this.y, width: 0, height: 0 };
		return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
	}
}
