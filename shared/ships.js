(function (root) {
  'use strict';

  // ── Ship templates ────────────────────────────────────────────
  // Each entry is a self-contained ship design.
  // gridW / gridH define the grid dimensions; layout mirrors ShipGrid.serialize() format.
  // Coordinates are (x = column, y = row), 0-indexed from top-left.

  const SHIP_TEMPLATES = [
    {
      key:   'scout',
      name:  'Scout',
      desc:  'Small, fast, and agile. Limited HP but hard to catch.',
      color: '#4af',
      gridW: 6, gridH: 6,
      layout: [
        { typeKey: 'core_basic',     x: 2, y: 2 },
        { typeKey: 'thruster_small', x: 0, y: 2 },
        { typeKey: 'thruster_small', x: 0, y: 3 },
        { typeKey: 'armor_light',    x: 0, y: 0 },
        { typeKey: 'armor_light',    x: 5, y: 0 },
        { typeKey: 'armor_light',    x: 0, y: 5 },
        { typeKey: 'armor_light',    x: 5, y: 5 },
      ],
    },
    {
      key:   'fighter',
      name:  'Fighter',
      desc:  'Balanced speed and firepower. The standard warship.',
      color: '#8f4',
      gridW: 8, gridH: 8,
      layout: [
        { typeKey: 'core_basic',      x: 3, y: 3 },
        { typeKey: 'thruster_medium', x: 0, y: 3 },
        { typeKey: 'thruster_medium', x: 0, y: 5 },
        { typeKey: 'armor_light',     x: 3, y: 0 },
        { typeKey: 'armor_light',     x: 4, y: 0 },
        { typeKey: 'armor_light',     x: 3, y: 7 },
        { typeKey: 'armor_light',     x: 4, y: 7 },
        { typeKey: 'armor_medium',    x: 7, y: 3 },
        { typeKey: 'armor_medium',    x: 7, y: 4 },
        { typeKey: 'weapon_laser_t',  x: 7, y: 0 },
      ],
    },
    {
      key:   'cruiser',
      name:  'Cruiser',
      desc:  'Heavy armor and high firepower. Sluggish but powerful.',
      color: '#fa4',
      gridW: 10, gridH: 10,
      layout: [
        { typeKey: 'core_advanced',    x: 4, y: 4 },
        { typeKey: 'thruster_large',   x: 0, y: 2 },
        { typeKey: 'thruster_large',   x: 0, y: 6 },
        { typeKey: 'armor_medium',     x: 4, y: 0 },
        { typeKey: 'armor_medium',     x: 5, y: 0 },
        { typeKey: 'armor_medium',     x: 4, y: 9 },
        { typeKey: 'armor_medium',     x: 5, y: 9 },
        { typeKey: 'armor_heavy',      x: 8, y: 4 },
        { typeKey: 'armor_heavy',      x: 8, y: 5 },
        { typeKey: 'weapon_ion_t',     x: 9, y: 1 },
        { typeKey: 'weapon_ion_t',     x: 9, y: 7 },
        { typeKey: 'shield_gen_small', x: 6, y: 4 },
      ],
    },
    {
      key:   'freighter',
      name:  'Freighter',
      desc:  'Massive cargo capacity. Built for hauling, not combat.',
      color: '#b7a',
      gridW: 10, gridH: 10,
      layout: [
        { typeKey: 'core_basic',    x: 4, y: 4 },
        { typeKey: 'thruster_ion',  x: 0, y: 4 },
        { typeKey: 'storage_large', x: 3, y: 1 },
        { typeKey: 'storage_large', x: 6, y: 1 },
        { typeKey: 'storage_large', x: 3, y: 7 },
        { typeKey: 'storage_large', x: 6, y: 7 },
        { typeKey: 'armor_light',   x: 9, y: 4 },
        { typeKey: 'armor_light',   x: 9, y: 5 },
      ],
    },
  ];

  // ── Physics derivation ────────────────────────────────────────
  // Derives per-ship physics from a template's grid layout.
  //   maxSpeed  — velocity cap (units/s); bigger ships go slower
  //   thrust    — acceleration (units/s²); scales with thrust/mass ratio
  //   turnRate  — rotation speed (rad/s); bigger ships turn slower
  //   maxHp     — sum of component HP
  //   drag      — per-tick velocity retention (applied at 30 fps)

  function shipPhysics(template) {
    // Works in both Node.js (require) and browser (global from components.js)
    const _ShipGrid = (typeof module !== 'undefined')
      ? require('./components').ShipGrid
      : ShipGrid;

    const grid = _ShipGrid.deserialize({
      w: template.gridW,
      h: template.gridH,
      layout: template.layout.map(e => ({ typeKey: e.typeKey, x: e.x, y: e.y, state: {} })),
    });

    const all = grid.getAllComponents();

    const totalThrust = all
      .filter(c => c.typeKey.startsWith('thruster'))
      .reduce((s, c) => s + (c.thrust || 0), 0);
    const totalMass = all.reduce((s, c) => s + c.massContrib, 0) || 1;
    const maxHp     = all.reduce((s, c) => s + c.maxHp, 0)      || 100;

    // Grid-size factor: 1.0 at 6×6, ~0.6 at 10×10
    const cellCount  = template.gridW * template.gridH;
    const sizeFactor = Math.sqrt(36 / Math.max(36, cellCount));

    // Max speed hard-capped by physical size
    const maxSpeed = Math.round(500 * sizeFactor);

    // Thrust acceleration: driven by thruster efficiency, dampened by size
    const thrustRatio = totalThrust / totalMass;
    const thrust      = Math.max(80, Math.min(380, thrustRatio * 18));

    // Turn rate strictly from size
    const turnRate = +(3.2 * sizeFactor).toFixed(3);

    return { maxSpeed, thrust, turnRate, maxHp, drag: 0.986 };
  }

  const exports = { SHIP_TEMPLATES, shipPhysics };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);

})(typeof globalThis !== 'undefined' ? globalThis : this);
