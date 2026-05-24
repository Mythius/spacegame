# SpaceGame — Codebase Notes for Claude

## Rendering rule: always use PolarObject

**Every in-game visual object must be rendered via [PolarObject](site/polar-object.js).**

This covers ships, ore deposits, buildings, and ship components.  
Never add a hardcoded polygon, triangle, or rectangle renderer for a game object.  
Create the art with the Shape Editor (`/editor.html`) and save it to `/assets/<name>.json`.

### The only acceptable rectangle fallback

A `ctx.fillRect` is acceptable **only** when the asset JSON could not be found/loaded for a
given object.  When falling back to a rectangle, you must also log **once** (not every frame):

```js
if (!_warnedPolarKeys.has(key)) {
  console.log(`[PolarObject] no asset defined for "${key}"`);
  _warnedPolarKeys.add(key);
}
// then ctx.fillRect(...)
```

### Wiring up a new object type

1. Create the asset in the Shape Editor and save to `/assets/<name>.json`.
2. Add an `asset` (and optionally `scale`) field to the object's definition:
   - **Buildings** — `BUILDING_REGISTRY` in [shared/buildings.js](shared/buildings.js)
   - **Ships** — `SHIP_TEMPLATES` in [shared/ships.js](shared/ships.js)
   - **Components** — `COMPONENT_REGISTRY` in [shared/components.js](shared/components.js)
3. Use the appropriate polar cache helper (`_getShipPolar`, `_getOrePolar`,
   `_getPlacementPolar`, `_getCompShape`, `_getMiniShape`) — or create a new one
   following the same pattern — to lazy-load and reuse the `PolarObject`.
4. Set `polar.x`, `polar.y`, `polar.direction` (degrees), and `polar.scale` before
   calling `polar.render(ctx)`.

### PolarObject quick reference

| Property | Type | Notes |
|---|---|---|
| `x`, `y` | number | World/screen position |
| `scale` | number | Size multiplier |
| `direction` | number | Rotation in **degrees** |
| `flipH`, `flipV` | boolean | Mirror flags |
| `lineWidth` | number | Stroke width (default 2) |
| `colorOverride` | string \| null | Overrides all segment colors when set |
| `visible` | boolean | Set via `show()` / `hide()` |
| `loaded` | boolean | True after the JSON asset fetch completes |
| `onload` | function \| null | Called once when asset finishes loading |

Call `polar.show()` (or set `onload = () => polar.show()`) so the object becomes
visible after its JSON loads.

## Code organisation

- Keep rendering logic in the existing class structure (`BuildSystem`, `PlacedBuilding`,
  `Camera`, etc.).  Avoid loose procedural functions for new features.
- Shared game logic lives in `shared/` and runs on both server (Node) and browser.
- Site-only rendering/input code lives in `site/`.
