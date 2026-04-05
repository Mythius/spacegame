(function (exports) {
  'use strict';

  const CONSTANTS = {
    // ── Server ────────────────────────────────────────────────
    TICK_RATE:              30,       // server ticks per second
    BASE_TICK_RATE:         1,        // base resource ticks per second

    // ── World ─────────────────────────────────────────────────
    SECTOR_SIZE:            6000,     // units per sector (width & height)
    SECTOR_GRID_W:          8,        // sectors across the solar system
    SECTOR_GRID_H:          8,

    // Soft boundary: within this distance of sector edge, repulsion force builds
    BOUNDARY_WARN_DIST:     400,
    BOUNDARY_MAX_FORCE:     600,      // units/s² at the very edge

    // ── Avatar ────────────────────────────────────────────────
    AVATAR_SPEED:           150,      // units/s
    AVATAR_HEALTH:          100,
    AVATAR_SPRINT_MULT:     1.8,

    // ── Ships ─────────────────────────────────────────────────
    RETREAT_HULL_THRESHOLD: 0.05,     // 5% hull remaining triggers retreat option
    RETREAT_WINDOW:         8,        // seconds player has to decide
    WARP_CHARGE_TIME:       60,       // seconds to charge warp drive
    WARP_SHIELD_DISABLED:   true,     // shields off during warp charge
    SALVAGE_LIFETIME:       300,      // seconds before dropped components despawn

    // ── Core / Fuel ───────────────────────────────────────────
    CORE_FUEL_RATE:         0.04,     // Helium-3 units consumed per second
    // When fuel runs out, systems degrade in order:
    CORE_DEGRADE_SPEED:     0.30,     // multiplier on max speed at 0 fuel
    CORE_DEGRADE_WEAPONS:   true,     // weapons offline at 0 fuel
    CORE_DEGRADE_SHIELDS:   true,     // shields offline at 0 fuel

    // ── Resources ─────────────────────────────────────────────
    DEPOSIT_T2_MAX:         1000,     // units before T2 deposit is exhausted
    DEPOSIT_T2_RESPAWN:     1800,     // seconds; only if no base nearby
    DEPOSIT_T3_MAX:         500,      // Tier-3 rare deposits
    DEPOSIT_TETHER_RANGE:   350,      // max distance to tether a deposit

    // ── Planets / Storms ──────────────────────────────────────
    STORM_DURATION:         720,      // seconds a planet is open (12 min)
    STORM_WARNING_TIMES:    [60, 30], // seconds before close to broadcast warnings
    STORM_DAMAGE_START:     30,       // seconds before close damage starts
    STORM_DAMAGE_PER_SEC:   5,        // avatar HP/s, scales up
    STORM_MIN_INTERVAL:     600,      // min seconds between planet openings

    // ── Shields ───────────────────────────────────────────────
    SHIELD_RECHARGE_DELAY:  4,        // seconds after last hit before recharge starts
    SHIELD_RECHARGE_RATE:   15,       // shield HP per second

    // ── Rendering (client hints, not authoritative) ───────────
    ZOOM_COMPONENT_LEVEL:   1.5,      // zoom scale where components become visible
    CAMERA_LERP:            0.10,     // camera smoothing factor
  };

  // Derived
  CONSTANTS.SECTOR_SIZE_HALF = CONSTANTS.SECTOR_SIZE / 2;
  CONSTANTS.MS_PER_TICK      = 1000 / CONSTANTS.TICK_RATE;

  if (typeof module !== 'undefined') module.exports = CONSTANTS;
  else Object.assign(exports, { CONSTANTS });

})(typeof module !== 'undefined' ? module.exports : (window.Shared = window.Shared || {}));
