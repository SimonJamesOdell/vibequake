import type { ArenaMap, BrushSolid, Vec3 } from '../src/shared/contracts.js'

// Quake BSP format constants
const BSP_VERSION = 29 // Quake 1 BSP version
const HEADER_SIZE = 4 + 15 * 8 // version + 15 lumps * (offset + size)

enum LumpType {
  ENTITIES = 0,
  PLANES = 1,
  MIPTEX = 2,
  VERTICES = 3,
  VISIBILITY = 4,
  NODES = 5,
  TEXINFO = 6,
  FACES = 7,
  LIGHTING = 8,
  CLIPNODES = 9,
  LEAVES = 10,
  MARKSURFACES = 11,
  EDGES = 12,
  SURFEDGES = 13,
  MODELS = 14,
}

type Lump = { offset: number; size: number }
type Header = { version: number; lumps: Lump[] }
type Face = { planeId: number; side: number; firstEdge: number; numEdges: number; texInfo: number }
type Edge = [number, number]
type Model = { mins: Vec3; maxs: Vec3; origin: Vec3; headNodes: number[]; numLeaves: number; firstFace: number; numFaces: number }

export async function parseBSP(buffer: ArrayBuffer): Promise<ArenaMap> {
  const view = new DataView(buffer)
  
  // Read header
  const header = readHeader(view)
  if (header.version !== BSP_VERSION) {
    throw new Error(`Unsupported BSP version: ${header.version} (expected ${BSP_VERSION})`)
  }

  // Read lumps
  const entities = readEntities(view, header.lumps[LumpType.ENTITIES])
  const vertices = readVertices(view, header.lumps[LumpType.VERTICES])
  const edges = readEdges(view, header.lumps[LumpType.EDGES])
  const surfEdges = readSurfEdges(view, header.lumps[LumpType.SURFEDGES])
  const faces = readFaces(view, header.lumps[LumpType.FACES])
  const models = readModels(view, header.lumps[LumpType.MODELS])

  // World model (first model) contains the main geometry
  const worldModel = models[0]

  // Convert faces to brushes (approximate - each face becomes a thin brush)
  const brushes: BrushSolid[] = []
  
  for (let i = worldModel.firstFace; i < worldModel.firstFace + worldModel.numFaces; i++) {
    const face = faces[i]
    const points: Vec3[] = []
    
    // Build face polygon from edges
    for (let j = 0; j < face.numEdges; j++) {
      const surfEdgeIdx = face.firstEdge + j
      const edgeIdx = surfEdges[surfEdgeIdx]
      const edge = edges[Math.abs(edgeIdx)]
      const vertexIdx = edgeIdx >= 0 ? edge[0] : edge[1]
      points.push(vertices[vertexIdx])
    }

    // Skip degenerate faces
    if (points.length < 3) {
      continue
    }

    // Each BSP face becomes a thin brush-like structure
    // Calculate bounds for the face
    const xs = points.map((p) => p.x)
    const ys = points.map((p) => p.y)
    const zs = points.map((p) => p.z)
    
    brushes.push({
      min: { x: Math.min(...xs), y: Math.min(...ys), z: Math.min(...zs) },
      max: { x: Math.max(...xs), y: Math.max(...ys), z: Math.max(...zs) },
      points,
      texture: 'metal', // BSP doesn't have simple texture names in the same way
    })
  }

  // Parse spawn points from entities
  const { playerSpawn, enemySpawns } = parseSpawnPoints(entities)

  // Calculate bounds
  const bounds = {
    min: worldModel.mins,
    max: worldModel.maxs,
  }

  return {
    id: 'bsp-map',
    name: 'Quake BSP Map',
    description: 'Imported from compiled Quake BSP file',
    format: 'brush-map' as const,
    sourceFormat: 'quake-bsp' as const,
    bounds,
    brushes,
    playerSpawn: playerSpawn || { x: 0, y: 2, z: 0 },
    enemySpawns: enemySpawns.length > 0 ? enemySpawns : [
      { x: 10, y: 2, z: 10 },
      { x: -10, y: 2, z: 10 },
      { x: 10, y: 2, z: -10 },
      { x: -10, y: 2, z: -10 },
    ],
    updatedAt: new Date().toISOString(),
  }
}

function readHeader(view: DataView): Header {
  const version = view.getInt32(0, true)
  const lumps: Lump[] = []
  
  for (let i = 0; i < 15; i++) {
    const offset = view.getInt32(4 + i * 8, true)
    const size = view.getInt32(4 + i * 8 + 4, true)
    lumps.push({ offset, size })
  }
  
  return { version, lumps }
}

function readEntities(view: DataView, lump: Lump): string {
  const bytes = new Uint8Array(view.buffer, lump.offset, lump.size)
  return new TextDecoder().decode(bytes)
}

function readVertices(view: DataView, lump: Lump): Vec3[] {
  const count = lump.size / 12 // 3 floats per vertex
  const vertices: Vec3[] = []
  
  for (let i = 0; i < count; i++) {
    const offset = lump.offset + i * 12
    // Quake uses Z-up, we need Y-up, so swap Y and Z
    vertices.push({
      x: view.getFloat32(offset, true),
      y: view.getFloat32(offset + 8, true), // Z becomes Y
      z: view.getFloat32(offset + 4, true), // Y becomes Z
    })
  }
  
  return vertices
}

function readEdges(view: DataView, lump: Lump): Edge[] {
  const count = lump.size / 4 // 2 uint16s per edge
  const edges: Edge[] = []
  
  for (let i = 0; i < count; i++) {
    const offset = lump.offset + i * 4
    edges.push([
      view.getUint16(offset, true),
      view.getUint16(offset + 2, true),
    ])
  }
  
  return edges
}

function readSurfEdges(view: DataView, lump: Lump): number[] {
  const count = lump.size / 4 // int32 per surfedge
  const surfEdges: number[] = []
  
  for (let i = 0; i < count; i++) {
    surfEdges.push(view.getInt32(lump.offset + i * 4, true))
  }
  
  return surfEdges
}

function readFaces(view: DataView, lump: Lump): Face[] {
  const count = lump.size / 20 // 20 bytes per face
  const faces: Face[] = []
  
  for (let i = 0; i < count; i++) {
    const offset = lump.offset + i * 20
    faces.push({
      planeId: view.getUint16(offset, true),
      side: view.getUint16(offset + 2, true),
      firstEdge: view.getInt32(offset + 4, true),
      numEdges: view.getUint16(offset + 8, true),
      texInfo: view.getUint16(offset + 10, true),
    })
  }
  
  return faces
}

function readModels(view: DataView, lump: Lump): Model[] {
  const count = lump.size / 64 // 64 bytes per model
  const models: Model[] = []
  
  for (let i = 0; i < count; i++) {
    const offset = lump.offset + i * 64
    models.push({
      mins: {
        x: view.getFloat32(offset, true),
        y: view.getFloat32(offset + 8, true),
        z: view.getFloat32(offset + 4, true),
      },
      maxs: {
        x: view.getFloat32(offset + 12, true),
        y: view.getFloat32(offset + 20, true),
        z: view.getFloat32(offset + 16, true),
      },
      origin: {
        x: view.getFloat32(offset + 24, true),
        y: view.getFloat32(offset + 32, true),
        z: view.getFloat32(offset + 28, true),
      },
      headNodes: [
        view.getInt32(offset + 36, true),
        view.getInt32(offset + 40, true),
        view.getInt32(offset + 44, true),
        view.getInt32(offset + 48, true),
      ],
      numLeaves: view.getInt32(offset + 52, true),
      firstFace: view.getInt32(offset + 56, true),
      numFaces: view.getInt32(offset + 60, true),
    })
  }
  
  return models
}

function parseSpawnPoints(entitiesText: string): { playerSpawn: Vec3 | null; enemySpawns: Vec3[] } {
  let playerSpawn: Vec3 | null = null
  const enemySpawns: Vec3[] = []
  
  const entities = entitiesText.split('}')
  
  for (const entityText of entities) {
    if (!entityText.includes('{')) {
      continue
    }
    
    const lines = entityText.split('\n')
    let classname = ''
    let origin: Vec3 | null = null
    
    for (const line of lines) {
      const match = line.match(/"([^"]+)"\s+"([^"]*)"/)
      if (!match) {
        continue
      }
      
      const [, key, value] = match
      if (key === 'classname') {
        classname = value
      } else if (key === 'origin') {
        const parts = value.split(' ').map(Number)
        if (parts.length === 3) {
          // Swap Y and Z for coordinate system conversion
          origin = { x: parts[0], y: parts[2], z: parts[1] }
        }
      }
    }
    
    if (origin) {
      if (classname === 'info_player_start' || classname === 'info_player_deathmatch') {
        playerSpawn = origin
      } else if (classname.startsWith('monster_') || classname.startsWith('enemy_')) {
        enemySpawns.push(origin)
      }
    }
  }
  
  return { playerSpawn, enemySpawns }
}
