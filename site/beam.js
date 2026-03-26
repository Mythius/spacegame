// Beam — layered laser/energy beam for turret effects
//
// JSON format:
//   { name, drawMode: 'immediate'|'continuous', drawSpeed: px/s,
//     layers: [{ type: 'line'|'sin'|'zigzag', color, thickness, opacity,
//                amplitude, wavelength }] }
//
// Usage:
//   const beam = new Beam(config);          // config from JSON
//   beam.start(x, y, directionRadians);     // begin firing
//   beam.update(dt);                         // call each frame (dt = seconds)
//   beam.draw(ctx);                          // render
//   beam.stop();                             // stop firing

class Beam {
	constructor(config) {
		this.name      = config.name      || 'beam';
		this.drawMode  = config.drawMode  || 'immediate';
		this.drawSpeed = config.drawSpeed || 600;
		this.layers    = (config.layers   || []).map(l => ({ ...l }));

		this._x = 0; this._y = 0; this._dir = 0;
		this._len    = 0;
		this._max    = 4000;
		this._active = false;
		this._phase  = 0;
	}

	// Start firing from world coords (x, y) in direction (radians, 0 = right)
	start(x, y, direction) {
		this._x = x; this._y = y; this._dir = direction;
		this._active = true;
		this._phase  = 0;
		this._len    = this.drawMode === 'immediate' ? this._max : 0;
	}

	stop() {
		this._active = false;
		this._len = 0;
	}

	// dt = seconds since last frame
	update(dt) {
		if (!this._active) return;
		if (this.drawMode === 'continuous' && this._len < this._max) {
			this._len = Math.min(this._max, this._len + this.drawSpeed * dt);
		}
		this._phase += dt * 4;
	}

	draw(ctx) {
		if (!this._active || this._len <= 0) return;
		ctx.save();
		ctx.translate(this._x, this._y);
		ctx.rotate(this._dir);
		for (const layer of this.layers) Beam._drawLayer(ctx, layer, this._len, this._phase);
		ctx.restore();
	}

	static _drawLayer(ctx, layer, len, phase) {
		ctx.save();
		ctx.globalAlpha  = layer.opacity !== undefined ? layer.opacity : 1;
		ctx.strokeStyle  = layer.color     || '#ffffff';
		ctx.lineWidth    = layer.thickness || 2;
		ctx.lineCap      = 'square';
		ctx.lineJoin     = 'miter';
		ctx.shadowColor  = layer.color     || '#ffffff';
		ctx.shadowBlur   = (layer.thickness || 2) * 4 + 6;
		ctx.beginPath();

		const amp = layer.amplitude    || 10;
		const wl  = Math.max(layer.wavelength || 60, 1);
		const ss  = layer.shiftSpeed  !== undefined ? layer.shiftSpeed  : 1;
		const po  = layer.phaseOffset !== undefined ? layer.phaseOffset : 0;

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
}
