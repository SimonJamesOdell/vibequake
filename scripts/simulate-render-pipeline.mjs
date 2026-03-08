import fs from 'node:fs'

const MAP_ID = process.argv[2] || 'stormkeep'
const mapPath = `data/maps/${MAP_ID}.json`

if (!fs.existsSync(mapPath)) {
  throw new Error(`Map file not found: ${mapPath}`)
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))

const isNonRenderableTexture = (textureName) => {
  if (!textureName) return false
  const name = textureName.toLowerCase()
  return name.includes('common/caulk') || name.includes('common/skip') || name.includes('common/clip')
}

const calculateFaceArea = (points) => {
  if (points.length < 3) return 0
  let area = 0
  const origin = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const v1 = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z }
    const v2 = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z }
    const cross = {
      x: v1.y * v2.z - v1.z * v2.y,
      y: v1.z * v2.x - v1.x * v2.z,
      z: v1.x * v2.y - v1.y * v2.x,
    }
    const magnitude = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2)
    area += magnitude / 2
  }
  return area
}

let totalFaces = 0
let filteredByTexture = 0
let filteredByPointCount = 0
let filteredByDegenerate = 0
let filteredByAreaThreshold = 0
let degenerateTriangles = 0
let validFaces = 0
let validTriangles = 0

const areaThreshold = 0.1 // 'major' detail level

for (const brush of map.brushes) {
  if (!brush.faces || brush.faces.length === 0) continue

  for (const face of brush.faces) {
    totalFaces++

    if (isNonRenderableTexture(face.texture)) {
      filteredByTexture++
      continue
    }

    if (!face.points || face.points.length < 3) {
      filteredByPointCount++
      continue
    }

    // Check if face is degenerate (first 3 points collinear)
    const p0 = face.points[0]
    const p1 = face.points[1]
    const p2 = face.points[2]

    const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
    const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z }

    const normal = {
      x: v1.y * v2.z - v1.z * v2.y,
      y: v1.z * v2.x - v1.x * v2.z,
      z: v1.x * v2.y - v1.y * v2.x,
    }

    const normalMagnitude = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
    if (normalMagnitude < 0.0001) {
      filteredByDegenerate++
      continue
    }

    // Check area threshold
    if (areaThreshold > 0) {
      const area = calculateFaceArea(face.points)
      if (area < areaThreshold) {
        filteredByAreaThreshold++
        continue
      }
    }

    // Check triangulation
    let hasValidTriangle = false
    const origin = face.points[0]
    for (let i = 1; i < face.points.length - 1; i++) {
      const a = face.points[i]
      const b = face.points[i + 1]

      const tv1 = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z }
      const tv2 = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z }
      const tcross = {
        x: tv1.y * tv2.z - tv1.z * tv2.y,
        y: tv1.z * tv2.x - tv1.x * tv2.z,
        z: tv1.x * tv2.y - tv1.y * tv2.x,
      }
      const tarea = Math.sqrt(tcross.x ** 2 + tcross.y ** 2 + tcross.z ** 2) / 2

      if (tarea < 0.00001) {
        degenerateTriangles++
      } else {
        hasValidTriangle = true
        validTriangles++
      }
    }

    if (hasValidTriangle) {
      validFaces++
    }
  }
}

console.log(JSON.stringify({
  mapId: MAP_ID,
  detailLevel: 'major (0.1 area threshold)',
  totalBrushes: map.brushes.length,
  totalFaces,
  pipeline: {
    filteredByTexture,
    filteredByPointCount,
    filteredByDegenerate,
    filteredByAreaThreshold,
    remainingAfterFilters: totalFaces - filteredByTexture - filteredByPointCount - filteredByDegenerate - filteredByAreaThreshold,
    degenerateTrianglesSkipped: degenerateTriangles,
    validTriangles,
    validFaces,
  },
  summary: {
    wouldRenderFaces: validFaces,
    wouldRenderTriangles: validTriangles,
    percentOfTotal: ((validFaces / totalFaces) * 100).toFixed(1) + '%',
  },
}, null, 2))
