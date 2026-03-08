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

const detailLevels = [
  { name: 'full', threshold: 0 },
  { name: 'major', threshold: 0.1 },
  { name: 'structure', threshold: 1.0 },
]

const results = detailLevels.map(({ name, threshold }) => {
  let renderedFaces = 0
  let filteredByArea = 0
  let filteredByTexture = 0
  let filteredByPoints = 0

  for (const brush of map.brushes) {
    if (!brush.faces || brush.faces.length === 0) continue

    for (const face of brush.faces) {
      if (isNonRenderableTexture(face.texture)) {
        filteredByTexture += 1
        continue
      }

      if (!face.points || face.points.length < 3) {
        filteredByPoints += 1
        continue
      }

      if (threshold > 0) {
        const area = calculateFaceArea(face.points)
        if (area < threshold) {
          filteredByArea += 1
          continue
        }
      }

      renderedFaces += 1
    }
  }

  return {
    level: name,
    areaThreshold: threshold,
    renderedFaces,
    filteredByTexture,
    filteredByArea,
    filteredByPoints,
    totalFiltered: filteredByTexture + filteredByArea + filteredByPoints,
  }
})

// Add reduction percentages after all counts are computed
const fullCount = results[0].renderedFaces
for (const result of results) {
  result.reductionVsFull = ((result.renderedFaces / fullCount) * 100).toFixed(1) + '%'
}

console.log(JSON.stringify({
  mapId: MAP_ID,
  totalBrushes: map.brushes.length,
  detailLevels: results,
}, null, 2))
