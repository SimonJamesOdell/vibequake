import type { Vec3 } from './contracts.js'

// Player state shared between clients
export type PlayerState = {
  id: string
  name: string
  position: Vec3
  yaw: number
  pitch: number
  health: number
  weaponTier: number
  invulnerable: boolean
  isDead: boolean
  score: number
}

// Enemy state synchronized across clients
export type EnemyState = {
  id: string
  kind: string
  position: Vec3
  health: number
  maxHealth: number
  isDead: boolean
}

// Projectile state for synchronized shooting
export type ProjectileState = {
  id: string
  playerId: string
  position: Vec3
  direction: Vec3
  tier: number
  createdAt: number
}

// Weapon upgrade pickup state
export type PickupState = {
  id: string
  position: Vec3
  tier: 1 | 2
  collected: boolean
}

// Game room state
export type RoomState = {
  roomId?: string
  mapId: string
  players: Record<string, PlayerState>
  enemies: Record<string, EnemyState>
  pickups: Record<string, PickupState>
  startedAt: number
}

export type GameWorldSummary = {
  roomId: string
  mapId: string
  players: number
  maxPlayers: number
  startedAt: number
}

// Client -> Server messages
export type ClientMessage =
  | { type: 'join'; payload: { name: string; mapId: string } }
  | { type: 'leave-world'; payload: Record<string, never> }
  | { type: 'subscribe-world-directory'; payload: Record<string, never> }
  | { type: 'subscribe-map-preview'; payload: { mapId: string } }
  | { type: 'input'; payload: { position: Vec3; yaw: number; pitch: number } }
  | { type: 'shoot'; payload: { position: Vec3; direction: Vec3; tier: number } }
  | { type: 'damage-enemy'; payload: { enemyId: string; damage: number } }
  | { type: 'collect-pickup'; payload: { pickupId: string } }
  | { type: 'set-invulnerable'; payload: { invulnerable: boolean } }
  | { type: 'death'; payload: { score: number } }
  | { type: 'respawn'; payload: Record<string, never> }

// Server -> Client messages
export type ServerMessage =
  | { type: 'welcome'; payload: { playerId: string; room: RoomState } }
  | { type: 'world-directory'; payload: { worlds: GameWorldSummary[] } }
  | { type: 'map-preview-state'; payload: { room: RoomState | null } }
  | { type: 'player-joined'; payload: { player: PlayerState } }
  | { type: 'player-left'; payload: { playerId: string } }
  | { type: 'player-update'; payload: { playerId: string; state: Partial<PlayerState> } }
  | { type: 'enemy-update'; payload: { enemyId: string; state: Partial<EnemyState> } }
  | { type: 'enemy-spawn'; payload: { enemy: EnemyState } }
  | { type: 'enemy-died'; payload: { enemyId: string; killerId: string } }
  | { type: 'projectile-spawn'; payload: { projectile: ProjectileState } }
  | { type: 'pickup-collected'; payload: { pickupId: string; playerId: string } }
  | { type: 'state-sync'; payload: { room: RoomState } }
