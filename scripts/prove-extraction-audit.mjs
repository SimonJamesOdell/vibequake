import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

const MAP_SOURCES = {
  stormkeep: 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/stormkeep.map',
  dance: 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/dance.map',
}

const planePattern = /^\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)\s*\)\s*\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)\s*\)\s*\(\s*([\-\d.]+)\s+([\-\d.]+)\s+([\-\d.]+)\s*\)\s+([^\s]+).*/u

const toVec3 = (x, y, z) => ({ x, y, z })
const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
const scaleVec = (v, scalar) => ({ x: v.x * scalar, y: v.y * scalar, z: v.z * scalar })
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const length = (v) => Math.hypot(v.x, v.y, v.z)

const dedupePoints = (points) => {
  const seen = new Set()
  const unique = []
  for (const point of points) {
    const key = `${point.x.toFixed(4)}|${point.y.toFixed(4)}|${point.z.toFixed(4)}`
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(point)
  }
  return unique
}

const isRenderableBrushEntity = (classname) => {
  if (!classname) return true
  const normalized = classname.toLowerCase()
  if (normalized.startsWith('trigger_')) return false
  if (normalized === 'func_portal' || normalized === 'func_areaportal') return false
  return true
}

const buildBrushPlanes = (brush) => {
  const seedPoints = brush.faces.flatMap((face) => face.points)
  const seed = seedPoints.reduce((sum, point) => add(sum, point), toVec3(0, 0, 0))
  const seedCenter = scaleVec(seed, 1 / Math.max(seedPoints.length, 1))
  const planes = []

  for (const face of brush.faces) {
    const [a, b, c] = face.points
    const normalRaw = cross(subtract(b, a), subtract(c, a))
    const normalLength = length(normalRaw)
    if (normalLength < 0.000001) continue

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

const intersectPlanes = (a, b, c) => {
  const bc = cross(b.normal, c.normal)
  const ca = cross(c.normal, a.normal)
  const ab = cross(a.normal, b.normal)
  const denominator = dot(a.normal, bc)
  if (Math.abs(denominator) < 0.000001) return null

  const numerator = add(add(scaleVec(bc, a.distance), scaleVec(ca, b.distance)), scaleVec(ab, c.distance))
  return scaleVec(numerator, 1 / denominator)
}

const reconstructBrushVertices = (brush) => {
  const planes = buildBrushPlanes(brush)
  if (planes.length < 4) return []

  const vertices = []
  const epsilon = 0.02

  for (let i = 0; i < planes.length - 2; i += 1) {
    for (let j = i + 1; j < planes.length - 1; j += 1) {
      for (let k = j + 1; k < planes.length; k += 1) {
        const point = intersectPlanes(planes[i], planes[j], planes[k])
        if (!point) continue
        const inside = planes.every((plane) => dot(plane.normal, point) - plane.distance <= epsilon)
        if (!inside) continue
        vertices.push(point)
      }
    }
  }

  return dedupePoints(vertices)
}

const parseRawEntities = (source) => {
  const entities = []
  let currentEntity = null
  let currentBrush = null
  let skippingPatchBrush = false
  let patchBraceDepth = 0

  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, '').trim()
    if (!line) continue

    if (skippingPatchBrush) {
      const openCount = (line.match(/\{/gu) ?? []).length
      const closeCount = (line.match(/\}/gu) ?? []).length
      patchBraceDepth += openCount - closeCount
      if (patchBraceDepth < 0) {
        skippingPatchBrush = false
        patchBraceDepth = 0
        currentBrush = null
      }
      continue
    }

    if (line === '{') {
      if (!currentEntity) {
        currentEntity = { classname: 'unknown', brushes: [], patchBrushes: 0 }
      } else if (!currentBrush) {
        currentBrush = { faces: [] }
      }
      continue
    }

    if (line === '}') {
      if (currentBrush) {
        if (currentBrush.faces.length >= 4) {
          currentEntity.brushes.push(currentBrush)
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
        currentEntity.patchBrushes += 1
        skippingPatchBrush = true
        patchBraceDepth = 0
        continue
      }
      const match = line.match(planePattern)
      if (!match) continue
      currentBrush.faces.push({
        points: [
          toVec3(Number(match[1]), Number(match[2]), Number(match[3])),
          toVec3(Number(match[4]), Number(match[5]), Number(match[6])),
          toVec3(Number(match[7]), Number(match[8]), Number(match[9])),
        ],
        texture: match[10],
      })
      continue
    }

    if (currentEntity) {
      const prop = line.match(/^"([^"]+)"\s+"([^"]*)"$/u)
      if (prop && prop[1] === 'classname') {
        currentEntity.classname = prop[2]
      }
    }
  }

  return entities
}

const requestedMap = process.argv[2]
const mapIds = requestedMap ? [requestedMap] : Object.keys(MAP_SOURCES)

if (mapIds.some((id) => !MAP_SOURCES[id])) {
  const invalid = mapIds.filter((id) => !MAP_SOURCES[id])
  throw new Error(`Unknown map id(s): ${invalid.join(', ')}. Supported: ${Object.keys(MAP_SOURCES).join(', ')}`)
}

const reports = []

for (const mapId of mapIds) {
  const mapUrl = MAP_SOURCES[mapId]
  const source = await (await fetch(mapUrl)).text()
  const entities = parseRawEntities(source)

  const allBrushes = entities.flatMap((entity) => entity.brushes)
  const renderableEntities = entities.filter((entity) => isRenderableBrushEntity(entity.classname) && entity.brushes.length > 0)
  const renderableBrushes = renderableEntities.flatMap((entity) => entity.brushes)

  let reconstructedVertexBrushes = 0
  let fallbackPointBrushes = 0
  let rejectedDegenerate = 0

  for (const brush of renderableBrushes) {
    const vertices = reconstructBrushVertices(brush)
    const fallbackPoints = brush.faces.flatMap((face) => face.points)
    const points = vertices.length >= 4 ? vertices : dedupePoints(fallbackPoints)

    if (vertices.length >= 4) {
      reconstructedVertexBrushes += 1
    } else {
      fallbackPointBrushes += 1
    }

    const xs = points.map((point) => point.x)
    const ys = points.map((point) => point.y)
    const zs = points.map((point) => point.z)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const minZ = Math.min(...zs)
    const maxZ = Math.max(...zs)

    if (maxX - minX < 0.01 || maxY - minY < 0.01 || maxZ - minZ < 0.01) {
      rejectedDegenerate += 1
    }
  }

  const parsed = parseQuakeMapSource(source, {
    id: mapId,
    name: mapId,
    license: 'GPL-2.0-or-later',
    sourceUrl: mapUrl,
    attribution: 'Xonotic Team - https://xonotic.org',
  })

  reports.push({
    mapId,
    source: {
      lines: source.split(/\r?\n/u).length,
    },
    stageCounts: {
      entities: entities.length,
      allBrushesFaceGte4: allBrushes.length,
      patchBrushesSkipped: entities.reduce((sum, entity) => sum + entity.patchBrushes, 0),
      renderableEntities: renderableEntities.length,
      renderableBrushesFaceGte4: renderableBrushes.length,
      reconstructedVertexBrushes,
      fallbackPointBrushes,
      rejectedDegenerate,
      expectedImportedBrushes: renderableBrushes.length - rejectedDegenerate,
    },
    imported: {
      brushes: parsed.brushes.length,
      faces: parsed.brushes.reduce((sum, brush) => sum + ((brush.faces && brush.faces.length) || 0), 0),
      points: parsed.brushes.reduce((sum, brush) => sum + ((brush.points && brush.points.length) || 0), 0),
    },
    reconciliation: {
      expectedImportedBrushes: renderableBrushes.length - rejectedDegenerate,
      importedBrushes: parsed.brushes.length,
      matchesExpected: (renderableBrushes.length - rejectedDegenerate) === parsed.brushes.length,
    },
  })
}

console.log(JSON.stringify({ reports }, null, 2))
