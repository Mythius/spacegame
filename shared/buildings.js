// shared/buildings.js — Building registry
//
// ══════════════════════════════════════════════════════════════════════════════
// HOW TO REGISTER A NEW BUILDING
// ══════════════════════════════════════════════════════════════════════════════
//
// Add an entry to BUILDING_REGISTRY below.  The key becomes the building's
// permanent type ID (stored in save files and socket events — don't rename
// after you've placed buildings in a save).
//
// REQUIRED fields:
//   name        string   Display name in the build palette
//   gridW       number   Footprint width  in grid cells (1 cell = 80 world units)
//   gridH       number   Footprint height in grid cells
//   asset       string   File in /assets/ — design it with the Shape Editor
//   hp          number   Building health points
//   cost        object   { resourceType: amount } required to place
//
// OPTIONAL fields:
//   description string   Tooltip text shown in the palette
//   lineWidth   number   Stroke width when rendering the asset (default 2)
//   category    string   Palette group: 'mining' | 'power' | 'structure' | 'defense'
//   powerDraw   number   Power consumed per second while operating
//   powerGen    number   Power produced per second
//   mineRate    number   Ore units extracted per second (drills only)
//   mineRange   number   World-unit radius a drill can reach from its center
//   outputType  string   Resource type produced (smelters, reactors)
//   inputType   string   Resource consumed as input
//
// EXAMPLE — minimal structure block:
//   wall: {
//     name: 'Blast Wall', gridW: 1, gridH: 1,
//     asset: 'wall3.json', hp: 400,
//     cost: { iron: 20 },
//     category: 'structure',
//   },
//
// ══════════════════════════════════════════════════════════════════════════════

(function (root) {
  "use strict";

  const BUILDING_REGISTRY = {
    // ── Mining ───────────────────────────────────────────────────────────────

    drill: {
      id: "drill",
      name: "Mining Drill",
      description:
        "Extracts ore from the asteroid. Place anywhere on the surface.",
      category: "mining",
      gridW: 1,
      gridH: 1,
      asset: "drill.json",
      lineWidth: 2,
      hp: 150,
      cost: { iron: 40, carbon: 15 },
      powerDraw: 10,
      mineRate: 5,
      mineRange: 200,
    },

    grinder: {
      id: "grinder",
      name: "Ore Grinder",
      description:
        "Processes raw ore into refined materials. Place near a drill.",
      category: "mining",
      gridW: 1,
      gridH: 1,
      asset: "grinder.json",
      lineWidth: 2,
      hp: 100,
      cost: { iron: 30, carbon: 20 },
    },

    conveyor: {
      id: "conveyor",
      name: "Conveyor Belt",
      description:
        "Transports materials between buildings. Place adjacent to other structures.",
      category: "mining",
      gridW: 1,
      gridH: 1,
      asset: "conveyor.json",
      lineWidth: 2,
      hp: 50,
      cost: { iron: 10, carbon: 5 },
    },

    forge: {
      id: "forge",
      name: "Forge",
      description:
        "Smelts raw ore into usable materials. Place near a drill or grinder.",
      category: "mining",
      gridW: 1,
      gridH: 1,
      asset: "forge.json",
      lineWidth: 2,
      hp: 120,
      cost: { iron: 50, carbon: 25 },
      powerDraw: 15,
      outputType: "refinedMetal",
    },

    // ── Power ─────────────────────────────────────────────────────────────────

    core: {
      id: "core",
      name: "Reactor Core",
      description: "Burns Helium-3 to generate power for your base.",
      category: "power",
      gridW: 3,
      gridH: 3,
      asset: "core.json",
      lineWidth: 2,
      hp: 200,
      cost: { iron: 80, carbon: 40 },
      powerGen: 50,
      inputType: "helium3",
    },

    // ── Structure ─────────────────────────────────────────────────────────────

    wall: {
      id: "wall",
      name: "Blast Wall",
      category: "structure",
      gridW: 1,
      gridH: 1,
      asset: "wall.json",
      lineWidth: 2,
      hp: 400,
      cost: { iron: 20 },
    },
  };

  const exports = { BUILDING_REGISTRY };
  if (typeof module !== "undefined") module.exports = exports;
  else Object.assign(root, exports);
})(typeof globalThis !== "undefined" ? globalThis : this);
