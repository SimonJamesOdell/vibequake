import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mapsDir = path.join(__dirname, '../data/maps')

const id = 'iron-cathedral'
const arenaHalfSize = 48
const ceilingY = 24

/** @typedef {{x:number,y:number,z:number}} Vec3 */

/** @type {Array<{min: Vec3, max: Vec3, points?: Vec3[]}>} */
const brushes = []

const addBox = (minX, minY, minZ, maxX, maxY, maxZ) => {
  brushes.push({
    min: { x: Math.min(minX, maxX), y: Math.min(minY, maxY), z: Math.min(minZ, maxZ) },
    max: { x: Math.max(minX, maxX), y: Math.max(minY, maxY), z: Math.max(minZ, maxZ) },
  })
}

const addConvexBrush = (points) => {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const zs = points.map((point) => point.z)
  brushes.push({
    min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
    max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
    points: points.map((point) => ({ ...point })),
  })
}

const addPyramidCap = (centerX, centerZ, halfWidth, halfDepth, baseY, apexY) => {
  addConvexBrush([
    { x: centerX - halfWidth, y: baseY, z: centerZ - halfDepth },
    { x: centerX + halfWidth, y: baseY, z: centerZ - halfDepth },
    { x: centerX - halfWidth, y: baseY, z: centerZ + halfDepth },
    { x: centerX + halfWidth, y: baseY, z: centerZ + halfDepth },
    { x: centerX, y: apexY, z: centerZ },
  ])
}

const addPitchedCap = (centerX, centerZ, halfWidth, halfDepth, baseY, apexY, axis = 'x') => {
  if (axis === 'x') {
    addConvexBrush([
      { x: centerX - halfWidth, y: baseY, z: centerZ - halfDepth },
      { x: centerX + halfWidth, y: baseY, z: centerZ - halfDepth },
      { x: centerX - halfWidth, y: baseY, z: centerZ + halfDepth },
      { x: centerX + halfWidth, y: baseY, z: centerZ + halfDepth },
      { x: centerX - halfWidth, y: apexY, z: centerZ },
      { x: centerX + halfWidth, y: apexY, z: centerZ },
    ])
    return
  }

  addConvexBrush([
    { x: centerX - halfWidth, y: baseY, z: centerZ - halfDepth },
    { x: centerX + halfWidth, y: baseY, z: centerZ - halfDepth },
    { x: centerX - halfWidth, y: baseY, z: centerZ + halfDepth },
    { x: centerX + halfWidth, y: baseY, z: centerZ + halfDepth },
    { x: centerX, y: apexY, z: centerZ - halfDepth },
    { x: centerX, y: apexY, z: centerZ + halfDepth },
  ])
}

// Perimeter shell and top cap to lock the arena volume.
addBox(-arenaHalfSize, 0, -arenaHalfSize, -arenaHalfSize + 3, 18, arenaHalfSize)
addBox(arenaHalfSize - 3, 0, -arenaHalfSize, arenaHalfSize, 18, arenaHalfSize)
addBox(-arenaHalfSize, 0, -arenaHalfSize, arenaHalfSize, 18, -arenaHalfSize + 3)
addBox(-arenaHalfSize, 0, arenaHalfSize - 3, arenaHalfSize, 18, arenaHalfSize)
addBox(-arenaHalfSize, ceilingY, -arenaHalfSize, arenaHalfSize, ceilingY + 1, arenaHalfSize)

// Main floor and ringed terraces (walkable surfaces).
addBox(-44, 0, -44, 44, 0.9, 44)
addBox(-34, 1.8, -34, 34, 2.6, 34)
addBox(-22, 3.6, -22, 22, 4.4, 22)

// Central dais with offset cross lanes.
addBox(-7, 5.2, -7, 7, 6.0, 7)
addBox(-20, 2.8, -3.5, 20, 3.5, 3.5)
addBox(-3.5, 2.8, -20, 3.5, 3.5, 20)

// Corner buttresses that create Quake-like sightline anchors.
for (const sx of [-1, 1]) {
  for (const sz of [-1, 1]) {
    const x = sx * 32
    const z = sz * 32
    addBox(x - 2.5, 0, z - 2.5, x + 2.5, 15, z + 2.5)
    addBox(x - 6, 0, z - 1.2, x + 6, 6.5, z + 1.2)
    addBox(x - 1.2, 0, z - 6, x + 1.2, 6.5, z + 6)
    addPyramidCap(x, z, 4.2, 4.2, 15, 22)
  }
}

// Nave-like side aisles and balcony teeth.
for (const z of [-28, -20, -12, 12, 20, 28]) {
  addBox(-40, 4.6, z - 2.5, -24, 5.3, z + 2.5)
  addBox(24, 4.6, z - 2.5, 40, 5.3, z + 2.5)
  addBox(-30, 0, z - 1, -28, 10 + (Math.abs(z) % 3), z + 1)
  addBox(28, 0, z - 1, 30, 10 + (Math.abs(z) % 3), z + 1)
}

// Layered stair runs (each step is a thin ground surface).
const addStairs = (x0, z0, dx, dz, steps, width, rise, run, baseY = 0.9) => {
  for (let i = 0; i < steps; i += 1) {
    const along = i * run
    const minX = x0 + dx * along - Math.abs(dz) * width * 0.5
    const maxX = x0 + dx * (along + run) + Math.abs(dz) * width * 0.5
    const minZ = z0 + dz * along - Math.abs(dx) * width * 0.5
    const maxZ = z0 + dz * (along + run) + Math.abs(dx) * width * 0.5
    const y = baseY + i * rise
    addBox(minX, y, minZ, maxX, y + 0.7, maxZ)
  }
}

addStairs(-34, -8, 1, 0, 9, 5.5, 0.38, 2.2)
addStairs(-34, 8, 1, 0, 9, 5.5, 0.38, 2.2)
addStairs(34, -8, -1, 0, 9, 5.5, 0.38, 2.2)
addStairs(34, 8, -1, 0, 9, 5.5, 0.38, 2.2)
addStairs(-8, -34, 0, 1, 9, 5.5, 0.38, 2.2)
addStairs(8, -34, 0, 1, 9, 5.5, 0.38, 2.2)
addStairs(-8, 34, 0, -1, 9, 5.5, 0.38, 2.2)
addStairs(8, 34, 0, -1, 9, 5.5, 0.38, 2.2)

// Mid-height bridge loops with intermittent blockers.
for (const x of [-16, -8, 0, 8, 16]) {
  addBox(x - 2.5, 6.8, -30, x + 2.5, 7.5, -10)
  addBox(x - 2.5, 6.8, 10, x + 2.5, 7.5, 30)
}
for (const z of [-16, -8, 0, 8, 16]) {
  addBox(-30, 6.8, z - 2.5, -10, 7.5, z + 2.5)
  addBox(10, 6.8, z - 2.5, 30, 7.5, z + 2.5)
}

// Upper galleries and suspended catwalks to give the arena real vertical routes.
addBox(-42, 9.6, -32, -28, 10.4, -12)
addBox(-42, 9.6, 12, -28, 10.4, 32)
addBox(28, 9.6, -32, 42, 10.4, -12)
addBox(28, 9.6, 12, 42, 10.4, 32)

addBox(-14, 11.8, -42, 14, 12.6, -30)
addBox(-14, 11.8, 30, 14, 12.6, 42)

addBox(-4, 13.6, -18, 4, 14.3, 18)
addBox(-18, 8.9, -4, 18, 9.6, 4)
addPitchedCap(0, -36, 16, 6, 12.6, 18.8, 'x')
addPitchedCap(0, 36, 16, 6, 12.6, 18.8, 'x')
addPitchedCap(0, 0, 6.6, 18, 14.3, 18.2, 'z')
addPitchedCap(-35, -22, 7, 11, 10.4, 15.2, 'z')
addPitchedCap(-35, 22, 7, 11, 10.4, 15.2, 'z')
addPitchedCap(35, -22, 7, 11, 10.4, 15.2, 'z')
addPitchedCap(35, 22, 7, 11, 10.4, 15.2, 'z')

// Access from mid bridges to the upper side galleries.
addStairs(-28, -18, -1, 0, 8, 4.4, 0.38, 2.1, 7.5)
addStairs(-28, 18, -1, 0, 8, 4.4, 0.38, 2.1, 7.5)
addStairs(28, -18, 1, 0, 8, 4.4, 0.38, 2.1, 7.5)
addStairs(28, 18, 1, 0, 8, 4.4, 0.38, 2.1, 7.5)

// Access from side galleries to the north/south gantries.
addStairs(-12, -30, 0, -1, 6, 4.2, 0.38, 2.0, 10.4)
addStairs(12, -30, 0, -1, 6, 4.2, 0.38, 2.0, 10.4)
addStairs(-12, 30, 0, 1, 6, 4.2, 0.38, 2.0, 10.4)
addStairs(12, 30, 0, 1, 6, 4.2, 0.38, 2.0, 10.4)

// Short climbs onto the central suspended spine.
addStairs(0, -18, 0, 1, 4, 3.8, 0.34, 3.0, 12.6)
addStairs(0, 18, 0, -1, 4, 3.8, 0.34, 3.0, 12.6)

for (const x of [-20, -12, 12, 20]) {
  addBox(x - 1.1, 0, -1.8, x + 1.1, 12.5, 1.8)
}
for (const z of [-20, -12, 12, 20]) {
  addBox(-1.8, 0, z - 1.1, 1.8, 12.5, z + 1.1)
}

// Notched pillar field to avoid flat emptiness and force strafing arcs.
for (const x of [-26, -18, -10, 10, 18, 26]) {
  for (const z of [-26, -18, -10, 10, 18, 26]) {
    if (Math.abs(x) === Math.abs(z) || (Math.abs(x) <= 10 && Math.abs(z) <= 10)) {
      continue
    }
    const h = 5 + ((Math.abs(x + z) / 8) % 5)
    addBox(x - 1.4, 0, z - 1.4, x + 1.4, h, z + 1.4)
  }
}

// Long chokepoint bars around central lanes.
addBox(-30, 0, -5, -12, 8.6, -2.8)
addBox(12, 0, -5, 30, 8.6, -2.8)
addBox(-30, 0, 2.8, -12, 8.6, 5)
addBox(12, 0, 2.8, 30, 8.6, 5)
addBox(-5, 0, -30, -2.8, 8.6, -12)
addBox(2.8, 0, -30, 5, 8.6, -12)
addBox(-5, 0, 12, -2.8, 8.6, 30)
addBox(2.8, 0, 12, 5, 8.6, 30)

const map = {
  id,
  name: 'Iron Cathedral',
  description: 'Hand-authored synthetic Quake-like arena with ring terraces, nave bridges, and dense blocker rhythm.',
  format: 'brush-map',
  sourceFormat: 'brush-map',
  license: 'CC0-1.0',
  attribution: 'Generated by generate-iron-cathedral.mjs',
  visualTheme: 'industrial-rust',
  bounds: {
    min: { x: -arenaHalfSize, y: 0, z: -arenaHalfSize },
    max: { x: arenaHalfSize, y: ceilingY + 1, z: arenaHalfSize },
  },
  brushes,
  playerSpawn: { x: 0, y: 1.6, z: -38 },
  enemySpawns: [
    { x: -34, y: 1.1, z: -34 },
    { x: 34, y: 1.1, z: -34 },
    { x: -34, y: 1.1, z: 34 },
    { x: 34, y: 1.1, z: 34 },
    { x: -20, y: 1.1, z: 0 },
    { x: 20, y: 1.1, z: 0 },
    { x: 0, y: 1.1, z: -20 },
    { x: 0, y: 1.1, z: 20 },
    { x: -12, y: 1.1, z: 12 },
    { x: 12, y: 1.1, z: -12 },
  ],
  updatedAt: new Date().toISOString(),
}

const outPath = path.join(mapsDir, `${id}.json`)
await fs.writeFile(outPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
console.log(`Generated ${id} with ${brushes.length} brushes -> ${outPath}`)
