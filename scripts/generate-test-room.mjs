import fs from 'node:fs/promises'
import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

// Parse the simple test room map
const mapPath = 'data/maps/test-room.map'
const text = await fs.readFile(mapPath, 'utf8')

const parsed = parseQuakeMapSource(text, {
  id: 'test-room',
  name: 'Test Room',
  description: 'Simple test room for Quake map rendering verification',
  license: 'CC0-1.0',
  attribution: 'Generated for testing purposes',
})

await fs.writeFile(`data/maps/test-room.json`, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
console.log(`Generated test-room with ${parsed.brushes.length} brushes`)
console.log(`Player spawn: ${JSON.stringify(parsed.playerSpawn)}`)
console.log(`Bounds: ${JSON.stringify(parsed.bounds)}`)
