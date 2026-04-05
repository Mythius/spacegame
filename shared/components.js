(function (root) {
  'use strict';

  // ── ShipComponent — base class for every cell in a ship or base grid ──────
  //
  // To add a new component type:
  //   1. Create a subclass (or use ShipComponent directly if no special logic)
  //   2. Add one entry to COMPONENT_REGISTRY at the bottom
  //   3. Done — createComponent('your_type_key') works everywhere

  class ShipComponent {
    constructor(config = {}) {
      this.typeKey      = config.typeKey     || 'unknown';
      this.name         = config.name        || 'Component';
      this.hp           = config.hp          || 100;
      this.maxHp        = config.hp          || 100;
      this.gridW        = config.gridW       || 1;   // cells wide
      this.gridH        = config.gridH       || 1;   // cells tall
      this.exterior     = config.exterior    || false;
      this.powerDraw    = config.powerDraw   || 0;   // watts consumed
      this.powerOutput  = config.powerOutput || 0;   // watts produced
      this.massContrib  = config.massContrib || (this.gridW * this.gridH);
      this.active       = true;    // toggled off when power is cut
    }

    get alive()    { return this.hp > 0; }
    get healthy()  { return this.hp >= this.maxHp; }
    get hpRatio()  { return this.hp / this.maxHp; }

    takeDamage(amount) {
      this.hp = Math.max(0, this.hp - amount);
      if (!this.alive) this.active = false;
      return !this.alive; // true = just destroyed
    }

    // Returns how many material units are needed to fully repair
    repairCost() {
      const missing = this.maxHp - this.hp;
      return { iron: Math.ceil(missing * 0.1), carbon: Math.ceil(missing * 0.05) };
    }

    // Returns true if the materials object satisfies the repair cost
    canRepair(materials) {
      const cost = this.repairCost();
      return Object.entries(cost).every(([k, v]) => (materials[k] || 0) >= v);
    }

    // Applies partial repair using available materials (returns materials spent)
    repair(materials) {
      const cost = this.repairCost();
      const ratio = Math.min(
        ...Object.entries(cost).map(([k, v]) => v > 0 ? (materials[k] || 0) / v : Infinity)
      );
      const applied = Math.min(ratio, 1);
      this.hp = Math.min(this.maxHp, this.hp + (this.maxHp - this.hp) * applied);
      if (this.alive) this.active = true;
      const spent = {};
      for (const [k, v] of Object.entries(cost)) spent[k] = Math.floor(v * applied);
      return spent;
    }

    // Called each server tick; powerAvailable = watts from core
    update(_dt, _powerAvailable) {}

    serialize() {
      return { typeKey: this.typeKey, hp: Math.round(this.hp), active: this.active };
    }
  }

  // ── Core (nuclear reactor) ────────────────────────────────────────────────
  class CoreComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerOutput: 100, ...config });
      this.fuelType      = config.fuelType      || 'helium3';
      this.fuelRate      = config.fuelRate      || 0.04;   // units/s
      this.fuel          = config.fuel          || 500;    // current fuel
      this.maxFuel       = config.maxFuel       || 500;
      this._fuelEmpty    = false;
    }

    get fuelRatio() { return this.fuel / this.maxFuel; }
    get hasFuel()   { return this.fuel > 0; }

    update(dt) {
      if (this.alive && this.fuel > 0) {
        this.fuel = Math.max(0, this.fuel - this.fuelRate * dt);
        this._fuelEmpty = (this.fuel === 0);
      }
    }

    refuel(amount) { this.fuel = Math.min(this.maxFuel, this.fuel + amount); }

    // Power output degrades when fuel is out (but ship stays alive)
    get currentPowerOutput() {
      if (!this.alive) return 0;
      return this.hasFuel ? this.powerOutput : this.powerOutput * 0.1; // 10% on reserves
    }

    serialize() {
      return { ...super.serialize(), fuel: Math.round(this.fuel), maxFuel: this.maxFuel };
    }
  }

  // ── Thruster ─────────────────────────────────────────────────────────────
  class ThrusterComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 10, exterior: true, ...config });
      this.thrust       = config.thrust       || 100;  // contribution to max speed
      this.thrustAngle  = config.thrustAngle  || 0;    // radians relative to ship forward
    }
    get speedContrib() { return (this.alive && this.active) ? this.thrust : 0; }
  }

  // ── Armor ─────────────────────────────────────────────────────────────────
  class ArmorComponent extends ShipComponent {
    constructor(config = {}) {
      super({ exterior: true, massContrib: 2, ...config });
      this.armorRating = config.armorRating || 1.0;  // damage reduction multiplier
    }
    takeDamage(amount) {
      return super.takeDamage(amount * (1 / this.armorRating));
    }
    repairCost() {
      const missing = this.maxHp - this.hp;
      return { iron: Math.ceil(missing * 0.15) };
    }
  }

  // ── Shield Generator ──────────────────────────────────────────────────────
  class ShieldGenComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 25, ...config });
      this.shieldStrength  = config.shieldStrength  || 200;
      this.rechargeRate    = config.rechargeRate    || 15;   // HP/s
      this._rechargeDelay  = 0;
    }

    // Shield state is tracked on Ship, not here — this just provides the stats
    onHit() { this._rechargeDelay = 4; } // 4-second delay before recharge

    update(dt) {
      if (this._rechargeDelay > 0) this._rechargeDelay -= dt;
    }

    get canRecharge() { return this.alive && this.active && this._rechargeDelay <= 0; }
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  class StorageComponent extends ShipComponent {
    constructor(config = {}) {
      super({ ...config });
      this.capacity = config.capacity || 100;
      this.contents = config.contents || {};  // { resourceType: amount }
    }

    totalStored() { return Object.values(this.contents).reduce((s, v) => s + v, 0); }
    freeSpace()   { return this.capacity - this.totalStored(); }

    store(type, amount) {
      const storable = Math.min(amount, this.freeSpace());
      if (storable <= 0) return 0;
      this.contents[type] = (this.contents[type] || 0) + storable;
      return storable;
    }

    take(type, amount) {
      const available = this.contents[type] || 0;
      const taken = Math.min(amount, available);
      this.contents[type] = available - taken;
      return taken;
    }

    serialize() {
      return { ...super.serialize(), contents: { ...this.contents } };
    }
  }

  // ── Fabricator ────────────────────────────────────────────────────────────
  class FabricatorComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 30, ...config });
      this.queue        = [];   // pending crafting jobs
      this._progress    = 0;
      this._jobTime     = 0;
    }

    addJob(componentTypeKey, duration) {
      this.queue.push({ typeKey: componentTypeKey, duration });
    }

    update(dt) {
      if (!this.alive || !this.active || this.queue.length === 0) return null;
      const job = this.queue[0];
      if (this._jobTime === 0) this._jobTime = job.duration;
      this._progress += dt;
      if (this._progress >= this._jobTime) {
        this._progress = 0;
        this._jobTime  = 0;
        return this.queue.shift(); // returns completed job
      }
      return null;
    }
  }

  // ── Drill ─────────────────────────────────────────────────────────────────
  class DrillComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 15, exterior: true, ...config });
      this.mineRate      = config.mineRate      || 5;    // units/s when on a deposit
      this.attachedTo    = null;   // deposit id when actively mining
    }

    get isMining() { return this.attachedTo !== null && this.alive && this.active; }
  }

  // ── Tether ────────────────────────────────────────────────────────────────
  class TetherComponent extends ShipComponent {
    constructor(config = {}) {
      super({ exterior: true, ...config });
      this.range          = config.range      || 350;
      this.maxTethers     = config.maxTethers || 1;
      this.tethered       = [];  // asteroid/deposit ids currently tethered
    }

    canTether()  { return this.alive && this.active && this.tethered.length < this.maxTethers; }
    addTether(id)   { if (this.canTether()) this.tethered.push(id); }
    removeTether(id){ this.tethered = this.tethered.filter(t => t !== id); }
  }

  // ── Giant Claw (late-game) ────────────────────────────────────────────────
  class ClawComponent extends ShipComponent {
    constructor(config = {}) {
      super({ exterior: true, powerDraw: 20, gridW: 1, gridH: 3, ...config });
      this.range          = config.range      || 200;
      this.lockTime       = config.lockTime   || 4;   // seconds to lock on
      this.state          = 'idle';    // 'idle' | 'deploying' | 'locked' | 'retracting'
      this.targetShipId   = null;
      this.targetCell     = null;
      this._lockProgress  = 0;
    }

    deploy(targetShipId, targetCell) {
      if (this.state !== 'idle' || !this.alive || !this.active) return false;
      this.state = 'deploying';
      this.targetShipId = targetShipId;
      this.targetCell   = targetCell;
      this._lockProgress = 0;
      return true;
    }

    abort() { this.state = 'idle'; this.targetShipId = null; this.targetCell = null; }

    update(dt) {
      if (this.state === 'deploying') {
        this._lockProgress += dt;
        if (this._lockProgress >= this.lockTime) this.state = 'locked';
      }
    }

    get isLocked() { return this.state === 'locked'; }
  }

  // ── Weapon mount ──────────────────────────────────────────────────────────
  class WeaponComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 15, ...config });
      this.weaponType    = config.weaponType    || 'laser_turret';
      this.hardpointAngle = config.hardpointAngle || 0;
      this._weapon       = null;  // set lazily from WEAPON_REGISTRY on first use
    }
  }

  // ── Drone Bay ─────────────────────────────────────────────────────────────
  class DroneBayComponent extends ShipComponent {
    constructor(config = {}) {
      super({ powerDraw: 10, ...config });
      this.maxDrones     = config.maxDrones    || 3;
      this.spawnRate     = config.spawnRate    || 30;  // seconds between spawns
      this.droneType     = config.droneType    || 'patrol';
      this._spawnTimer   = 0;
      this.activeDrones  = [];
    }

    update(dt) {
      if (!this.alive || !this.active) return;
      this._spawnTimer -= dt;
      if (this._spawnTimer <= 0 && this.activeDrones.length < this.maxDrones) {
        this._spawnTimer = this.spawnRate;
        return 'spawn'; // signal to game world to create a drone
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT REGISTRY
  // Adding a new component = one entry here. No other changes needed.
  // ─────────────────────────────────────────────────────────────────────────

  const COMPONENT_REGISTRY = {
    // ── Cores ──────────────────────────────────────────────────────────────
    core_basic:       { cls: CoreComponent,    defaults: { name: 'Basic Reactor',    hp: 150, gridW: 2, gridH: 2, powerOutput: 100, fuelRate: 0.04 } },
    core_advanced:    { cls: CoreComponent,    defaults: { name: 'Advanced Reactor', hp: 200, gridW: 2, gridH: 2, powerOutput: 180, fuelRate: 0.06 } },
    core_fusion:      { cls: CoreComponent,    defaults: { name: 'Fusion Reactor',   hp: 250, gridW: 3, gridH: 3, powerOutput: 350, fuelRate: 0.10 } },

    // ── Armor ──────────────────────────────────────────────────────────────
    armor_light:      { cls: ArmorComponent,   defaults: { name: 'Light Armor',  hp: 80,  gridW: 1, gridH: 1, armorRating: 1.0 } },
    armor_medium:     { cls: ArmorComponent,   defaults: { name: 'Medium Armor', hp: 140, gridW: 1, gridH: 1, armorRating: 1.4 } },
    armor_heavy:      { cls: ArmorComponent,   defaults: { name: 'Heavy Armor',  hp: 220, gridW: 1, gridH: 1, armorRating: 2.0, massContrib: 3 } },
    armor_titan:      { cls: ArmorComponent,   defaults: { name: 'Titan Armor',  hp: 400, gridW: 1, gridH: 1, armorRating: 3.0, massContrib: 4 } },

    // ── Thrusters ──────────────────────────────────────────────────────────
    thruster_small:   { cls: ThrusterComponent, defaults: { name: 'Small Thruster',   hp: 60,  gridW: 1, gridH: 1, thrust: 80,  powerDraw: 8  } },
    thruster_medium:  { cls: ThrusterComponent, defaults: { name: 'Medium Thruster',  hp: 80,  gridW: 1, gridH: 2, thrust: 160, powerDraw: 15 } },
    thruster_large:   { cls: ThrusterComponent, defaults: { name: 'Large Thruster',   hp: 100, gridW: 2, gridH: 2, thrust: 320, powerDraw: 28 } },
    thruster_ion:     { cls: ThrusterComponent, defaults: { name: 'Ion Drive',        hp: 80,  gridW: 1, gridH: 3, thrust: 500, powerDraw: 45 } },

    // ── Shields ────────────────────────────────────────────────────────────
    shield_gen_small: { cls: ShieldGenComponent, defaults: { name: 'Shield Gen I',    hp: 80,  gridW: 1, gridH: 2, shieldStrength: 150, rechargeRate: 12, powerDraw: 20 } },
    shield_gen_large: { cls: ShieldGenComponent, defaults: { name: 'Shield Gen II',   hp: 120, gridW: 2, gridH: 2, shieldStrength: 350, rechargeRate: 25, powerDraw: 40 } },
    shield_gen_omni:  { cls: ShieldGenComponent, defaults: { name: 'Omni Shield',     hp: 160, gridW: 2, gridH: 3, shieldStrength: 600, rechargeRate: 40, powerDraw: 70 } },

    // ── Storage ────────────────────────────────────────────────────────────
    storage_small:    { cls: StorageComponent,  defaults: { name: 'Small Tank',   hp: 50,  gridW: 1, gridH: 1, capacity: 100 } },
    storage_medium:   { cls: StorageComponent,  defaults: { name: 'Medium Tank',  hp: 80,  gridW: 2, gridH: 1, capacity: 300 } },
    storage_large:    { cls: StorageComponent,  defaults: { name: 'Large Tank',   hp: 100, gridW: 2, gridH: 2, capacity: 700 } },
    storage_vault:    { cls: StorageComponent,  defaults: { name: 'Cargo Vault',  hp: 150, gridW: 3, gridH: 3, capacity: 2000 } },

    // ── Fabricators ────────────────────────────────────────────────────────
    fabricator_basic: { cls: FabricatorComponent, defaults: { name: 'Fabricator',        hp: 100, gridW: 2, gridH: 2, powerDraw: 30 } },
    fabricator_adv:   { cls: FabricatorComponent, defaults: { name: 'Advanced Fabricator', hp: 140, gridW: 3, gridH: 2, powerDraw: 50 } },

    // ── Drills ─────────────────────────────────────────────────────────────
    drill_basic:      { cls: DrillComponent,    defaults: { name: 'Mining Drill',   hp: 80,  gridW: 1, gridH: 2, mineRate: 5,  powerDraw: 15 } },
    drill_heavy:      { cls: DrillComponent,    defaults: { name: 'Heavy Drill',    hp: 120, gridW: 2, gridH: 2, mineRate: 12, powerDraw: 28 } },

    // ── Tethers ────────────────────────────────────────────────────────────
    tether_basic:     { cls: TetherComponent,   defaults: { name: 'Tether Beam',    hp: 80,  gridW: 1, gridH: 2, maxTethers: 1, range: 350 } },
    tether_multi:     { cls: TetherComponent,   defaults: { name: 'Multi-Tether',   hp: 120, gridW: 2, gridH: 2, maxTethers: 3, range: 500 } },

    // ── Weapons ────────────────────────────────────────────────────────────
    weapon_laser_t:   { cls: WeaponComponent,   defaults: { name: 'Laser Turret',   hp: 60,  gridW: 1, gridH: 1, weaponType: 'laser_turret' } },
    weapon_ion_t:     { cls: WeaponComponent,   defaults: { name: 'Ion Cannon',     hp: 80,  gridW: 1, gridH: 2, weaponType: 'ion_cannon'   } },
    weapon_plasma_t:  { cls: WeaponComponent,   defaults: { name: 'Plasma Turret',  hp: 90,  gridW: 2, gridH: 2, weaponType: 'plasma_turret'} },
    weapon_claw:      { cls: ClawComponent,     defaults: { name: 'Giant Claw',     hp: 100, gridW: 1, gridH: 3, range: 200, lockTime: 4   } },

    // ── Drone Bays ─────────────────────────────────────────────────────────
    drone_bay_basic:  { cls: DroneBayComponent, defaults: { name: 'Drone Bay',      hp: 80,  gridW: 2, gridH: 2, maxDrones: 2, spawnRate: 30 } },
    drone_bay_adv:    { cls: DroneBayComponent, defaults: { name: 'Heavy Drone Bay',hp: 120, gridW: 3, gridH: 2, maxDrones: 5, spawnRate: 20 } },
  };

  function createComponent(typeKey, overrides = {}) {
    const entry = COMPONENT_REGISTRY[typeKey];
    if (!entry) throw new Error(`Unknown component type: "${typeKey}". Check COMPONENT_REGISTRY.`);
    return new entry.cls({ ...entry.defaults, ...overrides, typeKey });
  }

  // ── ShipGrid — the spatial layout of components ───────────────────────────

  class ShipGrid {
    constructor(width, height) {
      this.width  = width;
      this.height = height;
      // cells[y][x] = { component, originX, originY } or null
      this.cells  = Array.from({ length: height }, () => Array(width).fill(null));
    }

    // Place a component at (x, y). Returns true on success.
    place(component, x, y) {
      if (!this._fits(component, x, y)) return false;
      for (let dy = 0; dy < component.gridH; dy++) {
        for (let dx = 0; dx < component.gridW; dx++) {
          this.cells[y + dy][x + dx] = { component, originX: x, originY: y };
        }
      }
      return true;
    }

    // Remove the component occupying (x, y). Returns the component or null.
    remove(x, y) {
      const cell = this.getAt(x, y);
      if (!cell) return null;
      const { component, originX, originY } = cell;
      for (let dy = 0; dy < component.gridH; dy++) {
        for (let dx = 0; dx < component.gridW; dx++) {
          this.cells[originY + dy][originX + dx] = null;
        }
      }
      return component;
    }

    getAt(x, y) {
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) return null;
      return this.cells[y][x];
    }

    getAllComponents() {
      const seen = new Set(), result = [];
      for (const row of this.cells) {
        for (const cell of row) {
          if (cell && !seen.has(cell.component)) {
            seen.add(cell.component);
            result.push(cell.component);
          }
        }
      }
      return result;
    }

    getCore() { return this.getAllComponents().find(c => c instanceof CoreComponent) || null; }

    // Compute ship stats from the current grid layout
    computeStats() {
      const all          = this.getAllComponents();
      const alive        = all.filter(c => c.alive);
      const core         = this.getCore();
      const power        = core ? core.currentPowerOutput : 0;
      const powerDraw    = alive.reduce((s, c) => s + c.powerDraw, 0);
      const powerRatio   = power > 0 ? Math.min(1, power / Math.max(powerDraw, 1)) : 0;
      const totalMass    = all.reduce((s, c) => s + c.massContrib, 0);
      const thrust       = alive.filter(c => c instanceof ThrusterComponent)
                               .reduce((s, c) => s + c.speedContrib, 0);
      const maxHp        = all.reduce((s, c) => s + c.maxHp, 0);
      const currentHp    = all.reduce((s, c) => s + c.hp, 0);
      const shields      = alive.filter(c => c instanceof ShieldGenComponent);
      const shieldMax    = shields.reduce((s, c) => s + c.shieldStrength, 0);
      const fuelEmpty    = core ? !core.hasFuel : true;

      return {
        maxSpeed:    totalMass > 0 ? (thrust / totalMass) * 60 : 0,
        maxHp,
        currentHp,
        hpRatio:     maxHp > 0 ? currentHp / maxHp : 0,
        shieldMax,
        powerOutput: power,
        powerDraw,
        powerRatio,
        fuelEmpty,
        fuelRatio:   core ? core.fuelRatio : 0,
      };
    }

    // Apply positional damage to the cell at (gridX, gridY)
    applyDamage(gridX, gridY, amount) {
      const cell = this.getAt(gridX, gridY);
      if (!cell) return false;
      return cell.component.takeDamage(amount);
    }

    update(dt) {
      const core  = this.getCore();
      const power = core ? core.currentPowerOutput : 0;
      const all   = this.getAllComponents();
      const draw  = all.reduce((s, c) => s + c.powerDraw, 0);
      const ratio = power > 0 ? Math.min(1, power / Math.max(draw, 1)) : 0;
      for (const c of all) c.update(dt, power * ratio);
    }

    serialize() {
      const layout = [];
      const seen = new Set();
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const cell = this.cells[y][x];
          if (cell && !seen.has(cell.component)) {
            seen.add(cell.component);
            layout.push({ typeKey: cell.component.typeKey, x: cell.originX, y: cell.originY,
                          state: cell.component.serialize() });
          }
        }
      }
      return { w: this.width, h: this.height, layout };
    }

    static deserialize(data) {
      const grid = new ShipGrid(data.w, data.h);
      for (const entry of data.layout) {
        const comp = createComponent(entry.typeKey, entry.state);
        grid.place(comp, entry.x, entry.y);
      }
      return grid;
    }

    _fits(component, x, y) {
      if (x < 0 || y < 0 || x + component.gridW > this.width || y + component.gridH > this.height) return false;
      for (let dy = 0; dy < component.gridH; dy++) {
        for (let dx = 0; dx < component.gridW; dx++) {
          if (this.cells[y + dy][x + dx] !== null) return false;
        }
      }
      return true;
    }
  }

  const exports = {
    ShipComponent, CoreComponent, ThrusterComponent, ArmorComponent,
    ShieldGenComponent, StorageComponent, FabricatorComponent,
    DrillComponent, TetherComponent, ClawComponent, WeaponComponent, DroneBayComponent,
    COMPONENT_REGISTRY, createComponent, ShipGrid,
  };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
