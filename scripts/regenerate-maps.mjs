import fs from 'node:fs/promises'
import { parseQuakeMapSource } from '../dist-server/server/quake-map.js'

const imports = [
  {
    id: 'dance',
    url: 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/dance.map',
  },
  {
    id: 'stormkeep',
    url: 'https://raw.githubusercontent.com/xonotic/xonotic-maps.pk3dir/master/maps/stormkeep.map',
  },
]

for (const item of imports) {
  const text = await (await fetch(item.url)).text()
  const parsed = parseQuakeMapSource(text, {
    id: item.id,
    name: item.id,
    license: 'GPL-2.0-or-later',
    sourceUrl: item.url,
    attribution: 'Xonotic Team - https://xonotic.org',
  })
  await fs.writeFile(`data/maps/${item.id}.json`, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  console.log(`regenerated ${item.id} with ${parsed.brushes.length} brushes`)
}
