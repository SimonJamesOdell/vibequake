import fs from 'node:fs/promises'
import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

const mapUrl = 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/stormkeep.map'
const source = await (await fetch(mapUrl)).text()

const planePattern = /^\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s*\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\)\s+([^\s]+).*/u

const parseRawMapStats = (text) => {
  const entityClassCounts = new Map()
  let totalEntities = 0
  let totalBrushes = 0
  let totalFaces = 0
  let currentEntity = null
  let inBrush = false

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/\/\/.*$/u, '').trim()
    if (!line) {
      continue
    }

    if (line === '{') {
      if (!currentEntity) {
        currentEntity = { classname: 'unknown' }
        totalEntities += 1
      } else if (!inBrush) {
        inBrush = true
        totalBrushes += 1
      }
      continue
    }

    if (line === '}') {
      if (inBrush) {
        inBrush = false
      } else {
        const key = currentEntity?.classname ?? 'unknown'
        entityClassCounts.set(key, (entityClassCounts.get(key) ?? 0) + 1)
        currentEntity = null
      }
      continue
    }

    if (inBrush) {
      if (planePattern.test(line)) {
        totalFaces += 1
      }
      continue
    }

    const property = line.match(/^"([^"]+)"\s+"([^"]*)"$/u)
    if (property && currentEntity) {
      const [, key, value] = property
      if (key === 'classname') {
        currentEntity.classname = value
      }
    }
  }

  return {
    totalEntities,
    totalBrushes,
    totalFaces,
    topEntityClasses: [...entityClassCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12),
  }
}

const summarizeImportedMap = (map) => {
  let faceCount = 0
  let pointCount = 0
  let noFaceBrushes = 0
  let noPointBrushes = 0

  for (const brush of map.brushes) {
    if (!brush.faces || brush.faces.length === 0) {
      noFaceBrushes += 1
    } else {
      faceCount += brush.faces.length
      for (const face of brush.faces) {
        pointCount += face.points?.length ?? 0
      }
    }
    if (!brush.points || brush.points.length === 0) {
      noPointBrushes += 1
    }
  }

  return {
    brushCount: map.brushes.length,
    faceCount,
    pointCount,
    noFaceBrushes,
    noPointBrushes,
  }
}

const rawStats = parseRawMapStats(source)
const parsed = parseQuakeMapSource(source, {
  id: 'stormkeep',
  name: 'stormkeep',
  license: 'GPL-2.0-or-later',
  sourceUrl: mapUrl,
  attribution: 'Xonotic Team - https://xonotic.org',
})
const parsedStats = summarizeImportedMap(parsed)

const saved = JSON.parse(await fs.readFile('data/maps/stormkeep.json', 'utf8'))
const savedStats = summarizeImportedMap(saved)

console.log('RAW MAP STATS')
console.log(JSON.stringify(rawStats, null, 2))
console.log('\nPARSED (IN-MEMORY) STATS')
console.log(JSON.stringify(parsedStats, null, 2))
console.log('\nSAVED JSON STATS')
console.log(JSON.stringify(savedStats, null, 2))

const brushCoverage = rawStats.totalBrushes > 0 ? parsedStats.brushCount / rawStats.totalBrushes : 0
console.log('\nCOVERAGE')
console.log(JSON.stringify({
  rawBrushes: rawStats.totalBrushes,
  parsedBrushes: parsedStats.brushCount,
  savedBrushes: savedStats.brushCount,
  brushCoverage,
}, null, 2))
