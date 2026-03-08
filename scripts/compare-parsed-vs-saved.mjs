import fs from 'node:fs/promises'
import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

const url = 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/stormkeep.map'
const source = await (await fetch(url)).text()

const parsed = parseQuakeMapSource(source, {
  id: 'stormkeep',
  name: 'stormkeep',
  license: 'GPL-2.0-or-later',
  sourceUrl: url,
  attribution: 'Xonotic Team - https://xonotic.org',
})

const saved = JSON.parse(await fs.readFile('data/maps/stormkeep.json', 'utf8'))

const countFaces = (map) => map.brushes.reduce((n, b) => n + ((b.faces && b.faces.length) || 0), 0)
const countPoints = (map) => map.brushes.reduce((n, b) => n + ((b.points && b.points.length) || 0), 0)

const result = {
  parsedBrushes: parsed.brushes.length,
  savedBrushes: saved.brushes.length,
  parsedFaces: countFaces(parsed),
  savedFaces: countFaces(saved),
  parsedPoints: countPoints(parsed),
  savedPoints: countPoints(saved),
  firstFiveBrushesExactMatch: JSON.stringify(parsed.brushes.slice(0, 5)) === JSON.stringify(saved.brushes.slice(0, 5)),
}

console.log(JSON.stringify(result, null, 2))
