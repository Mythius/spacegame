(function (root) {
  'use strict';

  const _physics  = typeof module !== 'undefined' ? require('./physics')  : root;
  const _entity   = typeof module !== 'undefined' ? require('./entity')   : root;
  const Vector2   = _physics.Vector2;
  const Projectile = _entity.Projectile;

  // ── Weapon ────────────────────────────────────────────────────────────────
  //
  // To add a new weapon: one entry in WEAPON_REGISTRY. No other changes.
  // Weapon instances are lightweight config + cooldown state.
  //
  // beamConfig: if set, fire() also returns a beam definition (uses beam.js on client).
  // avatarWeapon: true if this can be held by the player avatar.

  class Weapon {
    constructor(config = {}) {
      this.typeKey         = config.typeKey         || 'unknown';
      this.name            = config.name            || 'Weapon';
      this.damage          = config.damage          || 10;
      this.fireRate        = config.fireRate        || 1;       // shots/s
      this.range           = config.range           || 400;     // units
      this.projectileSpeed = config.projectileSpeed || 500;     // units/s
      this.ammoType        = config.ammoType        || 'energy'; // 'energy' = infinite
      this.ammoPerShot     = config.ammoPerShot     || 1;
      this.spread          = config.spread          || 0;       // radians of random spread
      this.burst           = config.burst           || 1;       // projectiles per shot
      this.burstInterval   = config.burstInterval   || 0.08;    // s between burst shots
      this.beamConfig      = config.beamConfig      || null;    // beam.js JSON if visual beam
      this.avatarWeapon    = config.avatarWeapon    || false;
      this.componentDisable = config.componentDisable || false; // disables ship components on hit
      this.knockback       = config.knockback       || 0;

      this._cooldown       = 0;
      this._burstQueue     = 0;
      this._burstTimer     = 0;
    }

    get isReady()    { return this._cooldown <= 0 && this._burstQueue === 0; }
    get cooldownPct(){ return Math.max(0, this._cooldown * this.fireRate); }

    update(dt) {
      if (this._cooldown > 0) this._cooldown -= dt;

      // Burst fire: drain the burst queue
      if (this._burstQueue > 0) {
        this._burstTimer -= dt;
        if (this._burstTimer <= 0) {
          this._burstQueue--;
          this._burstTimer = this.burstInterval;
          return 'burst_ready'; // signal to caller to emit a projectile
        }
      }
    }

    // Returns array of Projectile configs, or null if can't fire.
    // Does NOT check ammo — caller is responsible for that.
    fire(x, y, direction, ownerId, ownerTeamId) {
      if (!this.isReady) return null;
      this._cooldown   = 1 / this.fireRate;
      this._burstQueue = this.burst - 1;
      this._burstTimer = this.burstInterval;

      return this._makeProjectile(x, y, direction, ownerId, ownerTeamId);
    }

    _makeProjectile(x, y, direction, ownerId, ownerTeamId) {
      const angle = direction + (Math.random() - 0.5) * this.spread;
      return {
        x, y,
        direction: angle,
        speed:     this.projectileSpeed,
        damage:    this.damage,
        range:     this.range,
        ownerId,
        ownerTeamId,
        weaponType:       this.typeKey,
        componentDisable: this.componentDisable,
        knockback:        this.knockback,
        beamConfig:       this.beamConfig,
      };
    }

    // Clone a fresh instance (so multiple users can share the same registry entry)
    clone() { return new Weapon({ ...this._config }); }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WEAPON REGISTRY
  // Add a new weapon here. createWeapon('key') works everywhere instantly.
  // ─────────────────────────────────────────────────────────────────────────

  const WEAPON_REGISTRY = {
    // ── Avatar personal weapons (avatarWeapon: true) ──────────────────────
    laser_pistol: {
      name: 'Laser Pistol', avatarWeapon: true,
      damage: 8, fireRate: 2.5, range: 280, projectileSpeed: 550,
      ammoType: 'energy', spread: 0.04,
      beamConfig: { layers: [{ type: 'line', color: '#4af', thickness: 2, opacity: 0.9 }] },
    },
    plasma_pistol: {
      name: 'Plasma Pistol', avatarWeapon: true,
      damage: 18, fireRate: 1.0, range: 220, projectileSpeed: 420,
      ammoType: 'plasma', ammoPerShot: 1,
      beamConfig: { layers: [{ type: 'line', color: '#f80', thickness: 3, opacity: 0.85 }] },
    },
    // Disables ship components instead of dealing HP damage
    emp_gun: {
      name: 'EMP Gun', avatarWeapon: true,
      damage: 0, fireRate: 0.4, range: 180, projectileSpeed: 350,
      ammoType: 'ion_cell', componentDisable: true,
      beamConfig: { layers: [{ type: 'zigzag', color: '#8ff', thickness: 2, opacity: 0.8, amplitude: 6, wavelength: 20 }] },
    },
    ion_rifle: {
      name: 'Ion Rifle', avatarWeapon: true,
      damage: 30, fireRate: 0.5, range: 450, projectileSpeed: 700,
      ammoType: 'ion_cell', ammoPerShot: 2,
    },

    // ── Ship-mounted turrets ───────────────────────────────────────────────
    laser_turret: {
      name: 'Laser Turret',
      damage: 12, fireRate: 2.0, range: 380, projectileSpeed: 650,
      ammoType: 'energy',
      beamConfig: { layers: [
        { type: 'line', color: '#4af', thickness: 6, opacity: 0.2 },
        { type: 'line', color: '#8df', thickness: 2, opacity: 0.9 },
      ]},
    },
    ion_cannon: {
      name: 'Ion Cannon',
      damage: 55, fireRate: 0.3, range: 650, projectileSpeed: 350,
      ammoType: 'ion_cell', ammoPerShot: 3,
    },
    plasma_turret: {
      name: 'Plasma Turret',
      damage: 35, fireRate: 0.7, range: 500, projectileSpeed: 450,
      ammoType: 'plasma', ammoPerShot: 2, spread: 0.06,
      beamConfig: { layers: [
        { type: 'sin', color: '#f60', thickness: 8, opacity: 0.3, amplitude: 10, wavelength: 60 },
        { type: 'sin', color: '#ff4', thickness: 2, opacity: 0.9, amplitude: 10, wavelength: 60, phaseOffset: 0.5 },
      ]},
    },
    scatter_cannon: {
      name: 'Scatter Cannon',
      damage: 15, fireRate: 0.6, range: 300, projectileSpeed: 600,
      ammoType: 'iron', burst: 5, burstInterval: 0.06, spread: 0.25,
    },
    railgun: {
      name: 'Railgun',
      damage: 120, fireRate: 0.15, range: 900, projectileSpeed: 1200,
      ammoType: 'titanium', ammoPerShot: 5, spread: 0,
      knockback: 80,
    },

    // ── Planet / base turrets (NPC) ────────────────────────────────────────
    npc_turret_basic: {
      name: 'Defense Turret',
      damage: 10, fireRate: 1.2, range: 400, projectileSpeed: 500,
      ammoType: 'energy',
    },
    npc_turret_heavy: {
      name: 'Heavy Defense Turret',
      damage: 30, fireRate: 0.5, range: 600, projectileSpeed: 400,
      ammoType: 'energy',
    },
  };

  function createWeapon(typeKey, overrides = {}) {
    const cfg = WEAPON_REGISTRY[typeKey];
    if (!cfg) throw new Error(`Unknown weapon type: "${typeKey}". Check WEAPON_REGISTRY.`);
    const w = new Weapon({ ...cfg, ...overrides, typeKey });
    w._config = { ...cfg, ...overrides, typeKey }; // store for clone()
    return w;
  }

  // Ammo types — 'energy' is always infinite; others are consumed from storage
  const AMMO_TYPES = {
    energy:   { infinite: true,  name: 'Energy Cell'  },
    plasma:   { infinite: false, name: 'Plasma Cell',    craftFrom: { crystal: 2, helium3: 1 } },
    ion_cell: { infinite: false, name: 'Ion Cell',       craftFrom: { crystal: 4, carbon: 2  } },
    titanium: { infinite: false, name: 'Titanium Slug',  craftFrom: { titanium: 3            } },
    iron:     { infinite: false, name: 'Iron Pellet',    craftFrom: { iron: 2                } },
  };

  const exports = { Weapon, WEAPON_REGISTRY, AMMO_TYPES, createWeapon };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
