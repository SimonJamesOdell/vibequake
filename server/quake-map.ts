import type { ArenaMap, BrushSolid, Vec3 } from '../src/shared/contracts.js'

type RawBrush = {
  faces: {
    points: [Vec3, Vec3, Vec3]
    texture?: string
  }[]
  texture?: string
}

type RawEntity = {
  properties: Record<string, string>
  brushes: RawBrush[]
}

const planePattern = /^\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s+([^\s]+).*/u

const toVec3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const convertPoint = (source: Vec3, centerX: number, centerY: number, minZ: number, scale: number): Vec3 => ({
  x: (source.x - centerX) * scale,
  y: (source.z - minZ) * scale,
  z: (source.y - centerY) * scale,
})

const dedupePoints = (points: Vec3[]) => {
  const seen = new Set<string>()
  const unique: Vec3[] = []
  for (const point of points) {
    const key = `${point.x.toFixed(4)}|${point.y.toFixed(4)}|${point.z.toFixed(4)}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    unique.push(point)
  }
  return unique
}

const parseEntityProperty = (line: string) => {
  const match = line.match(/^"([^"]+)"\s+"([^"]*)"$/u)
  if (!match) {
    return null
  }
  return { key: match[1], value: match[2] }
}

const parseBrushLine = (line: string) => {
  const match = line.match(planePattern)
  if (!match) {
    return null
  }
  return {
    points: [
      toVec3(Number(match[1]), Number(match[2]), Number(match[3])),
      toVec3(Number(match[4]), Number(match[5]), Number(match[6])),
      toVec3(Number(match[7]), Number(match[8]), Number(match[9])),
    ] as [Vec3, Vec3, Vec3],
    texture: match[10],
  }
}

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scaleVec = (v: Vec3, scalar: number): Vec3 => ({ x: v.x * scalar, y: v.y * scalar, z: v.z * scalar })
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z)

type Plane = {
  normal: Vec3
  distance: number
  texture?: string
}

const buildBrushPlanes = (brush: RawBrush): Plane[] => {
  const seedPoints = brush.faces.flatMap((face) => face.points)
  const seed = seedPoints.reduce<Vec3>((sum, point) => add(sum, point), toVec3(0, 0, 0))
  const seedCenter = scaleVec(seed, 1 / Math.max(seedPoints.length, 1))
  const planes: Plane[] = []

  for (const face of brush.faces) {
    const [a, b, c] = face.points
    const normalRaw = cross(subtract(b, a), subtract(c, a))
    const normalLength = length(normalRaw)
    if (normalLength < 0.000001) {
      continue
    }
    let normal = scaleVec(normalRaw, 1 / normalLength)
    let distance = dot(normal, a)
    if (dot(normal, seedCenter) - distance > 0) {
      normal = scaleVec(normal, -1)
      distance = -distance
    }
    planes.push({ normal, distance, texture: face.texture })
  }

  return planes
}

const intersectPlanes = (a: Plane, b: Plane, c: Plane): Vec3 | null => {
  const bc = cross(b.normal, c.normal)
  const ca = cross(c.normal, a.normal)
  const ab = cross(a.normal, b.normal)
  const denominator = dot(a.normal, bc)
  if (Math.abs(denominator) < 0.000001) {
    return null
  }

  const numerator = add(
    add(scaleVec(bc, a.distance), scaleVec(ca, b.distance)),
    scaleVec(ab, c.distance),
  )
  return scaleVec(numerator, 1 / denominator)
}

const reconstructBrushVertices = (brush: RawBrush): Vec3[] => {
  const planes = buildBrushPlanes(brush)
  if (planes.length < 4) {
    return []
  }

  const vertices: Vec3[] = []
  const epsilon = 0.02

  for (let i = 0; i < planes.length - 2; i += 1) {
    for (let j = i + 1; j < planes.length - 1; j += 1) {
      for (let k = j + 1; k < planes.length; k += 1) {
        const point = intersectPlanes(planes[i], planes[j], planes[k])
        if (!point) {
          continue
        }
        const inside = planes.every((plane) => dot(plane.normal, point) - plane.distance <= epsilon)
        if (!inside) {
          continue
        }
        vertices.push(point)
      }
    }
  }

  return dedupePoints(vertices)
}

const normalizeVec = (vector: Vec3): Vec3 => {
  const len = length(vector)
  if (len < 0.000001) {
    return toVec3(0, 0, 0)
  }
  return scaleVec(vector, 1 / len)
}

const buildBrushFaces = (vertices: Vec3[], planes: Plane[]) => {
  const faces: Array<{ points: Vec3[]; texture?: string }> = []
  for (const plane of planes) {
    const facePoints = dedupePoints(
      vertices.filter((point) => Math.abs(dot(plane.normal, point) - plane.distance) <= 0.04),
    )
    if (facePoints.length < 3) {
      continue
    }

    const center = scaleVec(facePoints.reduce<Vec3>((sum, point) => add(sum, point), toVec3(0, 0, 0)), 1 / facePoints.length)
    const reference = Math.abs(plane.normal.z) < 0.9 ? toVec3(0, 0, 1) : toVec3(0, 1, 0)
    const tangent = normalizeVec(cross(reference, plane.normal))
    const bitangent = normalizeVec(cross(plane.normal, tangent))
    const ordered = [...facePoints].sort((a, b) => {
      const aOffset = subtract(a, center)
      const bOffset = subtract(b, center)
      const aAngle = Math.atan2(dot(aOffset, bitangent), dot(aOffset, tangent))
      const bAngle = Math.atan2(dot(bOffset, bitangent), dot(bOffset, tangent))
      return aAngle - bAngle
    })

    faces.push({ points: ordered, texture: plane.texture })
  }

  return faces
}

const parseQuakeEntities = (source: string) => {
  const entities: RawEntity[] = []
  let currentEntity: RawEntity | null = null
  let currentBrush: RawBrush | null = null
  let skippingPatchBrush = false
  let patchBraceDepth = 0

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, '').trim()
    if (!line) {
      continue
    }

    if (skippingPatchBrush) {
      const openCount = (line.match(/\{/gu) ?? []).length
      const closeCount = (line.match(/\}/gu) ?? []).length
      patchBraceDepth += openCount - closeCount
      // For patch brushes, the first unmatched closing brace exits the outer brush block.
      if (patchBraceDepth < 0) {
        skippingPatchBrush = false
        patchBraceDepth = 0
        currentBrush = null
      }
      continue
    }

    if (line === '{') {
      if (!currentEntity) {
        currentEntity = { properties: {}, brushes: [] }
      } else if (!currentBrush) {
        currentBrush = { faces: [] }
      }
      continue
    }

    if (line === '}') {
      if (currentBrush) {
        if (currentBrush.faces.length >= 4) {
          currentEntity?.brushes.push(currentBrush)
        }
        currentBrush = null
      } else if (currentEntity) {
        entities.push(currentEntity)
        currentEntity = null
      }
      continue
    }

    if (currentBrush) {
      if (/^patchDef[23]$/u.test(line)) {
        // Patch surfaces are not yet imported; skip the whole patch brush safely.
        skippingPatchBrush = true
        patchBraceDepth = 0
        continue
      }
      const brushLine = parseBrushLine(line)
      if (!brushLine) {
        continue
      }
      currentBrush.faces.push({ points: brushLine.points, texture: brushLine.texture })
      currentBrush.texture ??= brushLine.texture
      continue
    }

    const property = parseEntityProperty(line)
    if (property && currentEntity) {
      currentEntity.properties[property.key] = property.value
    }
  }

  return entities
}

const isRenderableBrushEntity = (classname: string | undefined) => {
  if (!classname) {
    return true
  }
  const normalized = classname.toLowerCase()
  if (normalized.startsWith('trigger_')) {
    return false
  }
  if (normalized === 'func_portal' || normalized === 'func_areaportal') {
    return false
  }
  return true
}

const parseOrigin = (value: string | undefined): Vec3 | null => {
  if (!value) {
    return null
  }
  const parts = value.trim().split(/\s+/u).map(Number)
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) {
    return null
  }
  return toVec3(parts[0], parts[1], parts[2])
}

const fallbackEnemySpawns = (boundsMin: Vec3, boundsMax: Vec3, spawnY: number): Vec3[] => {
  const width = boundsMax.x - boundsMin.x
  const depth = boundsMax.z - boundsMin.z
  const y = Math.max(1.1, spawnY)
  return [
    { x: boundsMin.x + width * 0.18, y, z: boundsMin.z + depth * 0.18 },
    { x: boundsMax.x - width * 0.18, y, z: boundsMin.z + depth * 0.18 },
    { x: boundsMin.x + width * 0.18, y, z: boundsMax.z - depth * 0.18 },
    { x: boundsMax.x - width * 0.18, y, z: boundsMax.z - depth * 0.18 },
  ]
}

export const parseQuakeMapSource = (source: string, details: { id: string; name?: string; description?: string; updatedAt?: string; license?: string; sourceUrl?: string; attribution?: string }): ArenaMap => {
  const entities = parseQuakeEntities(source)
  const worldspawn = entities.find((entity) => entity.properties.classname === 'worldspawn')
  if (!worldspawn) {
    throw new Error('Quake map source must contain a worldspawn entity.')
  }

  const renderEntities = entities.filter(
    (entity) => entity.brushes.length > 0 && isRenderableBrushEntity(entity.properties.classname),
  )
  const renderBrushes = renderEntities.flatMap((entity) => entity.brushes)
  if (renderBrushes.length === 0) {
    throw new Error('Quake map source did not contain any renderable brushes.')
  }

  const sourceBrushes = renderBrushes
    .map<{ points: Vec3[]; faces: Array<{ points: Vec3[]; texture?: string }>; texture?: string } | null>((brush) => {
      const planes = buildBrushPlanes(brush)
      const vertices = reconstructBrushVertices(brush)
      const fallbackPoints = brush.faces.flatMap((face) => face.points)
      const points = vertices.length >= 4 ? vertices : dedupePoints(fallbackPoints)
      const faces = buildBrushFaces(points, planes)
      const xs = points.map((point) => point.x)
      const ys = points.map((point) => point.y)
      const zs = points.map((point) => point.z)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      const minZ = Math.min(...zs)
      const maxZ = Math.max(...zs)
      // Keep thin detail brushes; only reject near-zero degenerate geometry.
      if (maxX - minX < 0.01 || maxY - minY < 0.01 || maxZ - minZ < 0.01) {
        return null
      }
      return {
        points,
        faces,
        texture: brush.texture,
      }
    })
    .filter((brush): brush is { points: Vec3[]; faces: Array<{ points: Vec3[]; texture?: string }>; texture?: string } => brush !== null)

  if (sourceBrushes.length === 0) {
    throw new Error('Quake map source did not produce any usable brushes.')
  }

  const allSourcePoints = sourceBrushes.flatMap((brush) => brush.points)
  const sourceMinX = Math.min(...allSourcePoints.map((point) => point.x))
  const sourceMaxX = Math.max(...allSourcePoints.map((point) => point.x))
  const sourceMinY = Math.min(...allSourcePoints.map((point) => point.y))
  const sourceMaxY = Math.max(...allSourcePoints.map((point) => point.y))
  const sourceMinZ = Math.min(...allSourcePoints.map((point) => point.z))
  const sourceMaxZ = Math.max(...allSourcePoints.map((point) => point.z))

  const sourceWidth = sourceMaxX - sourceMinX
  const sourceDepth = sourceMaxY - sourceMinY
  const sourceHeight = sourceMaxZ - sourceMinZ
  const scale = clamp(72 / Math.max(sourceWidth, sourceDepth, 1), 0.015, 0.12)
  const centerX = (sourceMinX + sourceMaxX) / 2
  const centerY = (sourceMinY + sourceMaxY) / 2

  const brushes = sourceBrushes.map<BrushSolid>((brush) => {
    const convertedPoints = dedupePoints(brush.points.map((point) => convertPoint(point, centerX, centerY, sourceMinZ, scale)))
    const convertedFaces = brush.faces
      .map((face) => {
        const transformedPoints = dedupePoints(face.points.map((point) => convertPoint(point, centerX, centerY, sourceMinZ, scale)))
        // Axis swap (Y<->Z) flips handedness; keep parser ordering and flip winding once.
        return { texture: face.texture, points: transformedPoints.length >= 3 ? [...transformedPoints].reverse() : [] }
      })
      .filter((face) => face.points.length >= 3)
    const min = {
      x: Math.min(...convertedPoints.map((point) => point.x)),
      y: Math.min(...convertedPoints.map((point) => point.y)),
      z: Math.min(...convertedPoints.map((point) => point.z)),
    }
    const max = {
      x: Math.max(...convertedPoints.map((point) => point.x)),
      y: Math.max(...convertedPoints.map((point) => point.y)),
      z: Math.max(...convertedPoints.map((point) => point.z)),
    }

    return {
      min,
      max,
      points: convertedPoints.length >= 4 ? convertedPoints : undefined,
      faces: convertedFaces.length > 0 ? convertedFaces : undefined,
      texture: brush.texture,
    }
  })

  const playerEntity = entities.find((entity) => entity.properties.classname === 'info_player_start')
    ?? entities.find((entity) => entity.properties.classname === 'info_player_deathmatch')
  const deathmatchOrigins = entities
    .filter((entity) => entity.properties.classname === 'info_player_deathmatch')
    .map((entity) => parseOrigin(entity.properties.origin))
    .filter((origin): origin is Vec3 => origin !== null)
  const monsterOrigins = entities
    .filter((entity) => {
      const classname = entity.properties.classname?.toLowerCase() ?? ''
      return classname.startsWith('monster_') || classname.startsWith('enemy_')
    })
    .map((entity) => parseOrigin(entity.properties.origin))
    .filter((origin): origin is Vec3 => origin !== null)

  const playerOrigin = parseOrigin(playerEntity?.properties.origin) ?? toVec3(centerX, centerY, sourceMinZ + sourceHeight * 0.3)
  const playerSpawn = convertPoint(playerOrigin, centerX, centerY, sourceMinZ, scale)
  playerSpawn.y = Math.max(1.6, playerSpawn.y + 0.2)

  const enemyOrigins = [
    ...(deathmatchOrigins.length > 1 ? deathmatchOrigins.slice(1) : deathmatchOrigins),
    ...monsterOrigins,
  ]

  const enemySpawns = enemyOrigins
    .map((origin) => {
      const point = convertPoint(origin, centerX, centerY, sourceMinZ, scale)
      point.y = Math.max(1.1, point.y + 0.2)
      return point
    })

  const boundsMin = { x: -(sourceWidth * scale) / 2, y: 0, z: -(sourceDepth * scale) / 2 }
  const boundsMax = { x: (sourceWidth * scale) / 2, y: Math.max(4.8, sourceHeight * scale), z: (sourceDepth * scale) / 2 }

  return {
    id: details.id,
    name: details.name ?? details.id,
    description: details.description ?? 'Imported Quake brush map.',
    format: 'brush-map',
    sourceFormat: 'quake-map',
    license: details.license,
    sourceUrl: details.sourceUrl,
    attribution: details.attribution,
    bounds: {
      min: boundsMin,
      max: boundsMax,
    },
    brushes,
    playerSpawn,
    enemySpawns: enemySpawns.length > 0 ? enemySpawns : fallbackEnemySpawns(boundsMin, boundsMax, playerSpawn.y),
    updatedAt: details.updatedAt ?? new Date().toISOString(),
  }
}