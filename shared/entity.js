(function (root) {
  'use strict';

  // Requires physics.js to be loaded first (Vector2)
  const _physics = typeof module !== 'undefined' ? require('./physics') : root;
  const Vector2  = _physics.Vector2;

  let _nextId = 1;

  // ── Entity — base class for everything in the world ───────────────────────
  class Entity {
    constructor(config = {}) {
      this.id        = config.id        || (_nextId++);
      this.type      = config.type      || 'entity';
      this.position  = config.position  instanceof Vector2
                       ? config.position.clone()
                       : new Vector2(config.x || 0, config.y || 0);
      this.velocity  = new Vector2(0, 0);
      this.direction = config.direction || 0;   // radians, 0 = right
      this.alive     = true;
      this.sectorId  = config.sectorId  || null; // which sector this entity is in
    }

    // Override in subclasses. dt = seconds since last tick.
    update(dt) {
      this.position.addMut(this.velocity.scale(dt));
    }

    // Destroy this entity (remove from world next tick)
    destroy() { this.alive = false; }

    // Minimal tick-state for 30fps network broadcast (override for more fields)
    serializeTick() {
      return {
        id:  this.id,
        x:   Math.round(this.position.x),
        y:   Math.round(this.position.y),
        dir: +this.direction.toFixed(3),
        vx:  +this.velocity.x.toFixed(1),
        vy:  +this.velocity.y.toFixed(1),
      };
    }

    // Full state for initial load / reconnect
    serialize() {
      return { ...this.serializeTick(), type: this.type, sectorId: this.sectorId };
    }

    static resetIds() { _nextId = 1; }
    static peekNextId() { return _nextId; }
  }

  // ── Avatar — the physical player character ────────────────────────────────
  class Avatar extends Entity {
    constructor(config = {}) {
      super({ ...config, type: 'avatar' });
      this.playerId   = config.playerId   || null;
      this.health     = config.health     || 100;
      this.maxHealth  = config.maxHealth  || 100;
      this.speed      = config.speed      || 150;       // units/s
      this.insideShip = config.insideShip || null;      // ship id if inside
      this.onPlanet   = config.onPlanet   || null;      // planet id if on surface
      this.weapon     = config.weapon     || null;      // active Weapon instance
      this.facing     = config.facing     || 0;         // radians (independent of movement)
    }

    takeDamage(amount) {
      this.health = Math.max(0, this.health - amount);
      if (this.health === 0) this.destroy();
    }

    heal(amount) {
      this.health = Math.min(this.maxHealth, this.health + amount);
    }

    serializeTick() {
      return {
        ...super.serializeTick(),
        hp:     this.health,
        facing: +this.facing.toFixed(3),
        inside: this.insideShip,
      };
    }
  }

  // ── Projectile — fired by weapons ─────────────────────────────────────────
  class Projectile extends Entity {
    constructor(config = {}) {
      super({ ...config, type: 'projectile' });
      this.damage        = config.damage        || 10;
      this.range         = config.range         || 400;
      this.ownerId       = config.ownerId       || null;
      this.ownerTeamId   = config.ownerTeamId   || null;
      this.weaponType    = config.weaponType    || 'bullet';
      this._travelled    = 0;

      // Set velocity from direction + speed
      const spd = config.speed || 500;
      this.velocity = Vector2.fromAngle(this.direction, spd);
    }

    update(dt) {
      super.update(dt);
      this._travelled += this.velocity.length() * dt;
      if (this._travelled >= this.range) this.destroy();
    }

    serializeTick() {
      return { ...super.serializeTick(), dmg: this.damage, wt: this.weaponType };
    }
  }

  const exports = { Entity, Avatar, Projectile };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
