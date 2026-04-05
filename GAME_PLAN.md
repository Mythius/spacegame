# Spacegame — Master Plan

> Living document. Update the "Session Log" and decision statuses as work progresses.

---

## Vision

A two-phase space game:

1. **Meteor Base Phase** — You live on a meteorite. Mine ore, smelt metals, fabricate components, assemble and launch a ship. Factory-builder meets survival.
2. **Space Combat Phase** — Fly your designed ship in a persistent sector map. Fight other players (online PvP) or conquer AI-controlled planets (story mode).

The phases are linked: the base phase produces the ship you fly in the combat phase. Dying in combat sends you back to rebuild.

---

## What Already Exists

| System | File(s) | Status |
|---|---|---|
| Express + Socket.io server | `index.js` | ✅ Working |
| Shape editor | `site/editor.js/.html` | ✅ Working |
| Beam editor | `site/beam_editor.js/.html` | ✅ Working |
| Build system (place components on grid) | `site/build_system.js` | ✅ Working |
| Polar-coord rendering | `site/polar-object.js` | ✅ Working |
| Multiplayer skeleton (4-player lobby, teams, socket events) | `index.js`, `site/main.js` | ⚠️ Skeleton only |
| Ship/Bullet/Mothership classes | `index.js` | ⚠️ Skeleton only |
| Game loop (30fps, render broadcast, input collection) | `index.js` | ⚠️ Loop runs, `updateGame()` is empty |
| `Material`, `TradingPost` classes | `index.js` | ❌ Empty stubs |
| Bomb explosion logic | `index.js` | ❌ TODO |

---

## Architecture Decision: Shared Libraries

### Problem
Physics, collision, ship stats, resource recipes — these need to run on both server (authoritative) and client (prediction/display). Currently there is no sharing mechanism.

### Chosen Approach — Zero-Build-Tool Isomorphic JS

Create a `shared/` directory at the project root. Files are served statically to the browser **and** `require()`d by Node.js using a universal module wrapper:

```javascript
// shared/physics.js
(function (root) {
  // ... all logic here, no DOM, no require() calls ...
  const exports = { Vector, Line, collide };
  if (typeof module !== 'undefined') module.exports = exports;
  else Object.assign(root, exports);
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

**Server:**
```javascript
const { Vector, collide } = require('./shared/physics');
app.use('/shared', express.static(path + 'shared/'));
```

**Client:**
```html
<script src="/shared/physics.js"></script>
<!-- Vector, collide are now globals -->
```

### Shared Modules Planned

| File | Contents |
|---|---|
| `shared/physics.js` | `Vector`, `Line`, movement, collision AABB |
| `shared/ship-stats.js` | Stat formulas (speed, health, damage from components) |
| `shared/resources.js` | Resource types, crafting recipes, fabrication costs |
| `shared/world.js` | `Sector`, `Space`, coordinate math |
| `shared/constants.js` | Game-wide tuning values (tick rate, sector size, etc.) |

---

## Phase 1 — Meteor Base

### Concept
A medium-sized meteorite is your home. It has ore deposits scattered across it. You place mining drills, smelters, fabricators, and launchpads on the surface. Once your ship's components are fabricated and assembled, you launch into Phase 2.

### View
**Top-down 2D**, consistent with the space combat view. The meteorite is a roughly circular irregular shape ~2000×2000 units, rendered on a scrollable canvas (camera pans with WASD/drag).

### Terrain
- Procedurally generated irregular polygon (from the shape editor's polar coord system)
- Ore patches placed at generation time (Iron, Crystal, Helium-3)
- Terrain does not deform (simplification for v1)

### Resource Tiers

**Tier 1 — Basic (infinite, always available):**
| Resource | Source | Used For |
|---|---|---|
| Iron | Meteor ore patches, asteroid mining | Hull plating, structural frames, basic ammo |
| Carbon | Meteor surface, asteroid mining | Wiring, pipes, basic fabrication |
| Helium-3 | Meteor gas vents, asteroid gas pockets | Core fuel, thruster boost |

Story mode: basic resources are fully infinite on your base. Combat mode: same, but deposits on shared asteroids can be competed over.

**Tier 2 — Finite deposits (deplete and respawn):**
| Resource | Source | Deposit Size | Respawn |
|---|---|---|---|
| Crystal | Asteroid belt, planet surface | ~1000 units | Respawns after ~30 min if no base nearby |
| Titanium | Asteroid belt craters, boss drops | ~1000 units | Respawns after ~30 min if no base nearby |
| Plasma Gel | Planet storms, boss fights only | ~500 units | Respawns next storm window |

Deposit logic: server tracks a `collected` counter per deposit. At cap (~1000), deposit is marked exhausted. A respawn timer starts. If no player base is within range when the timer fires, the deposit regenerates. If a base IS nearby, it stays exhausted (you have to abandon or vacate the area). Prevents anyone from camping indefinitely.

**Tier 3 — Rare / Boss-only (no respawn, finite per planet):**
| Resource | Source | Notes |
|---|---|---|
| Void Crystal | Planet boss vault, deep space derelicts | Required for top-tier components |
| Fusion Core fragment | Boss AI core drop | 1 per boss kill; required for advanced reactor |
| Ancient Schematics | Hidden caches on conquered planets | Blueprint unlocks |

Rare resources drive the progression economy. They cannot be farmed — each planet gives a fixed pool, and boss kills are the only renewable source (once per storm window for combat mode planets).

### Buildings
| Building | Input | Output |
|---|---|---|
| Mining Drill | Placed on ore patch | Raw ore over time |
| Smelter | Raw ore + Energy | Refined metal / crystal |
| Fabricator | Materials + schematic | Ship component |
| Solar Panel | — | Energy |
| Reactor | Helium-3 | Energy (more than solar) |
| Launchpad | Completed ship | Launches Phase 2 |
| Storage | — | Increases resource cap |

Buildings are placed on a grid (same grid system as `build_system.js`). Each building is a polar-coord vector art asset.

### Ship Assembly
- You design a ship in the Ship Designer (already partially working via editor + build system)
- The ship definition lists required components and their material costs
- When all components are fabricated, the Launchpad becomes active
- Launching transitions you to Phase 2

### Multiplayer for Base Phase — CO-OP (DECIDED)
The base is shared between a party of friends. All party members:
- See the same meteor in real-time (server-authoritative state)
- Share the same resource pool
- Can place/remove buildings simultaneously
- All must be ready before the launchpad activates
- Launch together into the same combat sector

**Party formation:** One player creates a party and shares an invite code (or invite by name). Others join via that code. **Story mode: 1–4 players** (no minimum — fully solo playable). **Combat mode: no party size cap** — players group into Houses (see below).

**Sync model:** Base state lives on server. Each `base:place` / `base:remove` event is broadcast to all party members. Resource tick (`base:tick`) sent to all party members every second.

**Co-op implications for D3 (lobby):** The combat phase should also be party-based but open-world — your party shares a combat ship formation and fights alongside each other against other parties or NPC planets. This replaces the existing 4-friend-required launch.

### Persistence
Player base state is saved as a JSON file per player: `saves/{player_id}/base.json`. This is consistent with the existing file-save pattern.

---

## Phase 2 — Space Combat

### World Structure
A bounded solar system divided into large sectors:
- **Inner zone** — rocky planets, high-value resources, frequent storm windows, intense PvP
- **Asteroid belt** — primary mining zone, House bases, mid-tier resources
- **Outer zone** — gas giants, rare Helium-3, fewer players, longer travel times
- **Deep space** — extreme danger, unknown ruins, highest-tier blueprints

Each sector is large enough to have distinct features (asteroid clusters, nebula clouds, debris fields, derelict ships). Players can be in different sectors simultaneously.

### Travel — Warp System
- Ships fly freely within a sector in real-time
- To move between sectors: charge a **warp drive** (1-minute charge-up)
- During warp charge-up: shields are disabled, ship glows visibly — vulnerable window
- Warp out is instantaneous once charged
- Strategic tension: commit to leaving (glow and become a target) or abort and stay

### Avatar / Player Character
Every player controls a physical avatar in addition to piloting their ship:
- Top-down 2D movement (WASD), same coordinate system as the world
- Avatar can be inside their ship (walking through interior grid corridors)
- Avatar can EVA (spacewalk) outside the ship in open space
- Avatar can board other ships (airlock breach or open hatch)
- Avatar interacts with components (E to operate, repair, sabotage)
- Avatar has basic personal weapons for boarding combat
- On planet surfaces: avatar navigates the planet base grid on foot
- Scale: ship interior is several screens large — a meaningful space to traverse

### Ship Layer System — Shields → Armor → Interior
Ships have three defensive layers, each requiring different tactics to breach:

```
[ Shield bubble ]         ← projected by shield generator(s)
  └─ [ Exterior armor ]   ← outer grid cells, absorb hits
       └─ [ Interior ]    ← components, core, crew
```

**1. Shield layer:**
- Absorbs all damage while active
- Rechargeable — drops temporarily under sustained fire, then recovers
- To permanently remove shields: destroy the shield generator (interior component)
- Locating the generator requires breaching armor in the right section

**2. Exterior armor layer:**
- Each exterior grid cell is an armor panel with its own HP
- Hits are positional — a shot at the left side damages left-side panels
- Breached panels expose the interior section behind them
- Armor can be repaired by an avatar walking to that cell with materials

**3. Interior layer:**
- Once exterior is breached in a section, shots can reach interior components
- Critical targets: Core, Shield Generator, Thruster banks, Fabricator
- Destroying the Core kills the ship
- A crew member (avatar) can repair interior components during combat

### Multi-Crew Ships
Players can fly their own ship solo, or multiple players can crew one larger ship:

| Role | What they do |
|---|---|
| Pilot | WASD flight, warp charging |
| Gunner(s) | Operate individual turrets manually |
| Engineer | Walk the interior grid, repair hull breaches in real-time |
| Claw Operator | Operate the Giant Claw attachment |
| Navigator | Manage sector map, call out targets |

- A solo player handles all roles (automated turrets, no claw)
- Larger ships have more turret hardpoints, requiring more gunners to be effective
- Multi-crew ships are harder to kill (active repair) but require coordination

### Death & Retreat
Two outcomes when taking heavy damage:

**Retreat (≤5% hull remaining):**
- Flashing `[ RETREAT ]` button on HUD, 8-second window
- Triggers warp-out animation, ship exits combat immediately
- Ship arrives at base in damaged state — grounded until repaired
- Repair = open ship interior grid, manually patch each damaged cell with materials
- Party continues fighting without you

**Destruction (hull = 0%):**
- Ship explodes, all exterior components scatter as salvage pickups
- Avatar ejects in an escape pod (lands somewhere in the sector)
- Player returns to base with no ship; must rebuild from blueprints
- Party/House members can scoop your salvage

### Giant Claw (Late-Game Attachment)
- An exterior attachment placed on the ship grid (takes 2–3 cells)
- Operated by a dedicated Claw Operator crew member (or pilot in solo)
- When in close range of a disabled/retreating/distracted ship:
  - Deploy claw, aim at a specific exterior panel of the target
  - Lock-on takes 3–5 seconds (target can break free by boosting)
  - On success: tears off that component, adds it to your cargo
  - Target ship takes hull damage at the breach point
- Use cases: steal a rare blueprint component, loot an enemy's fabricator, strip a turret
- Counter-play: engineer inside the ship can cut the cables and release the claw's grip

### Houses (Combat Mode Only)
Houses are persistent player alliances in combat mode:
- Any player can create or join a House (no cap on size)
- Houses can claim **asteroid bases** and **planet surface bases** (combat mode only — reset on storm)
- A House base is a full grid-based installation: turrets, shield generators, storage, refineries
- House bases are **raidable** — other Houses can attack and loot them
- House hierarchy: Leader, Officers, Members (with different build/loot permissions)

**Houses are a convenience, not a gate.** A solo player can always reach the same content as a large House — it just takes longer. Houses provide faster access to valuable sectors and shared defense of finite-deposit zones. A patient solo player with a high-tier ship can accomplish everything a House can. The game rewards both playstyles.

### Story Mode — Blueprint Progression
Story mode is centered on **collecting blueprints**:
- Each planet has a hidden blueprint cache — fragments of advanced schematics
- Conquering a planet unlocks its blueprint(s)
- Blueprints unlock: new component types, better guns, advanced armor, exotic ship parts
- Some blueprints require multiple planet fragments to complete (encourages full progression)
- Basic resources are **infinite** in story mode — focus is on exploration and combat, not grinding
- Rare resources come from boss fights and planet vaults — finite per planet but renewable via boss respawns
- **Permanent planet bases**: in story mode, conquered planets can host a permanent base
  - Same grid-building system as the meteor base
  - Generates passive resources while you're elsewhere
  - Can be garrisoned with turrets and drones for defense
  - If re-invaded by AI (planet re-activates) you must defend or lose it
- Story mode: **1–4 players, fully solo playable**

### Story Mode AI Base Structure
Each planet has a grid-based AI installation:
- **Core** — destroy to conquer (often shielded, deep in the layout)
- **Shield generators** — powering the Core's shields; destroying them exposes the Core
- **Power sources** — cutting them cascades (shields fail, turrets go offline)
- **Turrets** — beam and projectile, placed at defensive choke points
- **Drone bays** — spawn small patrol drones; destroy the bay to stop respawns
- **Drills** — the planet actively mines; destroy to cut resource regen
- Tactical route: Power → Shields → Drones → Core (or brute-force through heavy fire)

---

## Key Decisions — Needs Your Input

Mark each as **DECIDED** or update the chosen option.

---

### D1 — Base Phase Multiplayer
**Question:** Is the meteorite base private (solo) or can other players interact with it?

**✅ DECIDED: Option B — Cooperative.** Friends join your base via invite. Shared resource pool, shared buildings, launch together. MMO-style raiding/open world deferred to a later version.

---

### D2 — Death Penalty in Combat
**Question:** What happens when your ship is destroyed?

**✅ DECIDED: Both paths exist.**
- **Retreat** (≤5% hull): ship survives, returns to base damaged, repair costs materials
- **Destruction** (hull = 0): ship lost, return to base, rebuild from blueprints
- Dropped components are salvageable pickups in the combat sector

---

### D3 — World Structure
**✅ DECIDED: Two modes with different world structures.**

**Co-op / Story Mode:**
- Planet-to-planet progression, fully persistent
- Each planet is a self-contained level with its own AI base (turrets, drones, shield generators, power grid, drills)
- After conquering a planet you can set up a permanent base on its surface
- Builds toward a campaign arc

**Open Solar System / Combat Mode:**
- Bounded solar system (not infinite): star at center, inner rocky planets, asteroid belt, outer gas giants
- Multiple distinct zones: open space, asteroid fields, planet orbits, debris clouds
- All players exist in the same persistent solar system simultaneously
- **Planet Storm Windows:** Planets are normally inaccessible due to extreme storms. Periodically a storm clears, a server-wide event fires ("Planet X is open — 12 minutes"), players race to the surface to mine and fight. When the storm returns, anyone still on the surface takes escalating damage until they escape or die. This is the main PvP/PvE event loop.
- Between events: mining asteroids, fighting other players in open space, traveling between zones, building up your meteor base

---

### D4 — Ship Design → Stats
**✅ DECIDED: Component placement drives all stats.**
- **Thrusters** → speed and maneuverability (count and placement matter)
- **Armor panels** → health pool (coverage and thickness)
- **Ship size / hull** → base health, determines interior grid dimensions
- **Gun type** → damage, fire rate, ammo type required
- **Core (nuclear reactor)** → powers everything; runs long but consumes Helium-3. Running dry does NOT kill the ship — systems degrade in order: speed drops → weapons offline → shields fail. Ship stays alive, just slow and defenseless. Refuel from onboard Helium-3 storage.
- Custom ammo required for higher-tier weapons (crafted at base or in ship fabricator)

### Ship Interior Grid (NEW — DECIDED)
Every ship has an **interior grid** in addition to the exterior vector art. The interior is the ship's functional layer.

**Interior components:**
- **Core** (nuclear reactor) — required, powers all systems, needs fuel
- **Armor panels** — fill grid cells, determine hull strength
- **Turrets** — connect to weapon hardpoints on the exterior
- **Shield generators** — project shields, need wiring to core
- **Drills** — used while docked to a rock, extract resources
- **Storage tanks** — hold resources and ammo
- **Fabricator** — craft ammo and small components while in flight
- **Wiring** — connects components to core (power routing)
- **Pipes/tubes** — routes resources between storage and consumers
- **Thrusters** — placed on grid edges, direction matters

**Repair mechanic:** Damage destroys specific grid cells. To repair, you open the ship interior view and manually replace/patch damaged cells using materials from storage. This is the same grid-building mechanic as the meteor base — consistent feel across the whole game.

**Relationship between exterior art and interior grid:** The exterior polar-coord art is purely visual. The interior grid dimensions are set when you design the ship (hull size). Larger hull = bigger grid = more components = more powerful but slower to build.

---

### D5 — Persistence Backend
**✅ DECIDED: JSON files per player on server** (`saves/{player_id}/`)

---

### D6 — Terrain Generation
**✅ DECIDED: Procedural generation + asteroid tethering.**
- Home meteor generated at account creation, saved to `base.json`
- Uses the existing polar-coord system for the meteor shape
- Ore deposits placed procedurally across the surface
- **Asteroid Tethering:** Players can build a Tether structure at the edge of their base. Nearby free-floating asteroids can be pulled in and locked to the base. Tethered asteroids:
  - Become part of the base grid (buildings can be placed on them)
  - Bring their own ore deposits
  - Can be detethered and released
  - Have a max tether count (1–3 simultaneously, upgradeable)
  - The combined shape is an irregular multi-body base — visually striking

---

### D7 — Planet AI
**✅ DECIDED: Full AI base with static turrets + patrol drones.**

Planets have a complete base layout (same grid system as player base):
- **Core** — destroy it to conquer the planet (or it can be shielded)
- **Turrets** — beam and projectile, placed at defensive positions
- **Shield generators** — must be destroyed or power-cut before the core is vulnerable
- **Power sources** — destroying them cascades (cuts shields, disables turrets)
- **Drills** — the planet is actively mining; stopping them cuts its resource regeneration
- **Drones** — small autonomous patrol units, simple AI (move toward nearest enemy, shoot)
  - Spawn from drone bays on the planet base
  - Can be captured if their bay is destroyed (they go dormant)

**Tactical depth:** Attack the power grid → shields fail → core exposed. Or rush the core directly through heavy fire. Different planets have different layouts making each feel unique.

---

## Implementation Roadmap

Sessions are rough estimates. Adjust as decisions are made.

```
FOUNDATION
Session 1–2   Planning & all decisions ✅
Session 3     Shared library scaffolding (shared/ dir, physics, constants, resources)
Session 4     Player persistence + party/house system (saves/, invite codes)

METEOR BASE
Session 5     Base rendering (scrollable camera, procedural meteor, grid overlay)
Session 6     Avatar on base (movement, interaction, EVA scaffolding)
Session 7     Buildings (placement, energy system, server tick)
Session 8     Mining & resource flow (drills, smelters, storage)
Session 9     Asteroid tethering (tether structure, attach/detach, build on tethered rocks)
Session 10    Fabrication & ship assembly (recipes, component fabrication, launchpad)
Session 11    Co-op base sync (base:changed broadcast, ready states, party HUD)

SHIP INTERIOR
Session 12    Ship interior grid (design tool, cell types, core placement)
Session 13    Ship stats from interior (shared/ship-stats.js driving speed/health/damage)
Session 14    Ship damage model (positional hits → exterior panels → interior cells)
Session 15    Repair mechanic (avatar walks to cell, patches with materials)

COMBAT WORLD
Session 16    Solar system map (sector layout, zone definitions, warp UI)
Session 17    Phase transition (launch → combat, warp-in animation)
Session 18    Combat movement & collision (ships, bullets, beams, physics)
Session 19    Shield system (bubble, recharge, generator targeting)
Session 20    Warp charging (1-min window, vulnerability, abort)
Session 21    Death & retreat (5% threshold, warp-out, salvage drops, pod eject)
Session 22    Avatar in combat (EVA, boarding, interior traversal)

SOCIAL & PROGRESSION
Session 23    House system (create, join, permissions, shared base)
Session 24    House bases (raidable asteroid/planet bases, combat mode)
Session 25    Story mode planet AI (full base layout, turrets, drones, power cascade)
Session 26    Blueprint system (drops, collection, unlock new components)
Session 27    Planet storm events (timer, server broadcast, escalating damage)

LATE GAME
Session 28    Giant claw (attachment, operator role, steal component mechanic)
Session 29    Multi-crew ships (role assignment, gunner control, engineer repair loop)
Session 30    Story mode permanent planet bases (garrisoning, AI re-invasion)
Session 31    HUD polish (minimap, inventory, storm timer, house UI)
Session 32    Balance & playtesting
```

---

## Technical Notes

### Server File Structure (Target)
```
spacegame/
  index.js              ← server entry, add /shared static route
  shared/               ← NEW: isomorphic modules
    constants.js
    physics.js
    ship-stats.js
    resources.js
    world.js
  site/                 ← client
    index.html
    base.html           ← NEW: meteor base game page
    combat.html         ← NEW: space combat page (replaces current index)
    base_game.js        ← NEW: base phase client
    combat_game.js      ← NEW: combat phase client (evolves from game.js)
    editor.html / .js
    beam_editor.html / .js
    build_system.js
    polar-object.js
    beam.js
    helpers.js
    mouse.js
  assets/               ← polar-coord JSON art
    beams/
    buildings/          ← NEW
    ships/              ← NEW (or rename from existing)
  saves/                ← NEW: per-player persistence
    {player_id}/
      base.json
      ship.json
      progress.json
```

### Socket Event Plan (Target)
```
Client → Server:
  login              name → assigns player_id, loads/creates save
  party:create       {} → creates party, returns invite_code
  party:join         {invite_code}
  party:leave        {}
  house:create       {name} → combat mode only
  house:join         {house_id}
  house:leave        {}
  base:place         {building, x, y}
  base:remove        {x, y}
  base:ready         {}
  base:launch        {} → validates ship, transition to combat
  combat:ship_input  {direction, firing, target_x, target_y, warp_charging}
  combat:avatar_input {dx, dy, interacting, boarding_target}
  combat:retreat     {} → ≤5% hull only
  combat:warp        {target_sector}
  combat:claw_deploy {target_ship_id, target_cell}
  combat:join_crew   {ship_id, role}
  combat:leave_crew  {}

Server → Client:
  save:loaded        {base, ship, progress, party, house}
  party:updated      {members, invite_code}
  base:tick          {resources, buildings, ready_states} (1/s)
  base:changed       {buildings}
  combat:render      {ships, avatars, bullets, beams, planets, salvage} (30/s)
  combat:joined      {sector, position}
  combat:storm_open  {planet_id, duration_ms} → broadcast to all players
  combat:storm_warn  {planet_id, seconds_remaining} → 60s and 30s warnings
  combat:storm_close {planet_id}
  combat:retreat_ack {player_id}
  combat:died        {player_id, killer, salvage_id}
  combat:blueprint   {blueprint_id, name} → found a new blueprint
```

### Tick Architecture
- **Base phase**: 1 tick/second (resource accumulation is slow-paced)
- **Combat phase**: 30 ticks/second (existing loop)
- Both run in the same `setInterval` chain on the server

---

## Session Log

| Session | Date | Work Done |
|---|---|---|
| 0 | — | Initial codebase: editor, beam editor, build system, multiplayer skeleton |
| 1 | 2026-04-04 | Game plan written. D1 decided (co-op base). D2 decided (retreat + destruction). |
| 2 | 2026-04-04 | D3–D7 all decided. Ship interior grid. Shield layer system. Avatar. Multi-crew. Houses. Giant Claw. Blueprint progression. Planet storms. Asteroid tethering. Story mode 1–4 players. |
| 3 | 2026-04-04 | Resource tiers (infinite basic, finite T2 with respawn logic, rare boss-only T3). Fuel depletion = graceful degradation. Storms optional. Houses = convenience not gate. Solo always viable. |
| 4 | 2026-04-04 | Avatar has simple point-and-shoot weapon, disables components. Zoom in/out on ship. Soft sector boundaries (force repulsion + visual). Mid-tier deposits tetherable. Raycasting shadows noted as future visual. OOP + registry pattern for extensibility. Shared library foundation built. |
