(function (root) {
  'use strict';

  // ── Resource type definitions ─────────────────────────────────────────────

  const RESOURCE_TYPES = {
    // Tier 1 — Infinite (basic, always available)
    iron:    { name: 'Iron',    tier: 1, color: '#a87', desc: 'Basic structural material' },
    carbon:  { name: 'Carbon',  tier: 1, color: '#888', desc: 'Wiring, pipes, basic fabrication' },
    helium3: { name: 'Helium-3', tier: 1, color: '#af8', desc: 'Core fuel and thruster boost' },

    // Tier 2 — Finite deposits (~1000 units, respawn if no base nearby)
    crystal:  { name: 'Crystal',  tier: 2, color: '#8df', desc: 'Energy cells, sensors, ammo' },
    titanium: { name: 'Titanium', tier: 2, color: '#ccc', desc: 'High-grade armor, railgun ammo' },
    plasma_gel: { name: 'Plasma Gel', tier: 2, color: '#f84', desc: 'Plasma weapons and reactors' },

    // Tier 3 — Rare, boss/planet only (no respawn except boss kill)
    void_crystal:       { name: 'Void Crystal',       tier: 3, color: '#c8f', desc: 'Top-tier components' },
    fusion_fragment:    { name: 'Fusion Core Fragment',tier: 3, color: '#ff8', desc: 'Advanced reactor crafting' },
    ancient_schematic:  { name: 'Ancient Schematic',  tier: 3, color: '#8fc', desc: 'Blueprint unlock item' },
  };

  // ── ResourceDeposit — a finite or infinite resource node in the world ─────

  class ResourceDeposit {
    constructor(config = {}) {
      this.id           = config.id           || null;
      this.resourceType = config.resourceType || 'iron';
      this.x            = config.x            || 0;
      this.y            = config.y            || 0;
      this.sectorId     = config.sectorId     || null;

      const def = RESOURCE_TYPES[this.resourceType];
      this.tier = def ? def.tier : 1;

      // Tier 1 deposits are effectively infinite
      if (this.tier === 1) {
        this.maxUnits    = Infinity;
        this.totalUnits  = Infinity;
        this.respawnTime = 0;
      } else {
        this.maxUnits    = config.maxUnits    || (this.tier === 2 ? 1000 : 500);
        this.totalUnits  = config.totalUnits  || this.maxUnits;
        this.respawnTime = config.respawnTime || (this.tier === 2 ? 1800 : 0); // 0 = no auto-respawn
      }

      this.collected     = config.collected   || 0;  // units mined so far
      this._exhaustedAt  = config._exhaustedAt || null; // timestamp when depleted
      this.tetheredBy    = config.tetheredBy  || null; // entity id of tethering structure
    }

    get depleted()   { return this.tier > 1 && this.collected >= this.maxUnits; }
    get remaining()  { return this.tier === 1 ? Infinity : Math.max(0, this.maxUnits - this.collected); }
    get pctRemaining() { return this.tier === 1 ? 1 : this.remaining / this.maxUnits; }

    // Mine up to `requestedAmount` units. Returns actual amount mined.
    mine(requestedAmount) {
      if (this.depleted) return 0;
      if (this.tier === 1) return requestedAmount; // infinite

      const actual = Math.min(requestedAmount, this.remaining);
      this.collected += actual;
      if (this.depleted) this._exhaustedAt = Date.now();
      return actual;
    }

    // Call each server tick. nearbyBases = array of base positions [{x,y}].
    // Returns true if the deposit just respawned.
    tick(nearbyBases = []) {
      if (!this.depleted || this.respawnTime === 0) return false;

      const elapsed = (Date.now() - this._exhaustedAt) / 1000;
      if (elapsed < this.respawnTime) return false;

      // Only respawn if no base is within 600 units
      const clearZone = 600;
      const hasNearbyBase = nearbyBases.some(b => {
        const dx = b.x - this.x, dy = b.y - this.y;
        return dx * dx + dy * dy <= clearZone * clearZone;
      });
      if (hasNearbyBase) return false;

      // Respawn
      this.collected    = 0;
      this._exhaustedAt = null;
      return true;
    }

    canTether()    { return this.tier === 2 && !this.depleted && this.tetheredBy === null; }
    tether(ownerId){ this.tetheredBy = ownerId; }
    untether()     { this.tetheredBy = null; }

    serialize() {
      return {
        id: this.id, resourceType: this.resourceType,
        x: this.x, y: this.y, sectorId: this.sectorId,
        maxUnits: this.maxUnits === Infinity ? -1 : this.maxUnits,
        collected: this.collected,
        tetheredBy: this.tetheredBy,
        _exhaustedAt: this._exhaustedAt,
      };
    }

    static deserialize(data) {
      return new ResourceDeposit({
        ...data,
        maxUnits: data.maxUnits === -1 ? Infinity : data.maxUnits,
      });
    }
  }

  // ── Simple resource storage bag (used by bases, ships, etc.) ─────────────

  class ResourceBag {
    constructor(capacity = Infinity) {
      this.capacity = capacity;
      this._contents = {};
    }

    total()    { return Object.values(this._contents).reduce((s, v) => s + v, 0); }
    freeSpace(){ return this.capacity === Infinity ? Infinity : this.capacity - this.total(); }
    get(type)  { return this._contents[type] || 0; }

    add(type, amount) {
      const storable = this.capacity === Infinity ? amount : Math.min(amount, this.freeSpace());
      if (storable <= 0) return 0;
      this._contents[type] = (this._contents[type] || 0) + storable;
      return storable;
    }

    take(type, amount) {
      const available = this._contents[type] || 0;
      const taken = Math.min(amount, available);
      this._contents[type] = available - taken;
      if (this._contents[type] === 0) delete this._contents[type];
      return taken;
    }

    has(requirements) {
      return Object.entries(requirements).every(([t, v]) => this.get(t) >= v);
    }

    spend(requirements) {
      if (!this.has(requirements)) return false;
      for (const [t, v] of Object.entries(requirements)) this.take(t, v);
      return true;
    }

    serialize() { return { capacity: this.capacity, contents: { ...this._contents } }; }

    static deserialize(data) {
      const bag = new ResourceBag(data.capacity);
      bag._contents = { ...data.contents };
      return bag;
    }
  }

  const exports = { RESOURCE_TYPES, ResourceDeposit, ResourceBag };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
