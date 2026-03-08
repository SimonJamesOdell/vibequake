import fs from 'node:fs'

const MAP_ID = process.argv[2] || 'stormkeep'
const BRUSH_INDEX = parseInt(process.argv[3]) || 0

const mapPath = `data/maps/${MAP_ID}.json`

if (!fs.existsSync(mapPath)) {
  throw new Error(`Map file not found: ${mapPath}`)
}

const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'))

if (BRUSH_INDEX >= map.brushes.length) {
  throw new Error(`Brush index ${BRUSH_INDEX} out of range (max: ${map.brushes.length - 1})`)
}

const brush = map.brushes[BRUSH_INDEX]

console.log(`\n=== Brush ${BRUSH_INDEX} ===`)
console.log(`Bounds: min(${brush.min.x.toFixed(2)}, ${brush.min.y.toFixed(2)}, ${brush.min.z.toFixed(2)}) max(${brush.max.x.toFixed(2)}, ${brush.max.y.toFixed(2)}, ${brush.max.z.toFixed(2)})`)
console.log(`Texture: ${brush.texture || 'none'}`)
console.log(`Faces: ${brush.faces?.length || 0}`)
console.log(`Points: ${brush.points?.length || 0}`)

if (brush.points && brush.points.length > 0) {
  console.log('\nBrush vertices:')
  brush.points.slice(0, 10).forEach((p, i) => {
    console.log(`  ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`)
  })
  if (brush.points.length > 10) {
    console.log(`  ... ${brush.points.length - 10} more vertices`)
  }
}

const brushCenter = {
  x: (brush.min.x + brush.max.x) / 2,
  y: (brush.min.y + brush.max.y) / 2,
  z: (brush.min.z + brush.max.z) / 2,
}

console.log(`\nBrush center: (${brushCenter.x.toFixed(2)}, ${brushCenter.y.toFixed(2)}, ${brushCenter.z.toFixed(2)})`)

if (brush.faces && brush.faces.length > 0) {
  console.log('\nFaces:')
  brush.faces.slice(0, 5).forEach((face, faceIdx) => {
    if (!face.points || face.points.length < 3) {
      console.log(`  Face ${faceIdx}: INVALID (${face.points?.length || 0} points)`)
      return
    }

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

    const normalMag = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)

    const faceCenter = {
      x: face.points.reduce((sum, p) => sum + p.x, 0) / face.points.length,
      y: face.points.reduce((sum, p) => sum + p.y, 0) / face.points.length,
      z: face.points.reduce((sum, p) => sum + p.z, 0) / face.points.length,
    }

    const toFace = {
      x: faceCenter.x - brushCenter.x,
      y: faceCenter.y - brushCenter.y,
      z: faceCenter.z - brushCenter.z,
    }

    const dot = (normal.x * toFace.x + normal.y * toFace.y + normal.z * toFace.z) / normalMag

    console.log(`  Face ${faceIdx}: ${face.points.length} verts, texture: ${face.texture || 'none'}`)
    console.log(`    Normal: (${(normal.x / normalMag).toFixed(3)}, ${(normal.y / normalMag).toFixed(3)}, ${(normal.z / normalMag).toFixed(3)}) mag: ${normalMag.toFixed(6)}`)
    console.log(`    Center: (${faceCenter.x.toFixed(2)}, ${faceCenter.y.toFixed(2)}, ${faceCenter.z.toFixed(2)})`)
    console.log(`    Dot(normal, toBrushCenter): ${dot.toFixed(6)} ${dot > 0 ? '✓ OUTWARD' : '✗ INWARD'}`)
    
    // Check if vertices are planar
    let maxDist = 0
    for (const p of face.points) {
      const dist = Math.abs((p.x - p0.x) * normal.x + (p.y - p0.y) * normal.y + (p.z - p0.z) * normal.z) / normalMag
      maxDist = Math.max(maxDist, dist)
    }
    console.log(`    Max distance from plane: ${maxDist.toFixed(6)} ${maxDist < 0.05 ? '✓ PLANAR' : '✗ NOT PLANAR'}`)

    // Show first few vertices
    console.log(`    Vertices:`)
    face.points.slice(0, 4).forEach((p, i) => {
      console.log(`      ${i}: (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`)
    })
    if (face.points.length > 4) {
      console.log(`      ... ${face.points.length - 4} more`)
    }
  })

  if (brush.faces.length > 5) {
    console.log(`  ... ${brush.faces.length - 5} more faces`)
  }

  // Statistics
  const validFaces = brush.faces.filter(face => {
    if (!face.points || face.points.length < 3) return false
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
    const mag = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2)
    return mag > 0.0001
  })

  const outwardFaces = validFaces.filter(face => {
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
    const faceCenter = {
      x: face.points.reduce((sum, p) => sum + p.x, 0) / face.points.length,
      y: face.points.reduce((sum, p) => sum + p.y, 0) / face.points.length,
      z: face.points.reduce((sum, p) => sum + p.z, 0) / face.points.length,
    }
    const toFace = {
      x: faceCenter.x - brushCenter.x,
      y: faceCenter.y - brushCenter.y,
      z: faceCenter.z - brushCenter.z,
    }
    const dot = normal.x * toFace.x + normal.y * toFace.y + normal.z * toFace.z
    return dot > 0
  })

  console.log(`\nSummary:`)
  console.log(`  Total faces: ${brush.faces.length}`)
  console.log(`  Valid (non-degenerate): ${validFaces.length}`)
  console.log(`  Outward-facing: ${outwardFaces.length}`)
  console.log(`  Inward-facing: ${validFaces.length - outwardFaces.length}`)
}
