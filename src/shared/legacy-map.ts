import type { ArenaMap, BrushSolid, Vec3 } from './contracts.js'

export type LegacyTileSpawn = {
  column: number
  row: number
}

export type LegacyTileMap = {
  id: string
  name: string
  description: string
  license?: string
  sourceUrl?: string
  attribution?: string
  tiles: string[]
  playerSpawn: LegacyTileSpawn
  enemySpawns: LegacyTileSpawn[]
  updatedAt?: string
}

const toWorldPoint = (column: number, row: number, width: number, height: number, cellSize: number, y: number): Vec3 => ({
  x: column * cellSize - (width * cellSize) / 2 + cellSize / 2,
  y,
  z: row * cellSize - (height * cellSize) / 2 + cellSize / 2,
})

export const legacyTilesToBrushMap = (
  map: LegacyTileMap,
  options?: {
    cellSize?: number
    wallHeight?: number
    floorLevel?: number
    enemyLevel?: number
  },
): ArenaMap => {
  const cellSize = options?.cellSize ?? 2.2
  const wallHeight = options?.wallHeight ?? 4.8
  const floorLevel = options?.floorLevel ?? 1.6
  const enemyLevel = options?.enemyLevel ?? 1.1
  const width = map.tiles[0]?.length ?? 0
  const height = map.tiles.length

  if (width === 0 || height === 0 || map.tiles.some((row) => row.length !== width)) {
    throw new Error('Legacy tile map rows must all have the same width.')
  }

  const brushes: BrushSolid[] = []
  for (let rowIndex = 0; rowIndex < height; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
      if (map.tiles[rowIndex][columnIndex] !== '#') {
        continue
      }

      const center = toWorldPoint(columnIndex, rowIndex, width, height, cellSize, wallHeight / 2)
      brushes.push({
        min: { x: center.x - cellSize / 2, y: 0, z: center.z - cellSize / 2 },
        max: { x: center.x + cellSize / 2, y: wallHeight, z: center.z + cellSize / 2 },
        texture: 'stone',
      })
    }
  }

  return {
    id: map.id,
    name: map.name,
    description: map.description,
    format: 'brush-map',
    sourceFormat: 'vibequake-tiles',
    license: map.license,
    sourceUrl: map.sourceUrl,
    attribution: map.attribution,
    bounds: {
      min: { x: -(width * cellSize) / 2, y: 0, z: -(height * cellSize) / 2 },
      max: { x: (width * cellSize) / 2, y: wallHeight, z: (height * cellSize) / 2 },
    },
    brushes,
    playerSpawn: toWorldPoint(map.playerSpawn.column, map.playerSpawn.row, width, height, cellSize, floorLevel),
    enemySpawns: map.enemySpawns.map((spawn) => toWorldPoint(spawn.column, spawn.row, width, height, cellSize, enemyLevel)),
    updatedAt: map.updatedAt ?? new Date().toISOString(),
  }
}