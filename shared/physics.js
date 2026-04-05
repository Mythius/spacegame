(function (root) {
  'use strict';

  // ── Vector2 ───────────────────────────────────────────────────────────────

  class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }

    add(v)       { return new Vector2(this.x + v.x, this.y + v.y); }
    sub(v)       { return new Vector2(this.x - v.x, this.y - v.y); }
    scale(s)     { return new Vector2(this.x * s,   this.y * s);   }
    dot(v)       { return this.x * v.x + this.y * v.y;             }
    length()     { return Math.sqrt(this.x * this.x + this.y * this.y); }
    lengthSq()   { return this.x * this.x + this.y * this.y;       }
    clone()      { return new Vector2(this.x, this.y);              }
    negate()     { return new Vector2(-this.x, -this.y);            }

    normalize() {
      const len = this.length();
      return len > 0 ? this.scale(1 / len) : new Vector2(0, 0);
    }

    angle() { return Math.atan2(this.y, this.x); }

    rotate(radians) {
      const c = Math.cos(radians), s = Math.sin(radians);
      return new Vector2(this.x * c - this.y * s, this.x * s + this.y * c);
    }

    // Mutating versions (faster in hot loops)
    addMut(v)   { this.x += v.x; this.y += v.y; return this; }
    scaleMut(s) { this.x *= s;   this.y *= s;   return this; }

    static fromAngle(radians, length = 1) {
      return new Vector2(Math.cos(radians) * length, Math.sin(radians) * length);
    }

    static distance(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    static distanceSq(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y;
      return dx * dx + dy * dy;
    }

    static lerp(a, b, t) {
      return new Vector2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }

    static zero()  { return new Vector2(0, 0); }
    static up()    { return new Vector2(0, -1); }
    static right() { return new Vector2(1, 0);  }
  }

  // ── AABB ──────────────────────────────────────────────────────────────────

  class AABB {
    constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }

    get left()   { return this.x; }
    get right()  { return this.x + this.w; }
    get top()    { return this.y; }
    get bottom() { return this.y + this.h; }
    get cx()     { return this.x + this.w / 2; }
    get cy()     { return this.y + this.h / 2; }

    intersects(other) {
      return this.left < other.right  && this.right  > other.left &&
             this.top  < other.bottom && this.bottom > other.top;
    }

    contains(px, py) {
      return px >= this.left && px <= this.right &&
             py >= this.top  && py <= this.bottom;
    }

    expand(amount) {
      return new AABB(this.x - amount, this.y - amount,
                      this.w + amount * 2, this.h + amount * 2);
    }

    static fromCenter(cx, cy, hw, hh) {
      return new AABB(cx - hw, cy - hh, hw * 2, hh * 2);
    }
  }

  // ── Collision helpers ─────────────────────────────────────────────────────

  function circleCircle(ax, ay, ar, bx, by, br) {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy <= (ar + br) * (ar + br);
  }

  function circleAABB(cx, cy, r, box) {
    const nearX = Math.max(box.left, Math.min(cx, box.right));
    const nearY = Math.max(box.top,  Math.min(cy, box.bottom));
    const dx = cx - nearX, dy = cy - nearY;
    return dx * dx + dy * dy <= r * r;
  }

  // Returns the normal and penetration depth if two circles overlap, else null
  function circleCircleResponse(ax, ay, ar, bx, by, br) {
    const dx = bx - ax, dy = by - ay;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const overlap = ar + br - dist;
    if (overlap <= 0) return null;
    return { nx: dx / dist, ny: dy / dist, depth: overlap };
  }

  // ── Sector boundary force ────────────────────────────────────────────────
  // Returns a Vector2 repulsion force when near sector edges.
  // sectorX/Y = world-space top-left of sector
  function sectorBoundaryForce(worldX, worldY, sectorX, sectorY, sectorSize, warnDist, maxForce) {
    const fx_list = [
      { dist: worldX - sectorX,              dir:  1 },  // left edge
      { dist: (sectorX + sectorSize) - worldX, dir: -1 }, // right edge
      { dist: worldY - sectorY,              dir:  1 },  // top edge (dir applied to y)
      { dist: (sectorY + sectorSize) - worldY, dir: -1 }, // bottom edge
    ];

    let fx = 0, fy = 0;
    for (let i = 0; i < 4; i++) {
      const { dist, dir } = fx_list[i];
      if (dist < warnDist) {
        const strength = (1 - dist / warnDist) * maxForce;
        if (i < 2) fx += dir * strength;
        else       fy += dir * strength;
      }
    }
    return new Vector2(fx, fy);
  }

  // ── Exports ───────────────────────────────────────────────────────────────

  const exports = { Vector2, AABB, circleCircle, circleAABB, circleCircleResponse, sectorBoundaryForce };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
