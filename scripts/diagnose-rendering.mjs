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
  // Simple approximate area using triangulation from first vertex
  let area = 0
  const origin = points[0]
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    // Cross product magnitude / 2
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

const textureStats = new Map()
const faceCounts = {
  totalBrushes: map.brushes.length,
  brushesWithoutFaces: 0,
  brushesWithFaces: 0,
  totalFacesBeforeFilter: 0,
  totalFacesAfterFilter: 0,
  facesFilteredByTexture: 0,
  facesFilteredByPointCount: 0,
  facesSmallerThan0_01: 0,
  facesSmallerThan0_1: 0,
  facesSmallerThan1: 0,
  facesLargerThan100: 0,
}

const areaDistribution = []

for (const brush of map.brushes) {
  if (!brush.faces || brush.faces.length === 0) {
    faceCounts.brushesWithoutFaces += 1
    continue
  }

  faceCounts.brushesWithFaces += 1
  
  for (const face of brush.faces) {
    faceCounts.totalFacesBeforeFilter += 1

    if (isNonRenderableTexture(face.texture)) {
      faceCounts.facesFilteredByTexture += 1
      continue
    }

    if (!face.points || face.points.length < 3) {
      faceCounts.facesFilteredByPointCount += 1
      continue
    }

    faceCounts.totalFacesAfterFilter += 1

    const texture = face.texture || brush.texture || 'unknown'
    const stat = textureStats.get(texture) || { count: 0, totalArea: 0 }
    
    const area = calculateFaceArea(face.points)
    stat.count += 1
    stat.totalArea += area
    textureStats.set(texture, stat)

    areaDistribution.push({ texture, area, pointCount: face.points.length })

    if (area < 0.01) faceCounts.facesSmallerThan0_01 += 1
    else if (area < 0.1) faceCounts.facesSmallerThan0_1 += 1
    else if (area < 1) faceCounts.facesSmallerThan1 += 1
    else if (area > 100) faceCounts.facesLargerThan100 += 1
  }
}

const sortedTextures = [...textureStats.entries()]
  .map(([texture, stat]) => ({ texture, ...stat }))
  .sort((a, b) => b.count - a.count)

const areaSorted = [...areaDistribution].sort((a, b) => a.area - b.area)

console.log(JSON.stringify({
  mapId: MAP_ID,
  faceCounts,
  textureDistribution: {
    uniqueTextures: textureStats.size,
    top20ByCount: sortedTextures.slice(0, 20),
    bottom10ByCount: sortedTextures.slice(-10),
  },
  areaAnalysis: {
    smallest20: areaSorted.slice(0, 20),
    largest20: areaSorted.slice(-20),
    median: areaSorted[Math.floor(areaSorted.length / 2)],
  },
}, null, 2))
