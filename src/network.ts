import type {
  ClientMessage,
  EnemyState,
  GameWorldSummary,
  PlayerState,
  ProjectileState,
  RoomState,
  StateSyncPayload,
  ServerMessage,
} from './shared/multiplayer.js'
import type { Vec3 } from './shared/contracts.js'

export type NetworkCallbacks = {
  onWelcome: (playerId: string, room: RoomState) => void
  onWorldDirectory: (worlds: GameWorldSummary[]) => void
  onMapPreviewState: (room: RoomState | null) => void
  onPlayerJoined: (player: PlayerState) => void
  onPlayerLeft: (playerId: string) => void
  onPlayerUpdate: (playerId: string, state: Partial<PlayerState>) => void
  onEnemyUpdate: (enemyId: string, state: Partial<EnemyState>) => void
  onEnemySpawn: (enemy: EnemyState) => void
  onEnemyDied: (enemyId: string, killerId: string) => void
  onProjectileSpawn: (projectile: ProjectileState) => void
  onPickupCollected: (pickupId: string, playerId: string) => void
  onStateSync: (room: RoomState, metadata: Omit<StateSyncPayload, 'room'>) => void
}

export class NetworkClient {
  private ws: WebSocket | null = null
  private callbacks: NetworkCallbacks
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 2000
  private queuedMessages: ClientMessage[] = []
  private pendingJoin: { name: string; mapId: string } | null = null
  private previewMapId: string | null = null
  private shouldReconnect = true
  private serverUrls: string[] = []
  private activeServerUrlIndex = 0
  private localPlayerId: string | null = null
  private nextInputSeq = 0
  private latestAckInputSeq = 0

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks
  }

  connect(serverUrl: string | string[]) {
    this.serverUrls = Array.from(new Set(Array.isArray(serverUrl) ? serverUrl : [serverUrl]))
    this.activeServerUrlIndex = 0
    this.reconnectAttempts = 0
    this.shouldReconnect = true
    this.connectCurrentServer()
  }

  private connectCurrentServer() {
    const currentUrl = this.serverUrls[this.activeServerUrlIndex]
    if (!currentUrl) {
      console.error('[Network] No server URL available for connection')
      return
    }

    try {
      this.ws = new WebSocket(currentUrl)

      this.ws.onopen = () => {
        console.log(`[Network] Connected to server via ${currentUrl}`)
        this.reconnectAttempts = 0
        this.send({ type: 'subscribe-world-directory', payload: {} })
        if (this.previewMapId) {
          this.send({ type: 'subscribe-map-preview', payload: { mapId: this.previewMapId } })
        }
        if (this.pendingJoin) {
          this.send({ type: 'join', payload: this.pendingJoin })
        }
        for (const queued of this.queuedMessages.splice(0)) {
          this.send(queued)
        }
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage
          this.handleServerMessage(message)
        } catch (error) {
          console.error('[Network] Invalid message:', error)
        }
      }

      this.ws.onclose = () => {
        console.log('[Network] Disconnected from server')
        if (this.shouldReconnect) {
          this.attemptReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('[Network] WebSocket error:', error)
      }
    } catch (error) {
      console.error('[Network] Failed to connect:', error)
      this.attemptReconnect()
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++
      console.log(`[Network] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
      setTimeout(() => {
        this.connectCurrentServer()
      }, this.reconnectDelay)
      return
    }

    if (this.activeServerUrlIndex < this.serverUrls.length - 1) {
      this.activeServerUrlIndex += 1
      this.reconnectAttempts = 0
      const nextUrl = this.serverUrls[this.activeServerUrlIndex]
      console.warn(`[Network] Switching to fallback server URL: ${nextUrl}`)
      this.connectCurrentServer()
      return
    }

    console.error('[Network] Max reconnection attempts reached on all server URLs')
  }

  private handleServerMessage(message: ServerMessage) {
    switch (message.type) {
      case 'welcome':
        this.localPlayerId = message.payload.playerId
        this.callbacks.onWelcome(message.payload.playerId, message.payload.room)
        break
      case 'world-directory':
        this.callbacks.onWorldDirectory(message.payload.worlds)
        break
      case 'map-preview-state':
        this.callbacks.onMapPreviewState(message.payload.room)
        break
      case 'net-ping':
        this.send({
          type: 'net-pong',
          payload: {
            sentAt: message.payload.sentAt,
            clientSentAt: Date.now(),
          },
        })
        break
      case 'player-joined':
        this.callbacks.onPlayerJoined(message.payload.player)
        break
      case 'player-left':
        this.callbacks.onPlayerLeft(message.payload.playerId)
        break
      case 'player-update':
        this.callbacks.onPlayerUpdate(message.payload.playerId, message.payload.state)
        break
      case 'enemy-update':
        this.callbacks.onEnemyUpdate(message.payload.enemyId, message.payload.state)
        break
      case 'enemy-spawn':
        this.callbacks.onEnemySpawn(message.payload.enemy)
        break
      case 'enemy-died':
        this.callbacks.onEnemyDied(message.payload.enemyId, message.payload.killerId)
        break
      case 'projectile-spawn':
        this.callbacks.onProjectileSpawn(message.payload.projectile)
        break
      case 'pickup-collected':
        this.callbacks.onPickupCollected(message.payload.pickupId, message.payload.playerId)
        break
      case 'state-sync':
        if (this.localPlayerId && message.payload.latestInputSeqByPlayer) {
          const acknowledged = message.payload.latestInputSeqByPlayer[this.localPlayerId]
          if (typeof acknowledged === 'number' && acknowledged > this.latestAckInputSeq) {
            this.latestAckInputSeq = acknowledged
          }
        }
        this.callbacks.onStateSync(message.payload.room, {
          latestInputSeqByPlayer: message.payload.latestInputSeqByPlayer,
          latencyByPlayer: message.payload.latencyByPlayer,
          sentAt: message.payload.sentAt,
          serverTick: message.payload.serverTick,
        })
        break
    }
  }

  send(message: ClientMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      this.queuedMessages.push(message)
    }
  }

  join(name: string, mapId: string) {
    this.pendingJoin = { name, mapId }
    this.send({
      type: 'join',
      payload: { name, mapId },
    })
  }

  leaveWorld() {
    this.pendingJoin = null
    this.send({
      type: 'leave-world',
      payload: {},
    })
  }

  setMapPreview(mapId: string) {
    this.previewMapId = mapId
    this.send({
      type: 'subscribe-map-preview',
      payload: { mapId },
    })
  }

  sendInput(position: Vec3, yaw: number, pitch: number) {
    this.nextInputSeq += 1
    this.send({
      type: 'input',
      payload: {
        position,
        yaw,
        pitch,
        inputSeq: this.nextInputSeq,
        sentAt: Date.now(),
      },
    })
  }

  getLatestSentInputSeq() {
    return this.nextInputSeq
  }

  getLatestAckInputSeq() {
    return this.latestAckInputSeq
  }

  sendShoot(position: Vec3, direction: Vec3, tier: number) {
    this.send({
      type: 'shoot',
      payload: { position, direction, tier },
    })
  }

  sendDamageEnemy(enemyId: string, damage: number) {
    this.send({
      type: 'damage-enemy',
      payload: { enemyId, damage },
    })
  }

  sendCollectPickup(pickupId: string) {
    this.send({
      type: 'collect-pickup',
      payload: { pickupId },
    })
  }

  sendInvulnerable(invulnerable: boolean) {
    this.send({
      type: 'set-invulnerable',
      payload: { invulnerable },
    })
  }

  sendDeath(score: number) {
    this.send({
      type: 'death',
      payload: { score },
    })
  }

  sendRespawn() {
    this.send({
      type: 'respawn',
      payload: {},
    })
  }

  disconnect() {
    if (this.ws) {
      this.shouldReconnect = false
      this.ws.close()
      this.ws = null
    }
    this.localPlayerId = null
    this.nextInputSeq = 0
    this.latestAckInputSeq = 0
  }

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }
}
