import fs from 'node:fs/promises'

const map = JSON.parse(await fs.readFile('data/maps/stormkeep.json', 'utf8'))
const counts = new Map()

for (const brush of map.brushes) {
  for (const face of brush.faces ?? []) {
    const texture = (face.texture ?? brush.texture ?? 'none').toLowerCase()
    counts.set(texture, (counts.get(texture) ?? 0) + 1)
  }
}

const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80)
for (const [texture, count] of top) {
  console.log(`${count.toString().padStart(5, ' ')}  ${texture}`)
}
