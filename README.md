# VibeQuake

VibeQuake is a browser-first WebGL FPS prototype built with Vite, TypeScript, and Three.js. It aims for the speed and pressure of a classic arena shooter while primarily using procedural content, while still allowing explicitly open-licensed art where it materially improves the prototype.

The project now includes a small Node/Express backend for persistent high scores and file-backed map loading/editing, with runtime support for Quake-family `.map` imports normalized into a brush-based arena format.

Imported maps are now gated by explicit license metadata. The importer only accepts maps when you provide an approved open license and provenance for the source.

## Current Prototype

- Pointer-lock first person controls with mouse look
- WASD movement, sprinting, jumping, gravity, and wall collision
- Dynamic-lit arena with procedural floor, wall, and ceiling materials
- Hitscan weapon, muzzle flash, impact particles, enemy respawns, health, and score HUD
- Open-licensed animated enemy models integrated from Poly Pizza
- Responsive full-screen presentation for desktop and mobile-sized viewports

## Asset Attribution

- Enemy model `Zombie` by `Quaternius`, sourced from `https://poly.pizza/m/dIHWksvCOF`, licensed `CC0 1.0`
- Enemy model `Green Spiky Blob` by `Quaternius`, sourced from `https://poly.pizza/m/axOSBJbWaa`, licensed `CC0 1.0`
- Enemy model `Glub Evolved` by `Quaternius`, sourced from `https://poly.pizza/m/0KGqZ1Jd9R`, licensed `CC0 1.0`
- Local attribution record: `public/models/ATTRIBUTION.md`

## Controls

- Click `Engage Arena` or the viewport to capture the mouse
- `W`, `A`, `S`, `D` to move
- `Shift` to surge forward faster
- `Space` to jump
- Left mouse button to fire
- `Esc` to release pointer lock

## Development

```bash
npm install
npm run dev
```

`npm run dev` starts both the Vite client and the backend API together. The client proxies `/api/*` calls to `http://localhost:3001` during development.

For a production build:

```bash
npm run build
```

To run the compiled backend after building:

```bash
npm run start
```

## Backend Data

- High scores are stored in [data/highscores.json](data/highscores.json)
- Maps are stored as JSON files under [data/maps/cathedral-cavern.json](data/maps/cathedral-cavern.json)
- The renderer now consumes normalized brush maps with world-space bounds, brushes, and vector spawns
- Legacy tile maps are still normalized on the backend so the original seed map keeps working during the migration

## API

- `GET /api/health`: backend health check
- `GET /api/highscores?limit=10`: top scores sorted descending
- `POST /api/highscores`: submit `{ "name": string, "score": number, "mapId": string }`
- `GET /api/maps`: list map summaries
- `GET /api/maps/:id`: load a full map definition
- `POST /api/maps`: create a new map JSON file
- `POST /api/maps/import`: fetch a compatible remote JSON map or Quake `.map` source over HTTPS and store it locally as a normalized brush map
- `PUT /api/maps/:id`: edit an existing map JSON file

Approved licenses for imported maps:

- `MIT`
- `Apache-2.0`
- `BSD-2-Clause`
- `BSD-3-Clause`
- `ISC`
- `MPL-2.0`
- `GPL-2.0-only`
- `GPL-2.0-or-later`
- `GPL-3.0-only`
- `GPL-3.0-or-later`
- `LGPL-2.1-only`
- `LGPL-2.1-or-later`
- `LGPL-3.0-only`
- `LGPL-3.0-or-later`
- `AGPL-3.0-only`
- `AGPL-3.0-or-later`
- `CC0-1.0`
- `CC-BY-4.0`
- `CC-BY-SA-4.0`

Example score submission:

```bash
curl -X POST http://localhost:3001/api/highscores \
	-H "Content-Type: application/json" \
	-d '{"name":"Anonymous","score":12,"mapId":"cathedral-cavern"}'
```

Example map update:

```bash
curl -X PUT http://localhost:3001/api/maps/cathedral-cavern \
	-H "Content-Type: application/json" \
	--data-binary @data/maps/cathedral-cavern.json
```

Example remote map import from a Quake `.map` or compatible JSON URL:

```bash
curl -X POST http://localhost:3001/api/maps/import \
	-H "Content-Type: application/json" \
	-d '{"url":"https://raw.githubusercontent.com/your-org/your-repo/main/maps/cathedral-cavern.json","license":"CC-BY-SA-4.0","attribution":"Map by Example Author"}'
```

To load a stored map in the client, open the game with a query parameter such as `/?map=cathedral-cavern`.

## Open Source Map Repositories

There are open-source FPS map repositories available. For example, Xonotic publishes official map sources in [xonotic/xonotic-maps.pk3dir](https://github.com/xonotic/xonotic-maps.pk3dir). Those maps are authored in Quake-family source formats, and VibeQuake now imports that class of map by parsing brush geometry and spawn entities into its runtime brush-map contract.

The current importer is intentionally pragmatic: it handles brush/entity source maps and approximates brushes as world-space solids for rendering and collision. That makes Quake-style source maps loadable now, while leaving room for a more exact brush/plane renderer later.

The importer does not attempt to infer legal status from a repository page. It requires explicit license declaration on import, records source provenance with the stored map, and rejects anything outside the approved license list.

One remaining legal gap is this repository itself: there is still no top-level LICENSE file in the project, so the codebase is not formally open source until that is added.

## Next Build Targets

- Replace simple enemy steering with navigation and projectile attacks
- Add authored level chunks, pickups, audio, and combat feedback
- Introduce post-processing and richer material detail while preserving frame rate
