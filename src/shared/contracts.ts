export type Vec3 = {
  x: number
  y: number
  z: number
}

export type Bounds3 = {
  min: Vec3
  max: Vec3
}

export type BrushSolid = {
  min: Vec3
  max: Vec3
  points?: Vec3[]
  faces?: Array<{
    points: Vec3[]
    texture?: string
  }>
  texture?: string
}

export type ArenaMap = {
  id: string
  name: string
  description: string
  format: 'brush-map'
  sourceFormat: 'brush-map' | 'quake-map' | 'quake-bsp' | 'vibequake-tiles'
  license?: string
  sourceUrl?: string
  attribution?: string
  bounds: Bounds3
  brushes: BrushSolid[]
  playerSpawn: Vec3
  enemySpawns: Vec3[]
  updatedAt: string
}

export type ArenaMapSummary = {
  id: string
  name: string
  description: string
  license?: string
  updatedAt: string
}

export type HighScoreEntry = {
  id: string
  name: string
  score: number
  mapId: string
  createdAt: string
}

export type HighScoreSubmission = {
  name: string
  score: number
  mapId: string
}

export type MapImportRequest = {
  url: string
  id?: string
  license: string
  attribution?: string
}
