const mapUrl = 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/stormkeep.map'
const source = await (await fetch(mapUrl)).text()

const planePattern = /^\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s+([^\s]+).*/u

const isRenderableBrushEntity = (classname) => {
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

const entities = []
let currentEntity = null
let inBrush = false
let currentBrushFaces = 0

for (const rawLine of source.split(/\r?\n/u)) {
  const line = rawLine.replace(/\/\/.*$/u, '').trim()
  if (!line) continue

  if (line === '{') {
    if (!currentEntity) {
      currentEntity = { classname: 'unknown', brushes: [], faceCounts: [] }
    } else if (!inBrush) {
      inBrush = true
      currentBrushFaces = 0
    }
    continue
  }

  if (line === '}') {
    if (inBrush) {
      if (currentEntity) {
        currentEntity.brushes.push(1)
        currentEntity.faceCounts.push(currentBrushFaces)
      }
      inBrush = false
    } else {
      if (currentEntity) {
        entities.push(currentEntity)
      }
      currentEntity = null
    }
    continue
  }

  if (inBrush) {
    if (planePattern.test(line)) currentBrushFaces += 1
    continue
  }

  const prop = line.match(/^"([^"]+)"\s+"([^"]*)"$/u)
  if (prop && currentEntity && prop[1] === 'classname') {
    currentEntity.classname = prop[2]
  }
}

const byClass = new Map()
let totalBrushes = 0
let renderableBrushes = 0
let excludedByEntity = 0
let facesLt4 = 0

for (const entity of entities) {
  const c = entity.classname || 'unknown'
  byClass.set(c, (byClass.get(c) ?? 0) + entity.brushes.length)
  totalBrushes += entity.brushes.length

  const renderable = isRenderableBrushEntity(c)
  if (!renderable) {
    excludedByEntity += entity.brushes.length
    continue
  }

  for (const faceCount of entity.faceCounts) {
    if (faceCount < 4) {
      facesLt4 += 1
      continue
    }
    renderableBrushes += 1
  }
}

console.log('RAW BRUSH DISTRIBUTION (top 20 classes by brush count)')
console.log([...byClass.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20))
console.log('\nDROP BREAKDOWN')
console.log({
  totalBrushes,
  excludedByEntity,
  facesLt4,
  maxPossibleRenderable: renderableBrushes,
})
