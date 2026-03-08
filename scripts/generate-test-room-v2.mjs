import fs from 'node:fs/promises'
import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

// Parse the test room v2 map
const mapPath = 'data/maps/test-room-v2.map'
const text = await fs.readFile(mapPath, 'utf8')

const parsed = parseQuakeMapSource(text, {
  id: 'test-room',
  name: 'Test Room',
  description: 'Simple test room with proper spawns',
  license: 'CC0-1.0',
  attribution: 'Generated for testing purposes',
})

await fs.writeFile(`data/maps/test-room.json`, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
console.log(`Generated test-room with ${parsed.brushes.length} brushes`)
console.log(`Player spawn: ${JSON.stringify(parsed.playerSpawn)}`)
console.log(`Enemy spawns: ${parsed.enemySpawns.length}`)
console.log(`Bounds: ${JSON.stringify(parsed.bounds)}`)
