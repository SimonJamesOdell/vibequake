import { randomUUID } from 'node:crypto'
import type { WebSocket } from 'ws'

import type {
  ClientMessage,
  EnemyState,
  GameWorldSummary,
  PlayerState,
  ProjectileState,
  RoomState,
  ServerMessage,
} from '../src/shared/multiplayer.js'
import type { Vec3 } from '../src/shared/contracts.js'

type RoomBootstrap = {
  playerSpawn: Vec3
  enemySpawns: Vec3[]
  bounds: {
    min: Vec3
    max: Vec3
  }
}

type MultiplayerManagerOptions = {
  resolveBootstrap: (mapId: string) => Promise<RoomBootstrap>
}

type Client = {
  id: string
  ws: WebSocket
  playerId: string
  roomId: string
  name: string
  lastUpdate: number
}

type GameRoom = {
  id: string
  mapId: string
  spawnPoint: Vec3
  bounds: { min: Vec3; max: Vec3 }
  enemySpawnPoints: Vec3[]
  safeSpawnPoints: Vec3[] // Known collision-free spawn positions
  state: RoomState
  clients: Map<string, Client>
  enemyRespawnQueue: Array<{ id: string; spawnAt: number }>
  lastStateSyncAt: number
  lastTickAt: number
}

export class MultiplayerManager {
  private static readonly MAX_PLAYERS_PER_WORLD = 4
  private static readonly STALE_CLIENT_TIMEOUT_MS = 12000
  private static readonly PREVIEW_SYNC_INTERVAL_MS = 250
  private readonly options: MultiplayerManagerOptions
  private readonly cheatsAllowed = process.env.NODE_ENV !== 'production'
  private rooms = new Map<string, GameRoom>()
  private clients = new Map<WebSocket, Client>()
  private roomCountersByMap = new Map<string, number>()
  private directorySubscribers = new Set<WebSocket>()
  private mapPreviewSubscriptions = new Map<WebSocket, string>()
  private lastPreviewSyncAt = 0

  constructor(options: MultiplayerManagerOptions) {
    this.options = options
  }

  handleConnection(ws: WebSocket) {
    console.log('[Multiplayer] New client connected')
    this.directorySubscribers.add(ws)
    this.sendWorldDirectory(ws)

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage
        void this.handleClientMessage(ws, message)
      } catch (error) {
        console.error('[Multiplayer] Invalid message:', error)
      }
    })

    ws.on('close', () => {
      this.handleDisconnection(ws)
    })

    ws.on('error', (error) => {
      console.error('[Multiplayer] WebSocket error:', error)
    })
  }

  private async handleClientMessage(ws: WebSocket, message: ClientMessage) {
    const client = this.clients.get(ws)
    if (client) {
      client.lastUpdate = Date.now()
    }

    switch (message.type) {
      case 'join':
        await this.handleJoin(ws, message.payload)
        break
      case 'leave-world':
        if (client) this.handleLeaveWorld(client)
        break
      case 'subscribe-world-directory':
        this.sendWorldDirectory(ws)
        break
      case 'subscribe-map-preview':
        this.mapPreviewSubscriptions.set(ws, message.payload.mapId)
        this.sendMapPreviewState(ws, message.payload.mapId)
        break
      case 'input':
        if (client) this.handleInput(client, message.payload)
        break
      case 'shoot':
        if (client) this.handleShoot(client, message.payload)
        break
      case 'damage-enemy':
        if (client) this.handleDamageEnemy(client, message.payload)
        break
      case 'collect-pickup':
        if (client) this.handleCollectPickup(client, message.payload)
        break
      case 'set-invulnerable':
        if (client) this.handleSetInvulnerable(client, message.payload)
        break
      case 'death':
        if (client) this.handleDeath(client, message.payload)
        break
      case 'respawn':
        if (client) this.handleRespawn(client)
        break
    }
  }

  private async handleJoin(ws: WebSocket, payload: { name: string; mapId: string }) {
    const playerId = randomUUID()
    const room = await this.getOrCreateRoom(payload.mapId)

    // Create client
    const client: Client = {
      id: randomUUID(),
      ws,
      playerId,
      roomId: room.id,
      name: payload.name || 'Player',
      lastUpdate: Date.now(),
    }

    this.clients.set(ws, client)
    room.clients.set(client.id, client)

    // Generate distributed spawn position for this player
    const spawnPosition = this.generatePlayerSpawn(room, Object.keys(room.state.players).length)

    // Create player state
    const player: PlayerState = {
      id: playerId,
      name: client.name,
      position: spawnPosition,
      yaw: this.calculateSpawnYaw(spawnPosition, room.bounds),
      pitch: 0,
      health: 100,
      weaponTier: 0,
      invulnerable: false,
      isDead: false,
      score: 0,
    }

    room.state.players[playerId] = player

    // Send welcome message with full room state
    this.send(ws, {
      type: 'welcome',
      payload: {
        playerId,
        room: room.state,
      },
    })

    // Notify other players
    this.broadcast(room, {
      type: 'player-joined',
      payload: { player },
    }, client.id)

    this.broadcastWorldDirectory()
    console.log(`[Multiplayer] Player ${client.name} joined room ${room.id}`)
  }

  private async getOrCreateRoom(mapId: string) {
    const candidates = Array.from(this.rooms.values())
      .filter((room) => room.mapId === mapId && room.clients.size < MultiplayerManager.MAX_PLAYERS_PER_WORLD)
      .sort((left, right) => left.state.startedAt - right.state.startedAt)

    if (candidates.length > 0) {
      return candidates[0]
    }

    const roomCounter = this.roomCountersByMap.get(mapId) ?? 0
    const nextCounter = roomCounter + 1
    this.roomCountersByMap.set(mapId, nextCounter)
    const roomId = `room-${mapId}-${nextCounter}`
    const bootstrap = await this.options.resolveBootstrap(mapId)
    const room = this.createRoom(roomId, mapId, bootstrap)
    this.rooms.set(roomId, room)
    this.broadcastWorldDirectory()
    return room
  }

  private handleInput(client: Client, payload: { position: Vec3; yaw: number; pitch: number }) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const player = room.state.players[client.playerId]
    if (!player || player.isDead) return

    // Update player state
    player.position = payload.position
    player.yaw = payload.yaw
    player.pitch = payload.pitch
    client.lastUpdate = Date.now()

    // Broadcast to other players (throttled in practice)
    this.broadcast(room, {
      type: 'player-update',
      payload: {
        playerId: client.playerId,
        state: {
          position: payload.position,
          yaw: payload.yaw,
          pitch: payload.pitch,
        },
      },
    }, client.id)
  }

  private handleShoot(client: Client, payload: { position: Vec3; direction: Vec3; tier: number }) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const projectile: ProjectileState = {
      id: randomUUID(),
      playerId: client.playerId,
      position: payload.position,
      direction: payload.direction,
      tier: payload.tier,
      createdAt: Date.now(),
    }

    // Broadcast projectile to all clients
    this.broadcast(room, {
      type: 'projectile-spawn',
      payload: { projectile },
    })
  }

  private handleDamageEnemy(client: Client, payload: { enemyId: string; damage: number }) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const enemy = room.state.enemies[payload.enemyId]
    if (!enemy || enemy.isDead) return

    enemy.health -= payload.damage

    if (enemy.health <= 0) {
      enemy.health = 0
      enemy.isDead = true

      // Update player score
      const player = room.state.players[client.playerId]
      if (player) {
        player.score += 100
      }

      // Broadcast enemy death
      this.broadcast(room, {
        type: 'enemy-died',
        payload: {
          enemyId: payload.enemyId,
          killerId: client.playerId,
        },
      })

      // Schedule respawn (10 seconds)
      room.enemyRespawnQueue.push({
        id: payload.enemyId,
        spawnAt: Date.now() + 10000,
      })
    } else {
      // Broadcast health update
      this.broadcast(room, {
        type: 'enemy-update',
        payload: {
          enemyId: payload.enemyId,
          state: { health: enemy.health },
        },
      })
    }
  }

  private handleCollectPickup(client: Client, payload: { pickupId: string }) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const pickup = room.state.pickups[payload.pickupId]
    if (!pickup || pickup.collected) return

    pickup.collected = true

    // Update player weapon tier
    const player = room.state.players[client.playerId]
    if (player) {
      player.weaponTier = pickup.tier
    }

    // Broadcast pickup collection
    this.broadcast(room, {
      type: 'pickup-collected',
      payload: {
        pickupId: payload.pickupId,
        playerId: client.playerId,
      },
    })
  }

  private handleSetInvulnerable(client: Client, payload: { invulnerable: boolean }) {
    if (!this.cheatsAllowed) {
      return
    }

    const room = this.rooms.get(client.roomId)
    if (!room) return

    const player = room.state.players[client.playerId]
    if (!player) return

    player.invulnerable = payload.invulnerable
    if (payload.invulnerable) {
      player.health = 100
      player.isDead = false
    }

    this.broadcast(room, {
      type: 'player-update',
      payload: {
        playerId: client.playerId,
        state: {
          invulnerable: player.invulnerable,
          health: player.health,
          isDead: player.isDead,
        },
      },
    })
  }

  private handleDeath(client: Client, payload: { score: number }) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const player = room.state.players[client.playerId]
    if (!player) return

    player.isDead = true
    player.health = 0
    player.score = payload.score

    this.broadcast(room, {
      type: 'player-update',
      payload: {
        playerId: client.playerId,
        state: { isDead: true, health: 0, score: payload.score },
      },
    })
  }

  private handleRespawn(client: Client) {
    const room = this.rooms.get(client.roomId)
    if (!room) return

    const player = room.state.players[client.playerId]
    if (!player) return

    // Generate new spawn position for respawn
    const playerIndex = Object.keys(room.state.players).indexOf(client.playerId)
    const newSpawn = this.generatePlayerSpawn(room, playerIndex)
    const newYaw = this.calculateSpawnYaw(newSpawn, room.bounds)

    player.isDead = false
    player.health = 100
    player.weaponTier = 0
    player.position = newSpawn
    player.yaw = newYaw

    this.broadcast(room, {
      type: 'player-update',
      payload: {
        playerId: client.playerId,
        state: { 
          isDead: false, 
          health: 100, 
          weaponTier: 0,
          position: newSpawn,
          yaw: newYaw,
        },
      },
    })
  }

  private handleLeaveWorld(client: Client) {
    const room = this.rooms.get(client.roomId)
    if (!room) {
      return
    }

    this.evictClient(room, client, 'left-world', false)
  }

  private handleDisconnection(ws: WebSocket) {
    this.directorySubscribers.delete(ws)
    this.mapPreviewSubscriptions.delete(ws)

    const client = this.clients.get(ws)
    if (!client) return

    const room = this.rooms.get(client.roomId)
    if (room) {
      // Remove player from room
      delete room.state.players[client.playerId]
      room.clients.delete(client.id)

      // Notify other players
      this.broadcast(room, {
        type: 'player-left',
        payload: { playerId: client.playerId },
      })

      // Clean up empty rooms
      if (room.clients.size === 0) {
        this.rooms.delete(client.roomId)
        console.log(`[Multiplayer] Room ${client.roomId} closed (empty)`)
      }

      this.broadcastWorldDirectory()
    }
    this.clients.delete(ws)
    console.log(`[Multiplayer] Player ${client.name} disconnected`)
  }

  private evictClient(room: GameRoom, client: Client, reason: string, closeSocket = true) {
    delete room.state.players[client.playerId]
    room.clients.delete(client.id)
    this.clients.delete(client.ws)

    this.broadcast(room, {
      type: 'player-left',
      payload: { playerId: client.playerId },
    })

    this.broadcastWorldDirectory()
    console.log(`[Multiplayer] Player ${client.name} evicted from ${room.id}: ${reason}`)

    if (room.clients.size === 0) {
      this.rooms.delete(room.id)
      console.log(`[Multiplayer] Room ${room.id} closed (empty)`)
    }

    if (closeSocket && (client.ws.readyState === client.ws.OPEN || client.ws.readyState === client.ws.CONNECTING)) {
      client.ws.close(1000, reason)
    }
  }

  private createRoom(roomId: string, mapId: string, bootstrap: RoomBootstrap): GameRoom {
    const enemies: Record<string, EnemyState> = {}
    const enemyKinds: Array<EnemyState['kind']> = ['zombie', 'blob', 'glub']
    for (const [index, spawn] of bootstrap.enemySpawns.entries()) {
      enemies[`${mapId}-enemy-${index}`] = {
        id: `${mapId}-enemy-${index}`,
        kind: enemyKinds[index % enemyKinds.length],
        position: { ...spawn },
        health: 6,
        maxHealth: 6,
        isDead: false,
      }
    }

    const pickups: RoomState['pickups'] = {}
    const isAbyssalFamily = mapId === 'abyssal-grotto' || mapId === 'abyssal-grotto-prime'
    if (isAbyssalFamily) {
      pickups[`${mapId}-pickup-tier-1`] = {
        id: `${mapId}-pickup-tier-1`,
        tier: 1,
        collected: false,
        position: {
          x: bootstrap.bounds.min.x + 5.4,
          y: bootstrap.playerSpawn.y,
          z: bootstrap.bounds.max.z - 6.2,
        },
      }
      pickups[`${mapId}-pickup-tier-2`] = {
        id: `${mapId}-pickup-tier-2`,
        tier: 2,
        collected: false,
        position: {
          x: bootstrap.bounds.max.x - 6.1,
          y: bootstrap.playerSpawn.y,
          z: bootstrap.bounds.min.z + 5.1,
        },
      }
    }

    const room: GameRoom = {
      id: roomId,
      mapId,
      spawnPoint: { ...bootstrap.playerSpawn },
      bounds: { ...bootstrap.bounds },
      enemySpawnPoints: bootstrap.enemySpawns.map((spawn) => ({ ...spawn })),
      safeSpawnPoints: [
        { ...bootstrap.playerSpawn },
        ...bootstrap.enemySpawns.map(s => ({ ...s }))
      ],
      state: {
        roomId,
        mapId,
        players: {},
        enemies,
        pickups,
        startedAt: Date.now(),
      },
      clients: new Map(),
      enemyRespawnQueue: [],
      lastStateSyncAt: Date.now(),
      lastTickAt: Date.now(),
    }

    console.log(`[Multiplayer] Created room ${roomId} for map ${mapId}`)
    return room
  }

  private generatePlayerSpawn(room: GameRoom, playerIndex: number): Vec3 {
    // Use known-safe spawn points (player spawn + enemy spawns) to avoid wall collisions
    // Cycle through these positions, offset slightly to distribute players
    if (room.safeSpawnPoints.length === 0) {
      return { ...room.spawnPoint }
    }

    const baseIndex = playerIndex % room.safeSpawnPoints.length
    const baseSpawn = room.safeSpawnPoints[baseIndex]
    
    // Add a small radial offset based on how many times we've cycled through all spawns
    const cycle = Math.floor(playerIndex / room.safeSpawnPoints.length)
    const offsetAngle = (cycle * 1.8) % (Math.PI * 2)
    const offsetRadius = cycle * 1.2
    
    return {
      x: baseSpawn.x + Math.cos(offsetAngle) * offsetRadius,
      y: baseSpawn.y,
      z: baseSpawn.z + Math.sin(offsetAngle) * offsetRadius,
    }
  }

  private calculateSpawnYaw(position: Vec3, bounds: { min: Vec3; max: Vec3 }): number {
    // Calculate yaw to face toward center of the map
    const centerX = (bounds.min.x + bounds.max.x) / 2
    const centerZ = (bounds.min.z + bounds.max.z) / 2
    const dx = centerX - position.x
    const dz = centerZ - position.z
    return Math.atan2(dx, dz)
  }

  private chooseEnemyRespawnPosition(room: GameRoom, alivePlayers: PlayerState[]): Vec3 {
    const candidates = room.enemySpawnPoints.length > 0 ? room.enemySpawnPoints : room.safeSpawnPoints
    if (candidates.length === 0) {
      return { ...room.spawnPoint }
    }

    if (alivePlayers.length === 0) {
      return { ...candidates[Math.floor(Math.random() * candidates.length)] }
    }

    const minDesiredDistanceSq = 12 * 12
    const farEnough = candidates.filter((candidate) => {
      for (const player of alivePlayers) {
        const dx = player.position.x - candidate.x
        const dz = player.position.z - candidate.z
        if (dx * dx + dz * dz < minDesiredDistanceSq) {
          return false
        }
      }
      return true
    })

    const pool = farEnough.length > 0 ? farEnough : candidates
    return { ...pool[Math.floor(Math.random() * pool.length)] }
  }

  private send(ws: WebSocket, message: ServerMessage) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private buildWorldDirectory(): GameWorldSummary[] {
    return Array.from(this.rooms.values())
      .map((room) => ({
        roomId: room.id,
        mapId: room.mapId,
        players: room.clients.size,
        maxPlayers: MultiplayerManager.MAX_PLAYERS_PER_WORLD,
        startedAt: room.state.startedAt,
      }))
      .sort((left, right) => left.mapId.localeCompare(right.mapId) || left.startedAt - right.startedAt)
  }

  private sendWorldDirectory(ws: WebSocket) {
    this.send(ws, {
      type: 'world-directory',
      payload: {
        worlds: this.buildWorldDirectory(),
      },
    })
  }

  private broadcastWorldDirectory() {
    const worlds = this.buildWorldDirectory()
    for (const ws of this.directorySubscribers) {
      this.send(ws, {
        type: 'world-directory',
        payload: { worlds },
      })
    }
  }

  private broadcast(room: GameRoom, message: ServerMessage, excludeClientId?: string) {
    for (const [clientId, client] of room.clients) {
      if (clientId !== excludeClientId) {
        this.send(client.ws, message)
      }
    }
  }

  private getPreviewRoomForMap(mapId: string) {
    const roomsForMap = Array.from(this.rooms.values()).filter((room) => room.mapId === mapId && room.clients.size > 0)
    if (roomsForMap.length === 0) {
      return null
    }

    roomsForMap.sort((left, right) => {
      if (right.clients.size !== left.clients.size) {
        return right.clients.size - left.clients.size
      }
      return left.state.startedAt - right.state.startedAt
    })

    return roomsForMap[0]
  }

  private sendMapPreviewState(ws: WebSocket, mapId: string) {
    const room = this.getPreviewRoomForMap(mapId)
    this.send(ws, {
      type: 'map-preview-state',
      payload: {
        room: room?.state ?? null,
      },
    })
  }

  private broadcastMapPreviewStates() {
    if (this.mapPreviewSubscriptions.size === 0) {
      return
    }

    const roomByMap = new Map<string, RoomState | null>()
    for (const mapId of new Set(this.mapPreviewSubscriptions.values())) {
      roomByMap.set(mapId, this.getPreviewRoomForMap(mapId)?.state ?? null)
    }

    for (const [ws, mapId] of this.mapPreviewSubscriptions) {
      this.send(ws, {
        type: 'map-preview-state',
        payload: {
          room: roomByMap.get(mapId) ?? null,
        },
      })
    }
  }

  // Process enemy respawns
  tick() {
    const now = Date.now()
    for (const room of this.rooms.values()) {
      const staleClients = Array.from(room.clients.values()).filter(
        (client) => now - client.lastUpdate > MultiplayerManager.STALE_CLIENT_TIMEOUT_MS,
      )
      for (const staleClient of staleClients) {
        this.evictClient(room, staleClient, 'stale-client-timeout')
      }

      const deltaSeconds = Math.min(Math.max((now - room.lastTickAt) / 1000, 0), 0.1)
      room.lastTickAt = now

      const alivePlayers = Object.values(room.state.players).filter((player) => !player.isDead && player.health > 0)
      if (alivePlayers.length > 0) {
        for (const enemy of Object.values(room.state.enemies)) {
          if (enemy.isDead) {
            continue
          }

          let nearest = alivePlayers[0]
          let nearestDistanceSq = Number.POSITIVE_INFINITY
          for (const player of alivePlayers) {
            const dx = player.position.x - enemy.position.x
            const dz = player.position.z - enemy.position.z
            const distanceSq = dx * dx + dz * dz
            if (distanceSq < nearestDistanceSq) {
              nearestDistanceSq = distanceSq
              nearest = player
            }
          }

          const distance = Math.sqrt(nearestDistanceSq)
          if (distance > 0.001) {
            const speed = 2.3
            const stopDistance = 1.7
            if (distance > stopDistance) {
              const step = Math.min(distance - stopDistance, speed * deltaSeconds)
              enemy.position.x += ((nearest.position.x - enemy.position.x) / distance) * step
              enemy.position.z += ((nearest.position.z - enemy.position.z) / distance) * step
            }
          }

          if (distance < 2.0) {
            if (nearest.invulnerable) {
              continue
            }
            const nextHealth = Math.max(0, nearest.health - 6.25 * deltaSeconds)
            if (nextHealth !== nearest.health) {
              nearest.health = nextHealth
              if (nearest.health <= 0) {
                nearest.isDead = true
              }
              this.broadcast(room, {
                type: 'player-update',
                payload: {
                  playerId: nearest.id,
                  state: {
                    health: nearest.health,
                    isDead: nearest.isDead,
                  },
                },
              })
            }
          }
        }
      }

      const toRespawn = room.enemyRespawnQueue.filter((entry) => entry.spawnAt <= now)
      room.enemyRespawnQueue = room.enemyRespawnQueue.filter((entry) => entry.spawnAt > now)

      for (const { id } of toRespawn) {
        const enemy = room.state.enemies[id]
        if (enemy) {
          const respawnPosition = this.chooseEnemyRespawnPosition(room, alivePlayers)
          enemy.position = respawnPosition
          enemy.health = enemy.maxHealth
          enemy.isDead = false

          this.broadcast(room, {
            type: 'enemy-spawn',
            payload: { enemy },
          })
        }
      }

      if (now - room.lastStateSyncAt >= 250) {
        room.lastStateSyncAt = now
        this.broadcast(room, {
          type: 'state-sync',
          payload: { room: room.state },
        })
      }
    }

    if (now - this.lastPreviewSyncAt >= MultiplayerManager.PREVIEW_SYNC_INTERVAL_MS) {
      this.lastPreviewSyncAt = now
      this.broadcastMapPreviewStates()
    }
  }
}
