import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const mapsDir = path.join(__dirname, '../data/maps')

// Arena dimensions matching STORMKEEP (72x92 base, 78 height)
const WIDTH = 72
const DEPTH = 92
const HEIGHT = 78
const HALF_WIDTH = WIDTH / 2
const HALF_DEPTH = DEPTH / 2

// Generate a brush from min/max bounds
function createBrush(min, max, texture = 'exx/base-metal04') {
  const points = [
    // Bottom corners
    { x: min.x, y: min.y, z: min.z },
    { x: max.x, y: min.y, z: min.z },
    { x: max.x, y: max.y, z: min.z },
    { x: min.x, y: max.y, z: min.z },
    // Top corners
    { x: min.x, y: min.y, z: max.z },
    { x: max.x, y: min.y, z: max.z },
    { x: max.x, y: max.y, z: max.z },
    { x: min.x, y: max.y, z: max.z },
  ]

  const faces = [
    // Bottom
    { texture: 'liquid/water', points: [points[0], points[1], points[2], points[3]] },
    // Top
    { texture, points: [points[4], points[7], points[6], points[5]] },
    // Front
    { texture, points: [points[0], points[4], points[5], points[1]] },
    // Back
    { texture, points: [points[2], points[6], points[7], points[3]] },
    // Left
    { texture, points: [points[0], points[3], points[7], points[4]] },
    // Right
    { texture, points: [points[1], points[5], points[6], points[2]] },
  ]

  return {
    min,
    max,
    points,
    faces,
  }
}

// Create the arena map
const brushes = []

// Flat ground floor
const floorBrush = createBrush(
  { x: -HALF_WIDTH, y: 0, z: -HALF_DEPTH },
  { x: HALF_WIDTH, y: 0.1, z: HALF_DEPTH },
  'liquid/water'
)
// Override all floor faces to use liquid texture
floorBrush.faces.forEach(f => {
  f.texture = 'liquid/water'
})
brushes.push(floorBrush)

// Sky dome (ceiling)
const skyHeight = HEIGHT
brushes.push(createBrush(
  { x: -HALF_WIDTH, y: skyHeight, z: -HALF_DEPTH },
  { x: HALF_WIDTH, y: skyHeight + 1, z: HALF_DEPTH },
  'exx/sky-blue-cloudy'
))
// Create the map structure
const map = {
  id: 'synthetic-arena',
  name: 'Synthetic Arena',
  description: 'Generated synthetic arena with liquid floor and sky dome.',
  format: 'brush-map',
  sourceFormat: 'generated',
  license: 'MIT',
  attribution: 'Generated via script',
  updatedAt: new Date().toISOString(),
  bounds: {
    min: {
      x: -HALF_WIDTH,
      y: 0,
      z: -HALF_DEPTH,
    },
    max: {
      x: HALF_WIDTH,
      y: skyHeight + 1,
      z: HALF_DEPTH,
    },
  },
  brushes,
  playerSpawn: {
    x: 0,
    y: 2,
    z: 0,
  },
  enemySpawns: [
    { x: -HALF_WIDTH + 10, y: 2, z: -HALF_DEPTH + 10 },
    { x: HALF_WIDTH - 10, y: 2, z: -HALF_DEPTH + 10 },
    { x: -HALF_WIDTH + 10, y: 2, z: HALF_DEPTH - 10 },
    { x: HALF_WIDTH - 10, y: 2, z: HALF_DEPTH - 10 },
  ],
}

// Write the map file
const outputPath = path.join(mapsDir, 'synthetic-arena.json')
await fs.writeFile(outputPath, JSON.stringify(map, null, 2))
console.log(`Generated synthetic arena: ${outputPath}`)
console.log(`Dimensions: ${WIDTH}x${DEPTH}x${HEIGHT}`)
console.log(`Brushes: ${brushes.length}`)
