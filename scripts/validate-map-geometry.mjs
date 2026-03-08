import fs from 'node:fs'

const MAP_ID = process.argv[2] || 'stormkeep'
const mapPath = `data/maps/${MAP_ID}.json`

if (!fs.existsSync(mapPath)) {
  throw new Error(`Map file not found: ${mapPath}`)
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))

const issues = {
  brushesWithNaN: [],
  brushesWithInfinity: [],
  facesWithTooFewPoints: [],
  degenerateFaces: [],
  invalidTriangulations: [],
  facesWithDuplicatePoints: [],
}

let totalFaces = 0
let validFaces = 0

for (let brushIndex = 0; brushIndex < map.brushes.length; brushIndex++) {
  const brush = map.brushes[brushIndex]
  
  // Check brush bounds for NaN/Infinity
  const allBrushCoords = [
    brush.min.x, brush.min.y, brush.min.z,
    brush.max.x, brush.max.y, brush.max.z,
  ]
  
  if (allBrushCoords.some(v => !Number.isFinite(v))) {
    issues.brushesWithNaN.push({
      brushIndex,
      min: brush.min,
      max: brush.max,
    })
    continue
  }
  
  if (!brush.faces || brush.faces.length === 0) continue
  
  for (let faceIndex = 0; faceIndex < brush.faces.length; faceIndex++) {
    const face = brush.faces[faceIndex]
    totalFaces++
    
    if (!face.points || face.points.length < 3) {
      issues.facesWithTooFewPoints.push({
        brushIndex,
        faceIndex,
        pointCount: face.points?.length || 0,
      })
      continue
    }
    
    // Check for NaN/Infinity in face points
    const allCoords = face.points.flatMap(p => [p.x, p.y, p.z])
    if (allCoords.some(v => !Number.isFinite(v))) {
      issues.brushesWithInfinity.push({
        brushIndex,
        faceIndex,
        points: face.points,
      })
      continue
    }
    
    // Check for duplicate points
    const pointKeys = face.points.map(p => `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`)
    const uniqueKeys = new Set(pointKeys)
    if (uniqueKeys.size < face.points.length) {
      issues.facesWithDuplicatePoints.push({
        brushIndex,
        faceIndex,
        totalPoints: face.points.length,
        uniquePoints: uniqueKeys.size,
      })
    }
    
    // Check if face is degenerate (all points collinear or too small)
    if (face.points.length >= 3) {
      const p0 = face.points[0]
      const p1 = face.points[1]
      const p2 = face.points[2]
      
      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
      const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z }
      
      const cross = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x,
      }
      
      const crossMagnitude = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2)
      
      if (crossMagnitude < 0.0001) {
        issues.degenerateFaces.push({
          brushIndex,
          faceIndex,
          crossMagnitude,
          points: face.points.slice(0, 3),
        })
        continue
      }
    }
    
    // Check triangulation: for each triangle in the fan, verify it's valid
    for (let i = 1; i < face.points.length - 1; i++) {
      const p0 = face.points[0]
      const p1 = face.points[i]
      const p2 = face.points[i + 1]
      
      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
      const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z }
      
      const cross = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x,
      }
      
      const area = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2) / 2
      
      if (area < 0.00001) {
        issues.invalidTriangulations.push({
          brushIndex,
          faceIndex,
          triangleIndex: i - 1,
          area,
          points: [p0, p1, p2],
        })
      }
    }
    
    validFaces++
  }
}

console.log(JSON.stringify({
  mapId: MAP_ID,
  totalBrushes: map.brushes.length,
  totalFaces,
  validFaces,
  issues: {
    brushesWithNaN: issues.brushesWithNaN.length,
    brushesWithInfinity: issues.brushesWithInfinity.length,
    facesWithTooFewPoints: issues.facesWithTooFewPoints.length,
    degenerateFaces: issues.degenerateFaces.length,
    invalidTriangulations: issues.invalidTriangulations.length,
    facesWithDuplicatePoints: issues.facesWithDuplicatePoints.length,
  },
  samples: {
    firstNaN: issues.brushesWithNaN[0],
    firstInfinity: issues.brushesWithInfinity[0],
    firstDegenerate: issues.degenerateFaces[0],
    firstInvalidTriangulation: issues.invalidTriangulations[0],
    firstDuplicatePoints: issues.facesWithDuplicatePoints[0],
  },
}, null, 2))
