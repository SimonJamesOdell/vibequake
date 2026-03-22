type Vec2Point = {
  x: number
  z: number
}

type Bounds2 = {
  min: Vec2Point
  max: Vec2Point
}

type MinimapEnemy = {
  x: number
  z: number
}

type MinimapPlayer = {
  id: string
  x: number
  z: number
  yaw: number
  isLocal?: boolean
}

type MinimapPickup = {
  x: number
  z: number
}

export type MinimapRenderSnapshot = {
  worldMinX: number
  worldMinZ: number
  worldWidth: number
  worldHeight: number
  brushes: Bounds2[]
  enemies: MinimapEnemy[]
  players: MinimapPlayer[]
  pickups: MinimapPickup[]
  localPlayer?: {
    x: number
    z: number
    yaw: number
  }
}

type MinimapRoomState = {
  enemies: Record<string, { isDead: boolean; health: number; position: Vec2Point }>
  players: Record<string, { id: string; yaw: number; position: Vec2Point }>
  pickups: Record<string, { collected: boolean; position: Vec2Point }>
}

type MinimapLocalEnemy = {
  health: number
  visible: boolean
  x: number
  z: number
}

type MinimapRemotePlayer = {
  id: string
  yaw: number
  x: number
  z: number
}

type MinimapWorldPickup = {
  collected: boolean
  x: number
  z: number
}

export type MinimapSnapshotInput = {
  worldMinX: number
  worldMinZ: number
  worldWidth: number
  worldHeight: number
  brushes: Bounds2[]
  myPlayerId: string | null
  liveRoomState: MinimapRoomState | null
  previewRoomState: MinimapRoomState | null
  localEnemies: MinimapLocalEnemy[]
  remotePlayers: MinimapRemotePlayer[]
  worldPickups: MinimapWorldPickup[]
  localPlayer: {
    x: number
    z: number
    yaw: number
  }
}

export const createMinimapSnapshot = (input: MinimapSnapshotInput): MinimapRenderSnapshot => {
  const snapshot: MinimapRenderSnapshot = {
    worldMinX: input.worldMinX,
    worldMinZ: input.worldMinZ,
    worldWidth: input.worldWidth,
    worldHeight: input.worldHeight,
    brushes: input.brushes,
    enemies: [],
    players: [],
    pickups: [],
  }

  const usePreviewRoom = input.liveRoomState === null && input.previewRoomState !== null

  if (input.liveRoomState) {
    for (const enemy of Object.values(input.liveRoomState.enemies)) {
      if (enemy.isDead || enemy.health <= 0) {
        continue
      }
      snapshot.enemies.push({ x: enemy.position.x, z: enemy.position.z })
    }

    for (const [playerId, player] of Object.entries(input.liveRoomState.players)) {
      snapshot.players.push({
        id: playerId,
        x: player.position.x,
        z: player.position.z,
        yaw: player.yaw,
        isLocal: playerId === input.myPlayerId,
      })
    }
  } else if (usePreviewRoom && input.previewRoomState) {
    for (const enemy of Object.values(input.previewRoomState.enemies)) {
      if (enemy.isDead || enemy.health <= 0) {
        continue
      }
      snapshot.enemies.push({ x: enemy.position.x, z: enemy.position.z })
    }

    for (const player of Object.values(input.previewRoomState.players)) {
      snapshot.players.push({ id: player.id, x: player.position.x, z: player.position.z, yaw: player.yaw })
    }
  } else {
    for (const enemy of input.localEnemies) {
      if (enemy.health <= 0 || !enemy.visible) {
        continue
      }
      snapshot.enemies.push({ x: enemy.x, z: enemy.z })
    }

    for (const remotePlayer of input.remotePlayers) {
      snapshot.players.push({
        id: remotePlayer.id,
        x: remotePlayer.x,
        z: remotePlayer.z,
        yaw: remotePlayer.yaw,
      })
    }
  }

  if (input.liveRoomState) {
    for (const pickup of Object.values(input.liveRoomState.pickups)) {
      if (pickup.collected) {
        continue
      }
      snapshot.pickups.push({ x: pickup.position.x, z: pickup.position.z })
    }
  } else {
    for (const pickup of input.worldPickups) {
      if (pickup.collected) {
        continue
      }
      snapshot.pickups.push({ x: pickup.x, z: pickup.z })
    }
  }

  if (!usePreviewRoom && !input.liveRoomState) {
    snapshot.localPlayer = { x: input.localPlayer.x, z: input.localPlayer.z, yaw: input.localPlayer.yaw }
  }

  return snapshot
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const getPlayerColor = (playerId: string, palette: string[]) => {
  let hash = 0
  for (let index = 0; index < playerId.length; index += 1) {
    hash = ((hash << 5) - hash + playerId.charCodeAt(index)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
}

const drawPlayerArrow = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  yaw: number,
  color: string,
  size = 13,
) => {
  const headingX = -Math.sin(yaw)
  const headingY = -Math.cos(yaw)
  const tail = size * 0.36
  const wing = size * 0.34

  context.beginPath()
  context.moveTo(x + headingX * size, y + headingY * size)
  context.lineTo(x - headingX * tail + headingY * wing, y - headingY * tail - headingX * wing)
  context.lineTo(x - headingX * tail - headingY * wing, y - headingY * tail + headingX * wing)
  context.closePath()
  context.fillStyle = color
  context.fill()
  context.strokeStyle = 'rgba(6, 5, 8, 0.65)'
  context.lineWidth = 1.2
  context.stroke()
}

export const drawMinimapFrame = (
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  snapshot: MinimapRenderSnapshot,
  palette: string[],
) => {
  const size = canvas.width
  const padding = 14
  const usable = size - padding * 2

  context.clearRect(0, 0, size, size)
  context.fillStyle = 'rgba(9, 5, 7, 0.82)'
  context.fillRect(0, 0, size, size)

  context.strokeStyle = 'rgba(224, 183, 118, 0.38)'
  context.lineWidth = 2
  context.strokeRect(1, 1, size - 2, size - 2)

  const toMapPoint = (x: number, z: number) => {
    const normalizedX = clamp((x - snapshot.worldMinX) / Math.max(snapshot.worldWidth, 0.001), 0, 1)
    const normalizedZ = clamp((z - snapshot.worldMinZ) / Math.max(snapshot.worldHeight, 0.001), 0, 1)
    return {
      x: padding + normalizedX * usable,
      y: padding + normalizedZ * usable,
    }
  }

  context.fillStyle = 'rgba(156, 125, 104, 0.9)'
  for (const brush of snapshot.brushes) {
    const min = toMapPoint(brush.min.x, brush.min.z)
    const max = toMapPoint(brush.max.x, brush.max.z)
    context.fillRect(min.x, min.y, Math.max(1, max.x - min.x), Math.max(1, max.y - min.y))
  }

  for (const enemy of snapshot.enemies) {
    const point = toMapPoint(enemy.x, enemy.z)
    context.beginPath()
    context.fillStyle = '#ff7d66'
    context.arc(point.x, point.y, 3.8, 0, Math.PI * 2)
    context.fill()
  }

  for (const player of snapshot.players) {
    const point = toMapPoint(player.x, player.z)
    const color = getPlayerColor(player.id, palette)
    drawPlayerArrow(context, point.x, point.y, player.yaw, color, player.isLocal ? 14 : 12)
  }

  for (const pickup of snapshot.pickups) {
    const point = toMapPoint(pickup.x, pickup.z)
    context.beginPath()
    context.fillStyle = '#ffcf63'
    context.strokeStyle = '#ffa500'
    context.lineWidth = 2
    context.arc(point.x, point.y, 4.2, 0, Math.PI * 2)
    context.fill()
    context.stroke()
  }

  if (snapshot.localPlayer) {
    const playerPoint = toMapPoint(snapshot.localPlayer.x, snapshot.localPlayer.z)
    context.beginPath()
    context.fillStyle = '#f3dfb2'
    context.arc(playerPoint.x, playerPoint.y, 4.6, 0, Math.PI * 2)
    context.fill()

    const headingLength = 14
    const rightLength = 5
    const headingX = -Math.sin(snapshot.localPlayer.yaw)
    const headingY = -Math.cos(snapshot.localPlayer.yaw)
    context.beginPath()
    context.moveTo(playerPoint.x + headingX * headingLength, playerPoint.y + headingY * headingLength)
    context.lineTo(playerPoint.x - headingX * 5 + headingY * rightLength, playerPoint.y - headingY * 5 - headingX * rightLength)
    context.lineTo(playerPoint.x - headingX * 5 - headingY * rightLength, playerPoint.y - headingY * 5 + headingX * rightLength)
    context.closePath()
    context.fillStyle = '#d8aa57'
    context.fill()
  }
}
