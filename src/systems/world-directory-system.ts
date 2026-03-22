import type { GameWorldSummary } from '../shared/multiplayer'

export function renderWorldDirectory(
  worldDirectory: GameWorldSummary[],
  hudIntro: HTMLElement,
  activeMapId: string,
): void {
  const mapButtons = hudIntro.querySelectorAll<HTMLButtonElement>('.map-button')
  const worldDirectoryElement = hudIntro.querySelector<HTMLDivElement>('[data-world-directory]')
  const summariesByMap = new Map<string, { players: number; worlds: number; maxPlayers: number }>()

  for (const world of worldDirectory) {
    const current = summariesByMap.get(world.mapId) ?? { players: 0, worlds: 0, maxPlayers: 0 }
    current.players += world.players
    current.worlds += 1
    current.maxPlayers += world.maxPlayers
    summariesByMap.set(world.mapId, current)
  }

  for (const button of mapButtons) {
    const mapId = button.getAttribute('data-map-id')
    const mapName = button.getAttribute('data-map-name') ?? button.textContent?.trim() ?? 'Arena'
    if (!mapId) {
      continue
    }
    const summary = summariesByMap.get(mapId)
    if (!summary || summary.worlds === 0) {
      button.textContent = `${mapName} (0 online)`
      continue
    }
    button.textContent = `${mapName} (${summary.players}/${summary.maxPlayers}, ${summary.worlds} world${summary.worlds === 1 ? '' : 's'})`
  }

  if (!worldDirectoryElement) {
    return
  }

  const activeMapWorlds = worldDirectory
    .filter((world) => world.mapId === activeMapId)
    .sort((left, right) => left.startedAt - right.startedAt)

  worldDirectoryElement.replaceChildren()
  if (activeMapWorlds.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'world-directory-empty'
    empty.textContent = 'No active worlds yet. Joining will create one.'
    worldDirectoryElement.append(empty)
    return
  }

  for (const world of activeMapWorlds) {
    const row = document.createElement('div')
    row.className = 'world-directory-row'

    const label = document.createElement('span')
    label.className = 'world-directory-label'
    label.textContent = world.roomId

    const occupancy = document.createElement('span')
    occupancy.className = 'world-directory-occupancy'
    occupancy.textContent = `${world.players}/${world.maxPlayers}`

    row.append(label, occupancy)
    worldDirectoryElement.append(row)
  }
}
