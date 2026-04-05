(function (root) {
  'use strict';

  const _physics   = typeof module !== 'undefined' ? require('./physics')   : root;
  const _constants = typeof module !== 'undefined' ? require('./constants') : root.CONSTANTS || root;
  const Vector2    = _physics.Vector2;
  const AABB       = _physics.AABB;
  const C          = typeof _constants.SECTOR_SIZE !== 'undefined' ? _constants : _constants.CONSTANTS;

  // ── Sector types ──────────────────────────────────────────────────────────

  const SECTOR_TYPES = {
    empty:        { name: 'Deep Space',      hazard: 0,   resourceMult: 0.5 },
    asteroid_belt:{ name: 'Asteroid Belt',   hazard: 0.2, resourceMult: 1.5 },
    inner_planet: { name: 'Inner System',    hazard: 0.3, resourceMult: 1.0 },
    outer_planet: { name: 'Outer System',    hazard: 0.1, resourceMult: 0.8 },
    gas_giant:    { name: 'Gas Giant Orbit', hazard: 0.4, resourceMult: 0.6 },
    nebula:       { name: 'Nebula Cloud',    hazard: 0.5, resourceMult: 1.2 },
    debris_field: { name: 'Debris Field',    hazard: 0.6, resourceMult: 1.8 },
    deep_space:   { name: 'Deep Space',      hazard: 0.8, resourceMult: 2.0 },
  };

  // ── Sector ────────────────────────────────────────────────────────────────

  class Sector {
    constructor(config = {}) {
      this.id       = config.id       || `${config.gx}_${config.gy}`;
      this.gx       = config.gx       || 0;  // grid x (sector column)
      this.gy       = config.gy       || 0;  // grid y (sector row)
      this.type     = config.type     || 'empty';
      this.name     = config.name     || SECTOR_TYPES[this.type]?.name || 'Unknown';
      this.planetId = config.planetId || null;  // if this sector has a planet

      // Entities, deposits, bases in this sector
      this.entities  = new Map();   // id → Entity
      this.deposits  = new Map();   // id → ResourceDeposit
      this.bases     = new Map();   // id → base descriptor

      // Storm state (for planet sectors)
      this.stormOpen    = false;
      this.stormEndsAt  = null;
      this.stormCooldown = 0;
    }

    // World-space top-left corner of this sector
    get worldX() { return this.gx * C.SECTOR_SIZE; }
    get worldY() { return this.gy * C.SECTOR_SIZE; }

    get bounds() {
      return new AABB(this.worldX, this.worldY, C.SECTOR_SIZE, C.SECTOR_SIZE);
    }

    get center() {
      return new Vector2(this.worldX + C.SECTOR_SIZE / 2, this.worldY + C.SECTOR_SIZE / 2);
    }

    // Convert grid-local coords to world coords
    localToWorld(lx, ly) { return new Vector2(this.worldX + lx, this.worldY + ly); }
    worldToLocal(wx, wy) { return new Vector2(wx - this.worldX, wy - this.worldY); }

    containsWorld(wx, wy) { return this.bounds.contains(wx, wy); }

    // Returns a repulsion Vector2 when near the sector edge. Zero vector = safely inside.
    getBoundaryForce(wx, wy) {
      return _physics.sectorBoundaryForce(
        wx, wy,
        this.worldX, this.worldY,
        C.SECTOR_SIZE,
        C.BOUNDARY_WARN_DIST,
        C.BOUNDARY_MAX_FORCE
      );
    }

    // 0 = nowhere near boundary, 1 = right at edge (for visual warning intensity)
    getBoundaryIntensity(wx, wy) {
      const b = this.bounds;
      const d = Math.min(wx - b.left, b.right - wx, wy - b.top, b.bottom - wy);
      return Math.max(0, 1 - d / C.BOUNDARY_WARN_DIST);
    }

    // ── Storm management ────────────────────────────────────────────────────

    openStorm() {
      if (this.stormOpen || !this.planetId) return false;
      this.stormOpen   = true;
      this.stormEndsAt = Date.now() + C.STORM_DURATION * 1000;
      return true;
    }

    // Returns { closed, dmgPerSec, secondsLeft } each tick; null if storm not open
    tickStorm() {
      if (!this.stormOpen) return null;
      const secondsLeft = Math.max(0, (this.stormEndsAt - Date.now()) / 1000);
      const closing     = secondsLeft <= 0;

      // Damage ramps up in last 30s
      const dmgPerSec = secondsLeft <= C.STORM_DAMAGE_START
        ? C.STORM_DAMAGE_PER_SEC * (1 + (C.STORM_DAMAGE_START - secondsLeft) / 5)
        : 0;

      if (closing) {
        this.stormOpen    = false;
        this.stormCooldown = C.STORM_MIN_INTERVAL;
      }

      return { closed: closing, dmgPerSec, secondsLeft };
    }

    // Entity management
    addEntity(entity)    { this.entities.set(entity.id, entity); entity.sectorId = this.id; }
    removeEntity(entity) { this.entities.delete(entity.id); }
    getEntities()        { return [...this.entities.values()]; }

    addDeposit(deposit)  { this.deposits.set(deposit.id, deposit); deposit.sectorId = this.id; }
    getDeposits()        { return [...this.deposits.values()]; }

    serialize() {
      return {
        id: this.id, gx: this.gx, gy: this.gy,
        type: this.type, name: this.name, planetId: this.planetId,
        stormOpen: this.stormOpen, stormEndsAt: this.stormEndsAt,
      };
    }
  }

  // ── SolarSystem ───────────────────────────────────────────────────────────

  class SolarSystem {
    constructor(config = {}) {
      this.gridW   = config.gridW   || C.SECTOR_GRID_W;
      this.gridH   = config.gridH   || C.SECTOR_GRID_H;
      this._grid   = [];  // [gy][gx] = Sector

      for (let gy = 0; gy < this.gridH; gy++) {
        this._grid.push([]);
        for (let gx = 0; gx < this.gridW; gx++) {
          this._grid[gy].push(null);  // populated by generate() or deserialize()
        }
      }
    }

    getSectorAt(gx, gy) {
      if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return null;
      return this._grid[gy][gx];
    }

    setSectorAt(gx, gy, sector) {
      if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridH) return;
      this._grid[gy][gx] = sector;
    }

    // Find which sector contains world-space point (wx, wy)
    getSectorContaining(wx, wy) {
      const gx = Math.floor(wx / C.SECTOR_SIZE);
      const gy = Math.floor(wy / C.SECTOR_SIZE);
      return this.getSectorAt(gx, gy);
    }

    // All sectors
    allSectors() {
      const result = [];
      for (const row of this._grid) for (const s of row) if (s) result.push(s);
      return result;
    }

    // Sectors adjacent to (gx, gy), including diagonals if diag=true
    neighbors(gx, gy, diag = false) {
      const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
      if (diag) dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
      return dirs.map(([dx, dy]) => this.getSectorAt(gx + dx, gy + dy)).filter(Boolean);
    }

    // Generate a default solar system layout
    static generate() {
      const sys = new SolarSystem();
      const cx  = Math.floor(sys.gridW / 2);
      const cy  = Math.floor(sys.gridH / 2);

      for (let gy = 0; gy < sys.gridH; gy++) {
        for (let gx = 0; gx < sys.gridW; gx++) {
          const dist = Math.sqrt((gx - cx) ** 2 + (gy - cy) ** 2);
          let type;
          if (dist < 1.5)       type = 'inner_planet';
          else if (dist < 2.5)  type = 'inner_planet';
          else if (dist < 3.5)  type = 'asteroid_belt';
          else if (dist < 5)    type = 'outer_planet';
          else                  type = 'deep_space';

          // Sprinkle special types
          if (Math.random() < 0.1)  type = 'nebula';
          if (Math.random() < 0.08) type = 'debris_field';

          const hasPlanet = (type === 'inner_planet' || type === 'outer_planet') && Math.random() < 0.6;
          const sector = new Sector({
            gx, gy, type,
            planetId: hasPlanet ? `planet_${gx}_${gy}` : null,
          });
          sys.setSectorAt(gx, gy, sector);
        }
      }
      return sys;
    }

    serialize() {
      return {
        gridW: this.gridW, gridH: this.gridH,
        sectors: this.allSectors().map(s => s.serialize()),
      };
    }

    static deserialize(data) {
      const sys = new SolarSystem({ gridW: data.gridW, gridH: data.gridH });
      for (const sd of data.sectors) {
        sys.setSectorAt(sd.gx, sd.gy, new Sector(sd));
      }
      return sys;
    }
  }

  const exports = { SECTOR_TYPES, Sector, SolarSystem };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
