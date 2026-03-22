import * as THREE from 'three'
import { loadZombieEnemyAsset, loadBlobEnemyAsset, loadGlubEnemyAsset, getEnemyVisualAsset, pickEnemyVisualKind, type EnemyVisualAssets } from './systems/enemy-model-loader'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type { ArenaMap } from './shared/contracts'
import { legacyTilesToBrushMap } from './shared/legacy-map'
import { TextureManager } from './texture-manager'
import { NetworkClient, type NetworkCallbacks } from './network'
import type { GameWorldSummary, PlayerState, RoomState, StateSyncPayload } from './shared/multiplayer'
import { loadArenaMap, loadAvailableMaps, submitHighScore } from './api-client'
import { AvatarSystem, createRemotePlayerAvatar, type RemotePlayerVisual } from './systems/avatar-system'
import { createMinimapSnapshot, drawMinimapFrame } from './systems/minimap-system'
import { spawnRemoteProjectileVisual } from './systems/remote-projectile-system'
import { getHudHintText } from './systems/hud-system'
import { buildWeaponView } from './systems/weapon-view-system'
import { buildIndustrialRustPresentation as buildIndustrialRustPresentationSystem, buildCavernDecoration, buildNeonTechDecoration } from './systems/presentation-system'
import { addSolidBrush as addSolidBrushToScene } from './systems/brush-system'
import { wallTexture, ceilingTexture, resolveVisualTheme, resolveWorldVariant } from './systems/texture-system'
import { ENEMY_ARCHETYPE_PRESETS, type EnemyArchetypePreset, type EnemyVisualKind, getVisualBodyHeight, getVisualAimHeight, getEnemyVisualScaleMultiplier } from './systems/enemy-archetypes'
import { renderWorldDirectory } from './systems/world-directory-system'
import { getWeaponCooldown, getWeaponDamageMultiplier, getProjectileImpactColor } from './systems/weapon-system'
import { mountGameShell, type HudRefs } from './ui/game-shell'
import { HitCounterSystem } from './systems/hit-counter-system'
import { InputHistorySystem } from './systems/input-history-system'
import { WeaponPickupSystem } from './systems/weapon-pickup-system'
import { isGameActionPressed, matchesGameActionCode } from './input/actions'
import { resolveDevCommand } from './input/dev-commands'
import {
  getBodyVerticalBounds,
  overlapsVolumeXZBounds,
  overlapsVolumeYRange,
  getVolumeSurfaceHeight,
  isPositionBlockedByVolumes,
  calculateStepHeight,
  canAutoStep,
  getNearestPointOnVolume,
  calculatePushVector,
  type SolidVolume,
} from './collision-geometry'


type Enemy = {
  id: string
  group: THREE.Group
  core: THREE.Mesh
  hitbox: THREE.Mesh
  rings: THREE.Mesh[]
  visualKind: EnemyVisualKind
  modelRoot: THREE.Object3D | null
  mixer: THREE.AnimationMixer | null
  angle: number
  speed: number
  bobOffset: number
  health: number
  maxHealth: number
  radius: number
  aimHeight: number
  archetypeName: string
  respawn: number
  canShootAt: number
}

type EnemyArchetype = EnemyArchetypePreset & {
  coreMaterial: THREE.MeshStandardMaterial
  ringMaterial: THREE.MeshStandardMaterial
}

type Impact = {
  mesh: THREE.Mesh
  life: number
}

type ProjectileNode = {
  point: THREE.Vector3
  enemy?: Enemy
  impactColor?: string
  damageOnArrival?: boolean
  damageMultiplier?: number
}

type Projectile = {
  mesh: THREE.Mesh
  start: THREE.Vector3
  nodes: ProjectileNode[]
  segmentIndex: number
  segmentProgress: number
  speed: number
  remaining: number
  baseOpacity: number
}

type EnemyBolt = {
  mesh: THREE.Mesh
  direction: THREE.Vector3
  remaining: number
  speed: number
}


const PROJECTILE_LENGTH = 1.8
const PROJECTILE_HALF_LENGTH = PROJECTILE_LENGTH / 2
const CRITICAL_HIT_CHANCE = 0.18

const CELL_SIZE = 2.2
const DEFAULT_MAP = legacyTilesToBrushMap({
  id: 'cathedral-cavern',
  name: 'Cathedral Cavern',
  description: 'A baroque underworld arena with a central nave, lateral reliquaries, and a southern altar hall.',
  tiles: [
    '#################################',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............##.##.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#...............................#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............#...#.............#',
    '#.............##.##.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#.............#####.............#',
    '#...............................#',
    '#...............................#',
    '#################################',
  ],
  playerSpawn: { column: 4, row: 22 },
  enemySpawns: [
    { column: 4, row: 3 },
    { column: 28, row: 3 },
    { column: 6, row: 10 },
    { column: 26, row: 10 },
    { column: 4, row: 20 },
    { column: 28, row: 20 },
  ],
  updatedAt: '2026-03-07T00:00:00.000Z',
})

let activeMap: ArenaMap = DEFAULT_MAP
let WORLD_WIDTH = 0
let WORLD_HEIGHT = 0
let WORLD_MIN_X = 0
let WORLD_MAX_X = 0
let WORLD_MIN_Z = 0
let WORLD_MAX_Z = 0
let PLAYER_SPAWN = new THREE.Vector3()
let ENEMY_SPAWNS: THREE.Vector3[] = []

const configureMap = (map: ArenaMap) => {
  const width = map.bounds.max.x - map.bounds.min.x
  const depth = map.bounds.max.z - map.bounds.min.z
  if (width <= 0 || depth <= 0 || map.brushes.length === 0) {
    throw new Error('Brush maps require positive bounds and at least one brush.')
  }
  activeMap = map
  WORLD_MIN_X = map.bounds.min.x
  WORLD_MAX_X = map.bounds.max.x
  WORLD_MIN_Z = map.bounds.min.z
  WORLD_MAX_Z = map.bounds.max.z
  WORLD_WIDTH = width
  WORLD_HEIGHT = depth
  PLAYER_SPAWN = new THREE.Vector3(map.playerSpawn.x, map.playerSpawn.y, map.playerSpawn.z)
  ENEMY_SPAWNS = map.enemySpawns.map((spawn) => new THREE.Vector3(spawn.x, spawn.y, spawn.z))
}

configureMap(DEFAULT_MAP)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const horizontalLength = (vector: THREE.Vector3) => Math.hypot(vector.x, vector.z)

class VibeQuake {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(90, 1, 0.1, 200)
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  private readonly composer: EffectComposer
  private readonly usePostProcessing = import.meta.env.VITE_ENABLE_POSTFX === 'true'
  private readonly clock = new THREE.Clock()
  private readonly textureManager = new TextureManager()
  private readonly keys = new Set<string>()
  private readonly player = new THREE.Vector3(-5.5, 1.6, 5.5)
  private readonly velocity = new THREE.Vector3()
  private readonly moveWish = new THREE.Vector3()
  private readonly impacts: Impact[] = []
  private readonly projectiles: Projectile[] = []
  private readonly enemyBolts: EnemyBolt[] = []
  private readonly enemies: Enemy[] = []
  private readonly hitables: THREE.Object3D[] = []
  private readonly raycaster = new THREE.Raycaster()
  private readonly container: HTMLDivElement
  private readonly hud: HudRefs
  private readonly enemyVisualAssets: EnemyVisualAssets
  private readonly minimapContext: CanvasRenderingContext2D
  private readonly wallBoxes: THREE.Mesh[] = []
  private readonly ricochetSurfaces: THREE.Object3D[] = []
  private readonly solidVolumes: SolidVolume[] = []
  private readonly brushMeshes: Array<{ mesh: THREE.Object3D; minY: number; maxY: number }> = []
  private readonly presentationMeshes: Array<{ mesh: THREE.Object3D; minY: number; maxY: number }> = []
  private readonly accentLights: THREE.PointLight[] = []
  private ambientLight: THREE.HemisphereLight | null = null
  private sunlight: THREE.DirectionalLight | null = null
  private ssaoPass: SSAOPass | null = null
  private bloomPass: UnrealBloomPass | null = null
  private readonly leftHand = new THREE.Group()
  private readonly weapon = new THREE.Group()
  private readonly muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 6, 6),
    new THREE.MeshBasicMaterial({ color: '#ffe39f', transparent: true, opacity: 0 }),
  )
  private readonly muzzleLight = new THREE.PointLight('#ffb55a', 0, 7, 2)
  private readonly flashlightGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 10),
    new THREE.MeshBasicMaterial({ color: '#fff2c4', transparent: true, opacity: 0.35 }),
  )
  private readonly flashlight = new THREE.SpotLight('#fff1c9', 110, 52, 0.62, 0.78, 1.2)
  private readonly flashlightCore = new THREE.SpotLight('#fff7d6', 42, 34, 0.28, 0.9, 1.5)
  private readonly flashlightTarget = new THREE.Object3D()
  private readonly aimDirection = new THREE.Vector3()
  private readonly enemyFireOrigin = new THREE.Vector3()
  private readonly enemyFireDirection = new THREE.Vector3()
  private readonly playerTarget = new THREE.Vector3()
  private readonly upAxis = new THREE.Vector3(0, 1, 0)
  private readonly cameraRight = new THREE.Vector3()
  private readonly cameraUp = new THREE.Vector3()
  private readonly enemyLoopPlayerFlat = new THREE.Vector3()
  private readonly enemyLoopEnemyFlat = new THREE.Vector3()
  private readonly enemyLoopOffsetToPlayer = new THREE.Vector3()
  private readonly enemyLoopToPlayer = new THREE.Vector3()
  private readonly enemyLoopStrafe = new THREE.Vector3()
  private readonly enemyLoopDesired = new THREE.Vector3()
  private readonly enemyLoopNext = new THREE.Vector3()
  private readonly projectileQuaternion = new THREE.Quaternion()
  private readonly enemyArchetypes: EnemyArchetype[] = ENEMY_ARCHETYPE_PRESETS.map((preset) => ({
    ...preset,
    coreMaterial: new THREE.MeshStandardMaterial({
      color: preset.coreColor,
      emissive: preset.emissiveColor,
      emissiveIntensity: 1.8,
      metalness: 0.25,
      roughness: 0.35,
    }),
    ringMaterial: new THREE.MeshStandardMaterial({
      color: '#161d30',
      emissive: preset.ringColor,
      emissiveIntensity: 1.4,
      metalness: 0.4,
      roughness: 0.28,
    }),
  }))
  private readonly enemyDownMaterial = new THREE.MeshStandardMaterial({
    color: '#26131c',
    emissive: '#ff4d82',
    emissiveIntensity: 0.6,
    metalness: 0.05,
    roughness: 0.9,
  })
  private readonly floorLevel = 1.6
  private readonly playerRadius = 0.3
  private readonly playerBodyHeight = 1.8
  private readonly maxAutoStepHeight = 0.6
  private worldCeiling = Math.max(DEFAULT_MAP.bounds.max.y + 0.8, 4.8)
  private animationId = 0
  private yaw = 0
  private pitch = 0
  private grounded = false
  private wantsJump = false
  private canShootAt = 0
  private triggerHeld = false
  private flashTimer = 0
  private bobTime = 0
  private weaponKick = 0
  private viewKickPitch = 0
  private viewKickRoll = 0
  private landingImpact = 0
  private healthValue = 100
  private scoreValue = 0
  private damagePulse = 0
  private fpsAccumulator = 0
  private fpsFrames = 0
  private fpsValue = 0
  private disposed = false
  private structureViewMode: 'full' | 'layout' = 'full'
  private globalIlluminationEnabled = false
  private readonly movementSpeedScale = 0.82
  private flyModeEnabled = false
  private lastSpaceTapAt = -10
  private detailLevel: 'full' | 'major' | 'structure' = 'full'
  private gameOverActive = false
  private weaponUpgradeTier = 0
  private networkClient: NetworkClient | null = null
  private worldDirectory: GameWorldSummary[] = []
  private previewRoomState: RoomState | null = null
  private currentRoomState: RoomState | null = null
  private myPlayerId: string | null = null
  private hasRequestedWorldJoin = false
  private remotePlayers = new Map<string, RemotePlayerVisual>()
  private readonly useAvatarSystemV2 = import.meta.env.VITE_FEATURE_AVATAR_SYSTEM_V2 === 'true'
  private readonly useInputMapV2 = import.meta.env.VITE_FEATURE_INPUT_MAP_V2 === 'true'
  private readonly avatarSystem = new AvatarSystem({
    scene: this.scene,
    getAvatarBaseY: (playerEyeY) => this.getRemoteAvatarBaseY(playerEyeY),
  })
  private readonly hitCounterSystem: HitCounterSystem
  private readonly weaponPickupSystem = new WeaponPickupSystem()
  private lastInputSentAt = 0
  private inputSendInterval = 50 // Send input updates every 50ms
  private readonly cheatsEnabled = !import.meta.env.PROD
  private godModeEnabled = false
  private readonly minimapPlayerPalette = ['#66b8ff', '#ff7aa8', '#7dffb0', '#ffd26c']
  private readonly useServerReconTelemetry = import.meta.env.VITE_FEATURE_SERVER_RECON_V2 === 'true'
  private reconSamples = 0
  private reconPosErrorAccum = 0
  private reconMaxPosError = 0
  private reconYawErrorAccum = 0
  private reconMaxYawError = 0
  private reconLastAckGap = 0
  private reconLastOneWayMs = 0
  private reconLastServerTick = 0
  private reconLastLogAt = 0
  private readonly inputHistorySystem = new InputHistorySystem()
  private reconShadowSamples = 0
  private reconShadowPosErrorAccum = 0
  private reconShadowMaxPosError = 0
  private reconShadowYawErrorAccum = 0
  private reconShadowMaxYawError = 0

  constructor(container: HTMLDivElement, hud: HudRefs, enemyVisualAssets: EnemyVisualAssets) {
    this.container = container
    this.hud = hud
    this.enemyVisualAssets = enemyVisualAssets
    this.hitCounterSystem = new HitCounterSystem(hud.hitCounter)
    const minimapContext = this.hud.minimap.getContext('2d')
    if (!minimapContext) {
      throw new Error('Minimap failed to initialize')
    }
    this.minimapContext = minimapContext
    this.worldCeiling = Math.max(activeMap.bounds.max.y + 0.8, 4.8)
    // Raw .map files need heavy filtering; .bsp files are pre-optimized
    this.detailLevel = activeMap.sourceFormat === 'quake-map' ? 'structure' : 'full'

    this.scene.background = new THREE.Color('#050510')
    this.scene.fog = new THREE.Fog('#010101', 8, 44)

    this.camera.rotation.order = 'YXZ'
    this.scene.add(this.camera)

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.VSMShadowMap
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 0.8
    // Guarantee we never stack multiple canvases in the same render host.
    this.container.querySelectorAll('canvas').forEach((node) => node.remove())
    this.container.appendChild(this.renderer.domElement)

    // Setup post-processing
    this.composer = new EffectComposer(this.renderer)
    
    // Main render pass
    const renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(renderPass)

    // SSAO (Screen Space Ambient Occlusion) for depth and realism
    const ssaoPass = new SSAOPass(this.scene, this.camera, window.innerWidth, window.innerHeight)
    ssaoPass.kernelRadius = 24
    ssaoPass.minDistance = 0.0005
    ssaoPass.maxDistance = 0.12
    ssaoPass.output = SSAOPass.OUTPUT.Default
    // Prevent double-edge ghosting artifacts on some GPU/driver combos.
    ssaoPass.enabled = false
    this.ssaoPass = ssaoPass
    this.composer.addPass(ssaoPass)

    // Bloom for emissive materials and lights
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.35, // strength - subtle glow
      0.4,  // radius
      0.7   // threshold - only brightest emissive materials
    )
    this.bloomPass = bloomPass
    this.composer.addPass(bloomPass)

    // Output pass for proper color space
    const outputPass = new OutputPass()
    this.composer.addPass(outputPass)

    this.buildWorld()
    this.player.copy(this.resolveOpenSpawn(PLAYER_SPAWN, PLAYER_SPAWN.y))
    this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 1.3) + this.floorLevel
    this.camera.position.copy(this.player)
    this.buildWeapon()
    this.spawnEnemies()
    this.bindEvents()
    this.syncHud()
    this.initializeMultiplayer()
    this.onResize()
    this.loop()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.animationId)
    this.unbindEvents()
    this.networkClient?.disconnect()
    this.networkClient = null
    this.hitCounterSystem.dispose()
    this.weaponPickupSystem.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }

  private bindEvents() {
    window.addEventListener('resize', this.onResize)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mouseup', this.onMouseUp)
    document.addEventListener('pointerlockchange', this.onPointerLockChange)
    this.hud.startButton.addEventListener('click', this.requestPointerLock)
    this.hud.respawnButton.addEventListener('click', this.handleRespawn)
    this.hud.mainMenuButton.addEventListener('click', this.handleMainMenu)
    this.renderer.domElement.addEventListener('click', this.onRendererClick)
  }

  private unbindEvents() {
    window.removeEventListener('resize', this.onResize)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mouseup', this.onMouseUp)
    document.removeEventListener('pointerlockchange', this.onPointerLockChange)
    this.hud.startButton.removeEventListener('click', this.requestPointerLock)
    this.hud.respawnButton.removeEventListener('click', this.handleRespawn)
    this.hud.mainMenuButton.removeEventListener('click', this.handleMainMenu)
    this.renderer.domElement.removeEventListener('click', this.onRendererClick)
  }

  private readonly onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    if (this.usePostProcessing) {
      this.composer.setSize(window.innerWidth, window.innerHeight)
    }
  }

  private readonly onRendererClick = () => {
    if (this.hud.intro.dataset.hidden === 'true') {
      this.requestPointerLock()
    }
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    const mappedCommand = this.useInputMapV2 ? resolveDevCommand(event.code) : null
    if (
      event.repeat
      && (
        mappedCommand === 'toggleLighting'
        || mappedCommand === 'toggleViewMode'
        || mappedCommand === 'toggleDetailLevel'
        || event.code === 'KeyG'
        || event.code === 'KeyV'
        || event.code === 'KeyL'
      )
    ) {
      return
    }

    if ((this.useInputMapV2 && mappedCommand === 'toggleDetailLevel') || event.code === 'KeyL') {
      this.cycleDetailLevel()
      return
    }
    if ((this.useInputMapV2 && mappedCommand === 'toggleLighting') || event.code === 'KeyG') {
      this.toggleGlobalIlluminationMode()
      return
    }
    if (this.cheatsEnabled && ((this.useInputMapV2 && mappedCommand === 'toggleViewMode') || event.code === 'KeyV')) {
      this.toggleStructureViewMode()
      return
    }
    if ((this.useInputMapV2 && mappedCommand === 'toggleGodMode') || event.code === 'F10' || event.code === 'Backquote') {
      event.preventDefault()
      this.toggleGodMode()
      return
    }
    if (matchesGameActionCode(event.code, 'jump', this.useInputMapV2)) {
      if (event.repeat) {
        return
      }
      const now = performance.now() * 0.001
      const isDoubleTap = now - this.lastSpaceTapAt <= 0.3
      this.lastSpaceTapAt = now
      this.keys.add(event.code)
      if (isDoubleTap) {
        this.flyModeEnabled = !this.flyModeEnabled
        this.velocity.y = 0
        this.wantsJump = false
        this.hud.status.textContent = this.flyModeEnabled
          ? 'Flight enabled. Space up, Shift down. Double-tap Space to disable.'
          : 'Flight disabled. Double-tap Space to enable again.'
        return
      }
      if (!this.flyModeEnabled) {
        this.wantsJump = true
      }
      return
    }

    this.keys.add(event.code)
  }

  private cycleDetailLevel() {
      const levels: Array<'full' | 'major' | 'structure'> = ['structure', 'major', 'full']
      const currentIndex = levels.indexOf(this.detailLevel)
      this.detailLevel = levels[(currentIndex + 1) % levels.length]
      this.rebuildWorld()
      const descriptions = {
        structure: 'Structure only (faces ≥1.0 area)',
        major: 'Major surfaces (faces ≥0.1 area)',
        full: 'Full detail (all faces)',
      }
      this.hud.status.textContent = `Detail level: ${descriptions[this.detailLevel]}. Press L to cycle.`
  }

  private toggleGlobalIlluminationMode() {
    this.globalIlluminationEnabled = !this.globalIlluminationEnabled
    this.applyGlobalIllumination()
    this.hud.status.textContent = this.globalIlluminationEnabled
      ? 'Global illumination ON (full visibility). Press G for cinematic lighting.'
      : 'Cinematic lighting ON. Press G for full visibility.'
  }

  private toggleStructureViewMode() {
    if (!this.cheatsEnabled) {
      this.structureViewMode = 'full'
      this.applyStructureViewMode()
      return
    }

    this.structureViewMode = this.structureViewMode === 'full' ? 'layout' : 'full'
    this.applyStructureViewMode()
    this.hud.status.textContent = this.structureViewMode === 'layout'
      ? 'Layout view active. Press V for full geometry.'
      : 'Full geometry view active. Press V for layout view.'
  }

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
  }

  private toggleGodMode() {
    if (!this.cheatsEnabled) {
      return
    }
    this.godModeEnabled = !this.godModeEnabled
    if (this.godModeEnabled) {
      this.healthValue = 100
      this.gameOverActive = false
    }
    if (this.networkClient?.isConnected()) {
      this.networkClient.sendInvulnerable(this.godModeEnabled)
    }
    this.hud.status.textContent = this.godModeEnabled
      ? 'DEV cheat: godmode enabled.'
      : 'DEV cheat: godmode disabled.'
  }

  private getRemoteAvatarBaseY(playerEyeY: number) {
    // Networked player Y is camera/eye height; this avatar's lowest point sits at local y=0.15.
    return playerEyeY - (this.floorLevel + 0.15)
  }

  private hasRemotePlayer(playerId: string) {
    return this.useAvatarSystemV2
      ? this.avatarSystem.hasRemotePlayer(playerId)
      : this.remotePlayers.has(playerId)
  }

  private getRemotePlayer(playerId: string) {
    return this.useAvatarSystemV2
      ? this.avatarSystem.getRemotePlayer(playerId)
      : this.remotePlayers.get(playerId)
  }

  private getRemotePlayerIds() {
    return this.useAvatarSystemV2
      ? this.avatarSystem.getRemotePlayerIds()
      : this.remotePlayers.keys()
  }

  private getRemotePlayers() {
    return this.useAvatarSystemV2
      ? this.avatarSystem.getRemotePlayers()
      : this.remotePlayers.values()
  }

  private readonly onMouseMove = (event: MouseEvent) => {
    if (document.pointerLockElement !== this.renderer.domElement) {
      return
    }
    this.yaw -= event.movementX * 0.0024
    this.pitch = clamp(this.pitch - event.movementY * 0.0021, -1.35, 1.35)
  }

  private readonly onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || document.pointerLockElement !== this.renderer.domElement) {
      return
    }
    this.triggerHeld = true
    this.shoot()
  }

  private readonly onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) {
      this.triggerHeld = false
    }
  }

  private readonly onPointerLockChange = () => {
    const locked = document.pointerLockElement === this.renderer.domElement
    if (!locked) {
      this.triggerHeld = false
    }
    this.hud.shell.classList.toggle('playing', locked && !this.gameOverActive)
    if (this.gameOverActive) {
      this.hud.intro.dataset.hidden = 'true'
      return
    }
    this.hud.intro.dataset.hidden = locked ? 'true' : 'false'
    this.hud.status.textContent = locked
      ? 'Arena live. Strafe, hop, and keep your speed.'
      : 'Pointer lock released. Click engage or the viewport to jump back in.'
  }

  private readonly requestPointerLock = () => {
    if (this.gameOverActive) {
      return
    }
    this.requestWorldJoinIfNeeded()
    if (document.pointerLockElement !== this.renderer.domElement) {
      this.renderer.domElement.requestPointerLock()
    }
  }

  private rebuildWorld() {
    // Remove all brush-related geometry from the scene
    for (const { mesh } of this.brushMeshes) {
      this.scene.remove(mesh)
      if (mesh instanceof THREE.Group) {
        mesh.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose()
            if (Array.isArray(child.material)) {
              child.material.forEach((m) => m.dispose())
            } else if (child.material) {
              child.material.dispose()
            }
          }
        })
      } else if (mesh instanceof THREE.Mesh) {
        mesh.geometry?.dispose()
      }
    }

    // Clear brush-related arrays but preserve non-brush ricochet surfaces (fallback floor, ceiling)
    const brushMeshSet = new Set(this.brushMeshes.map((entry) => entry.mesh))
    const brushFaceMeshes = new Set<THREE.Object3D>()
    for (const { mesh } of this.brushMeshes) {
      if (mesh instanceof THREE.Group) {
        mesh.children.forEach((child) => brushFaceMeshes.add(child))
      }
    }
    // Remove brush-related surfaces from ricochetSurfaces by filtering in-place
    for (let i = this.ricochetSurfaces.length - 1; i >= 0; i -= 1) {
      const surface = this.ricochetSurfaces[i]
      if (brushMeshSet.has(surface) || brushFaceMeshes.has(surface)) {
        this.ricochetSurfaces.splice(i, 1)
      }
    }
    this.brushMeshes.length = 0
    this.wallBoxes.length = 0
    this.solidVolumes.length = 0

    // Rebuild brush geometry with current detail level
    const worldVariant = resolveWorldVariant(activeMap)
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture(worldVariant),
      roughness: worldVariant === 'cavern' ? 0.86 : worldVariant === 'abyssal' ? 0.6 : worldVariant === 'abyssal-hd' ? 0.52 : worldVariant === 'industrial' ? 0.74 : 0.4,
      metalness: worldVariant === 'cavern' ? 0.08 : worldVariant === 'abyssal' ? 0.18 : worldVariant === 'abyssal-hd' ? 0.24 : worldVariant === 'industrial' ? 0.42 : 0.6,
      emissive: worldVariant === 'cavern' ? '#140e0b' : worldVariant === 'abyssal' ? '#0b242b' : worldVariant === 'abyssal-hd' ? '#0e3138' : worldVariant === 'industrial' ? '#4a3427' : '#1a0a28',
      emissiveIntensity: worldVariant === 'cavern' ? 0.18 : worldVariant === 'abyssal' ? 0.26 : worldVariant === 'abyssal-hd' ? 0.3 : worldVariant === 'industrial' ? 0.24 : 0.3,
    })
    for (const brush of activeMap.brushes) {
      const material = brush.texture || wallMaterial
      this.addSolidBrush(brush, material)
    }
  }

  private buildIndustrialRustPresentation() {
    buildIndustrialRustPresentationSystem({
      brushes: activeMap.brushes,
      worldCeiling: this.worldCeiling,
      worldMinX: WORLD_MIN_X,
      worldMaxX: WORLD_MAX_X,
      worldMinZ: WORLD_MIN_Z,
      worldMaxZ: WORLD_MAX_Z,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      addPresentationMesh: (mesh, minY, maxY) => this.addPresentationMesh(mesh, minY, maxY),
    })
  }

  private buildWorld() {
    const visualTheme = resolveVisualTheme(activeMap)
    const isDarkCaverns = activeMap.id === 'dark-caverns'
    const isAbyssalGrotto = activeMap.id === 'abyssal-grotto'
    const isAbyssalGrottoPrime = activeMap.id === 'abyssal-grotto-prime'
    const isIndustrialRust = visualTheme === 'industrial-rust'
    const isCavernFamily = isDarkCaverns || isAbyssalGrotto || isAbyssalGrottoPrime
    const worldVariant = resolveWorldVariant(activeMap)
    const centerX = (WORLD_MIN_X + WORLD_MAX_X) * 0.5
    const centerZ = (WORLD_MIN_Z + WORLD_MAX_Z) * 0.5
    this.scene.background = new THREE.Color(isAbyssalGrottoPrime ? '#021115' : isAbyssalGrotto ? '#020709' : isDarkCaverns ? '#070503' : isIndustrialRust ? '#100b08' : '#050510')
    this.scene.fog = new THREE.Fog(isAbyssalGrottoPrime ? '#05232b' : isAbyssalGrotto ? '#041115' : isDarkCaverns ? '#080604' : isIndustrialRust ? '#140d0a' : '#010101', 6, isAbyssalGrottoPrime ? 28 : isAbyssalGrotto ? 30 : isDarkCaverns ? 34 : isIndustrialRust ? 40 : 44)

    // Enhanced ambient lighting for better texture visibility
    this.ambientLight = isAbyssalGrottoPrime
      ? new THREE.HemisphereLight('#24505a', '#081b20', 0.35)
      : isAbyssalGrotto
      ? new THREE.HemisphereLight('#1b3238', '#071217', 0.32)
      : isDarkCaverns
      ? new THREE.HemisphereLight('#2a241e', '#0f0907', 0.3)
      : isIndustrialRust
      ? new THREE.HemisphereLight('#584338', '#16100d', 0.34)
      : new THREE.HemisphereLight('#4a5570', '#1a1520', 0.4)
    this.scene.add(this.ambientLight)

    // Add directional light for shadows and depth
    this.sunlight = new THREE.DirectionalLight(isAbyssalGrottoPrime ? '#c7f7ff' : isAbyssalGrotto ? '#b8f2ff' : isDarkCaverns ? '#ffd9b1' : isIndustrialRust ? '#ffd3a5' : '#ffffff', isAbyssalGrottoPrime ? 0.5 : isAbyssalGrotto ? 0.42 : isDarkCaverns ? 0.46 : isIndustrialRust ? 0.62 : 0.8)
    this.sunlight.position.set(isAbyssalGrottoPrime ? 5 : isAbyssalGrotto ? 6 : isDarkCaverns ? -8 : isIndustrialRust ? -10 : 12, isAbyssalGrottoPrime ? 15 : isAbyssalGrotto ? 13 : isDarkCaverns ? 14 : isIndustrialRust ? 16 : 18, isAbyssalGrottoPrime ? -9 : isAbyssalGrotto ? -12 : isDarkCaverns ? -10 : isIndustrialRust ? 11 : 8)
    this.sunlight.castShadow = true
    this.sunlight.shadow.mapSize.width = 4096
    this.sunlight.shadow.mapSize.height = 4096
    this.sunlight.shadow.camera.near = 0.5
    this.sunlight.shadow.camera.far = 60
    this.sunlight.shadow.camera.left = -30
    this.sunlight.shadow.camera.right = 30
    this.sunlight.shadow.camera.top = 30
    this.sunlight.shadow.camera.bottom = -30
    this.sunlight.shadow.bias = -0.00005
    this.sunlight.shadow.normalBias = 0.02
    this.scene.add(this.sunlight)

    // Add colored accent lights for atmosphere
    const accentLight1 = new THREE.PointLight(isAbyssalGrottoPrime ? '#84f4ff' : isAbyssalGrotto ? '#6fe6f3' : isDarkCaverns ? '#ffb56b' : isIndustrialRust ? '#ff8b4d' : '#00ffff', isAbyssalGrottoPrime ? 1.35 : isAbyssalGrotto ? 1.1 : isDarkCaverns ? 0.8 : isIndustrialRust ? 0.9 : 1.2, isAbyssalGrottoPrime ? 32 : isAbyssalGrotto ? 28 : isDarkCaverns ? 26 : isIndustrialRust ? 24 : 35, 2)
    accentLight1.position.set(centerX - WORLD_WIDTH * 0.3, isAbyssalGrottoPrime ? 3.1 : isAbyssalGrotto ? 2.6 : isDarkCaverns ? 3.8 : isIndustrialRust ? 5.2 : 6, centerZ - WORLD_HEIGHT * 0.3)
    accentLight1.castShadow = false
    this.accentLights.push(accentLight1)
    this.scene.add(accentLight1)

    const accentLight2 = new THREE.PointLight(isAbyssalGrottoPrime ? '#a5ddff' : isAbyssalGrotto ? '#9ec8ff' : isDarkCaverns ? '#7ea2bd' : isIndustrialRust ? '#d86b3a' : '#ff00aa', isAbyssalGrottoPrime ? 1.25 : isAbyssalGrotto ? 1.0 : isDarkCaverns ? 0.7 : isIndustrialRust ? 0.75 : 1.2, isAbyssalGrottoPrime ? 30 : isAbyssalGrotto ? 26 : isDarkCaverns ? 24 : isIndustrialRust ? 20 : 35, 2)
    accentLight2.position.set(centerX + WORLD_WIDTH * 0.3, isAbyssalGrottoPrime ? 3.4 : isAbyssalGrotto ? 2.9 : isDarkCaverns ? 4.2 : isIndustrialRust ? 4.6 : 6, centerZ + WORLD_HEIGHT * 0.3)
    accentLight2.castShadow = false
    this.accentLights.push(accentLight2)
    this.scene.add(accentLight2)

    const accentLight3 = new THREE.PointLight(isAbyssalGrottoPrime ? '#9dffff' : isAbyssalGrotto ? '#89f3ff' : isDarkCaverns ? '#c47f53' : isIndustrialRust ? '#ffb36f' : '#6600ff', isAbyssalGrottoPrime ? 1.2 : isAbyssalGrotto ? 0.95 : isDarkCaverns ? 0.55 : isIndustrialRust ? 0.45 : 0.9, isAbyssalGrottoPrime ? 24 : isAbyssalGrotto ? 20 : isDarkCaverns ? 18 : isIndustrialRust ? 18 : 30, 2)
    accentLight3.position.set(centerX, isAbyssalGrottoPrime ? 2.2 : isAbyssalGrotto ? 1.7 : isDarkCaverns ? 2.8 : isIndustrialRust ? 7.2 : 8, centerZ)
    accentLight3.castShadow = false
    this.accentLights.push(accentLight3)
    this.scene.add(accentLight3)

    // Keep a gameplay floor fallback so sparse map geometry does not create visual/collision holes.
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH + CELL_SIZE * 4, WORLD_HEIGHT + CELL_SIZE * 4),
      new THREE.MeshStandardMaterial({
        color: isAbyssalGrottoPrime ? '#082328' : isAbyssalGrotto ? '#0a1a1f' : isDarkCaverns ? '#17110d' : '#0d1626',
        emissive: isAbyssalGrottoPrime ? '#0f3c44' : isAbyssalGrotto ? '#0b2228' : isDarkCaverns ? '#0f0905' : isIndustrialRust ? '#2a170f' : '#032033',
        emissiveIntensity: isAbyssalGrottoPrime ? 0.2 : isAbyssalGrotto ? 0.14 : isDarkCaverns ? 0.06 : isIndustrialRust ? 0.08 : 0.12,
        roughness: isAbyssalGrottoPrime ? 0.36 : isAbyssalGrotto ? 0.55 : isDarkCaverns ? 0.94 : isIndustrialRust ? 0.86 : 0.7,
        metalness: isAbyssalGrottoPrime ? 0.24 : isAbyssalGrotto ? 0.12 : isDarkCaverns ? 0.04 : isIndustrialRust ? 0.14 : 0.25,
      }),
    )
    fallbackFloor.rotation.x = -Math.PI / 2
    fallbackFloor.position.set(centerX, 0, centerZ)
    fallbackFloor.receiveShadow = true
    this.scene.add(fallbackFloor)
    this.ricochetSurfaces.push(fallbackFloor)

    // Floor is now rendered from imported brush geometry instead of a full-plane fallback.

    const ceilingMap = ceilingTexture(worldVariant)
    ceilingMap.repeat.set(WORLD_WIDTH / 2.2, WORLD_HEIGHT / 2.2)
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH + CELL_SIZE * 4, WORLD_HEIGHT + CELL_SIZE * 4),
      new THREE.MeshStandardMaterial({
        map: ceilingMap,
        roughness: isAbyssalGrottoPrime ? 0.45 : isAbyssalGrotto ? 0.62 : isDarkCaverns ? 0.9 : isIndustrialRust ? 0.78 : 0.5,
        metalness: isAbyssalGrottoPrime ? 0.28 : isAbyssalGrotto ? 0.2 : isDarkCaverns ? 0.1 : isIndustrialRust ? 0.34 : 0.5,
        emissive: isAbyssalGrottoPrime ? '#10525e' : isAbyssalGrotto ? '#0d2f36' : isDarkCaverns ? '#17110f' : isIndustrialRust ? '#2a160e' : '#0f051a',
        emissiveIntensity: isAbyssalGrottoPrime ? 0.28 : isAbyssalGrotto ? 0.22 : isDarkCaverns ? 0.11 : isIndustrialRust ? 0.14 : 0.25,
      }),
    )
    ceiling.position.y = this.worldCeiling
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(centerX, this.worldCeiling, centerZ)
    this.scene.add(ceiling)
    this.ricochetSurfaces.push(ceiling)

    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture(worldVariant),
      roughness: isAbyssalGrottoPrime ? 0.5 : isAbyssalGrotto ? 0.6 : isDarkCaverns ? 0.86 : isIndustrialRust ? 0.72 : 0.4,
      metalness: isAbyssalGrottoPrime ? 0.28 : isAbyssalGrotto ? 0.18 : isDarkCaverns ? 0.08 : isIndustrialRust ? 0.44 : 0.6,
      emissive: isAbyssalGrottoPrime ? '#114952' : isAbyssalGrotto ? '#0b242b' : isDarkCaverns ? '#140e0b' : isIndustrialRust ? '#4a3427' : '#1a0a28',
      emissiveIntensity: isAbyssalGrottoPrime ? 0.34 : isAbyssalGrotto ? 0.26 : isDarkCaverns ? 0.18 : isIndustrialRust ? 0.24 : 0.3,
    })
    for (const brush of activeMap.brushes) {
      // Use brush texture if available, otherwise fallback to wall material.
      const material = brush.texture || wallMaterial
      this.addSolidBrush(brush, material)
    }

    // Intentionally no synthetic center-floor ornaments; visible floor should match map geometry.
    // Imported Quake maps get no extra decorative set-dressing so their structure stays legible.
    const isQuakeFormat = activeMap.sourceFormat === 'quake-map' || activeMap.sourceFormat === 'quake-bsp'
    if (!isQuakeFormat) {
      if (isCavernFamily) {
        buildCavernDecoration({
          scene: this.scene,
          worldCeiling: this.worldCeiling,
          worldMinX: WORLD_MIN_X,
          worldMaxX: WORLD_MAX_X,
          worldMinZ: WORLD_MIN_Z,
          worldMaxZ: WORLD_MAX_Z,
          isAbyssalGrotto,
          isAbyssalGrottoPrime,
        })
      } else if (isIndustrialRust) {
      if (activeMap.id !== 'iron-cathedral') {
        this.buildIndustrialRustPresentation()
      }
      } else {
        buildNeonTechDecoration({
          scene: this.scene,
          worldCeiling: this.worldCeiling,
          worldMinX: WORLD_MIN_X,
          worldMaxX: WORLD_MAX_X,
          worldMinZ: WORLD_MIN_Z,
          worldMaxZ: WORLD_MAX_Z,
          worldWidth: WORLD_WIDTH,
          worldHeight: WORLD_HEIGHT,
        })
      }
    }

    this.applyStructureViewMode()
    this.applyGlobalIllumination()
    this.weaponPickupSystem.spawn(this.scene, activeMap, this.floorLevel, (pos, y, padding) => this.resolveOpenSpawn(pos, y, padding))
  }

  private applyGlobalIllumination() {
    this.hud.shell.classList.toggle('gi-fullbright', this.globalIlluminationEnabled)
    const isIndustrialRust = resolveVisualTheme(activeMap) === 'industrial-rust'
    
    // Hide entire left hand (flashlight + hand geometry) in daylight mode
    if (this.leftHand) {
      this.leftHand.visible = !this.globalIlluminationEnabled
    }
    
    if (this.globalIlluminationEnabled) {
      // Inspection mode: remove darkening effects and flood scene with light.
      if (this.ssaoPass) {
        this.ssaoPass.enabled = false
      }
      if (this.bloomPass) {
        this.bloomPass.enabled = false
      }
      this.scene.fog = null
      this.renderer.toneMappingExposure = 1.4
    } else {
      if (this.ssaoPass) {
        // Disabled until a less artifact-prone AO setup is added.
        this.ssaoPass.enabled = false
      }
      if (this.bloomPass) {
        this.bloomPass.enabled = true
        this.bloomPass.strength = 0.35
      }
      const fogColor = activeMap.id === 'abyssal-grotto-prime' ? '#05232b' : activeMap.id === 'abyssal-grotto' ? '#041115' : activeMap.id === 'dark-caverns' ? '#080604' : isIndustrialRust ? '#24150e' : '#010101'
      const fogFar = activeMap.id === 'abyssal-grotto-prime' ? 28 : activeMap.id === 'abyssal-grotto' ? 30 : activeMap.id === 'dark-caverns' ? 34 : isIndustrialRust ? 48 : 44
      this.scene.fog = new THREE.Fog(fogColor, 8, fogFar)
      this.renderer.toneMappingExposure = isIndustrialRust ? 0.82 : 0.7
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = this.globalIlluminationEnabled ? (isIndustrialRust ? 1.4 : 1.25) : (isIndustrialRust ? 0.42 : 0.28)
    }
    if (this.sunlight) {
      this.sunlight.intensity = this.globalIlluminationEnabled ? (isIndustrialRust ? 2.05 : 1.8) : (isIndustrialRust ? 0.8 : 0.55)
      this.sunlight.castShadow = !this.globalIlluminationEnabled
    }
    const accentIntensity = this.globalIlluminationEnabled
      ? (isIndustrialRust ? [0.42, 0.36, 0.3] : [0.25, 0.25, 0.2])
      : (isIndustrialRust ? [1.15, 1.0, 0.82] : [0.8, 0.8, 0.6])
    for (const [index, light] of this.accentLights.entries()) {
      light.intensity = accentIntensity[index] ?? accentIntensity[accentIntensity.length - 1]
    }
  }

  private applyStructureViewMode() {
    if (this.structureViewMode === 'full') {
      for (const brush of this.brushMeshes) {
        brush.mesh.visible = true
      }
      for (const decorative of this.presentationMeshes) {
        decorative.mesh.visible = true
      }
      return
    }

    // Slice around player walkable height to make floor-plan structure readable.
    const sliceMinY = this.floorLevel - 0.3
    const sliceMaxY = this.floorLevel + 2.6
    for (const brush of this.brushMeshes) {
      brush.mesh.visible = brush.maxY >= sliceMinY && brush.minY <= sliceMaxY
    }
    for (const decorative of this.presentationMeshes) {
      decorative.mesh.visible = decorative.maxY >= sliceMinY && decorative.minY <= sliceMaxY
    }
  }

  private addPresentationMesh(mesh: THREE.Object3D, minY: number, maxY: number) {
    this.scene.add(mesh)
    this.presentationMeshes.push({ mesh, minY, maxY })
  }

  private addSolidBrush(brush: ArenaMap['brushes'][number], material: THREE.Material | string) {
    addSolidBrushToScene({
      brush,
      material,
      textureManager: this.textureManager,
      detailLevel: this.detailLevel,
      sourceFormat: activeMap.sourceFormat,
      context: {
        scene: this.scene,
        brushMeshes: this.brushMeshes,
        wallBoxes: this.wallBoxes,
        ricochetSurfaces: this.ricochetSurfaces,
        solidVolumes: this.solidVolumes,
      },
    })
  }


  private buildWeapon() {
    buildWeaponView({
      camera: this.camera,
      weapon: this.weapon,
      leftHand: this.leftHand,
      muzzleFlash: this.muzzleFlash,
      muzzleLight: this.muzzleLight,
      flashlightGlow: this.flashlightGlow,
      flashlight: this.flashlight,
      flashlightCore: this.flashlightCore,
      flashlightTarget: this.flashlightTarget,
      globalIlluminationEnabled: this.globalIlluminationEnabled,
    })
  }

  private spawnEnemies() {
    for (const [index, spawn] of ENEMY_SPAWNS.entries()) {
      const archetype = this.rollEnemyArchetype()
      const visualKind = pickEnemyVisualKind(archetype.name, this.enemyVisualAssets)
      const visualAsset = getEnemyVisualAsset(visualKind, this.enemyVisualAssets)
      const group = new THREE.Group()
      const core = new THREE.Mesh(
        new THREE.SphereGeometry(visualAsset ? 0.28 : 0.42, 12, 12),
        visualAsset
          ? new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
          : archetype.coreMaterial,
      )
      core.castShadow = true
      core.receiveShadow = true
      const hitbox = new THREE.Mesh(
        new THREE.SphereGeometry(0.95, 12, 12),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
      )
      core.position.y = getVisualBodyHeight(visualKind, Boolean(visualAsset))
      hitbox.position.y = getVisualBodyHeight(visualKind, Boolean(visualAsset)) + (visualAsset ? 0 : 0.04)

      let modelRoot: THREE.Object3D | null = null
      let mixer: THREE.AnimationMixer | null = null
      if (visualAsset) {
        modelRoot = cloneSkeleton(visualAsset.scene)
        group.add(modelRoot)
        if (visualAsset.animations.length > 0) {
          mixer = new THREE.AnimationMixer(modelRoot)
          mixer.clipAction(visualAsset.animations[0]).play()
        }
      }

      const rings = visualAsset
        ? []
        : Array.from({ length: 3 }, (_, ringIndex) => {
            const ring = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.05, 8, 24), archetype.ringMaterial)
            ring.castShadow = true
            ring.receiveShadow = true
            ring.rotation.x = Math.PI / 2
            ring.rotation.z = ringIndex * 0.42
            group.add(ring)
            return ring
          })
      group.add(core, hitbox)
      const spawnY = Math.max(this.floorLevel, spawn.y)
      group.position.copy(this.resolveOpenSpawn(spawn, spawnY, 0.9))
      const initialEnemyGround = this.getGroundHeightAt(group.position.x, group.position.z, group.position.y + 1.35)
      group.position.y = visualAsset ? initialEnemyGround : initialEnemyGround + 1.1
      this.scene.add(group)
      const enemy: Enemy = {
        id: `${activeMap.id}-enemy-${index}`,
        group,
        core,
        hitbox,
        rings,
        visualKind,
        modelRoot,
        mixer,
        angle: index,
        speed: archetype.speed + index * 0.04,
        bobOffset: index * 0.8,
        health: archetype.minHealth,
        maxHealth: archetype.minHealth,
        radius: archetype.radius,
        aimHeight: getVisualAimHeight(visualKind, archetype.scale),
        archetypeName: archetype.name,
        respawn: 0,
        canShootAt: Math.random() * 1.4,
      }
      this.configureEnemy(enemy, archetype)
      this.enemies.push(enemy)
      this.hitables.push(core)
      this.hitables.push(hitbox)
    }
  }

  private rollEnemyArchetype() {
    const totalWeight = this.enemyArchetypes.reduce((sum, archetype) => sum + archetype.weight, 0)
    let roll = Math.random() * totalWeight
    for (const archetype of this.enemyArchetypes) {
      roll -= archetype.weight
      if (roll <= 0) {
        return archetype
      }
    }
    return this.enemyArchetypes[this.enemyArchetypes.length - 1]
  }

  private rollEnemyHealth(archetype: EnemyArchetype) {
    return archetype.minHealth + Math.floor(Math.random() * (archetype.maxHealth - archetype.minHealth + 1))
  }

  private configureEnemy(enemy: Enemy, archetype: EnemyArchetype) {
    const health = this.rollEnemyHealth(archetype)
    const visualScaleMultiplier = getEnemyVisualScaleMultiplier(enemy.visualKind)
    const totalScale = archetype.scale * visualScaleMultiplier
    enemy.group.scale.setScalar(totalScale)
    if (enemy.visualKind === 'fallback') {
      enemy.core.material = archetype.coreMaterial
    }
    enemy.speed = archetype.speed
    enemy.radius = archetype.radius * visualScaleMultiplier
    enemy.aimHeight = getVisualAimHeight(enemy.visualKind, totalScale)
    enemy.health = health
    enemy.maxHealth = health
    enemy.archetypeName = archetype.name
    for (const [index, ring] of enemy.rings.entries()) {
      ring.material = archetype.ringMaterial
      ring.visible = index < archetype.ringCount
      ring.position.y = (index - (archetype.ringCount - 1) * 0.5) * 0.18
      ring.scale.setScalar(0.9 + index * 0.12 + archetype.scale * 0.08)
    }
  }

  private initializeMultiplayer() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const proxyUrl = `${protocol}//${window.location.host}/ws`
    const directBackendUrl = `${protocol}//${window.location.hostname}:3001/ws`
    const wsUrls = import.meta.env.DEV
      ? Array.from(new Set([proxyUrl, directBackendUrl]))
      : [proxyUrl]

    const callbacks: NetworkCallbacks = {
      onWelcome: (playerId, room) => {
        console.log('[Multiplayer] Joined as player', playerId)
        console.log('[Multiplayer] Room mapId:', room.mapId)
        console.log('[Multiplayer] Players in room:', Object.keys(room.players))
        this.myPlayerId = playerId
        this.currentRoomState = room
        
        // Use server-provided spawn position
        const myState = room.players[playerId]
        if (myState) {
          this.player.set(myState.position.x, myState.position.y, myState.position.z)
          this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 1.3) + this.floorLevel
          this.yaw = myState.yaw
          this.pitch = myState.pitch
          console.log('[Multiplayer] Spawned at', myState.position, 'facing yaw', myState.yaw)
        }
        
        this.handleRoomState(room)
        const playersOnline = Object.keys(room.players).length
        const roomLabel = room.roomId ?? room.mapId
        this.hud.status.textContent = `Multiplayer connected (${playersOnline} in ${roomLabel}).`
        if (this.cheatsEnabled && this.godModeEnabled) {
          this.networkClient?.sendInvulnerable(true)
        }
      },
      onWorldDirectory: (worlds) => {
        this.worldDirectory = worlds
        renderWorldDirectory(this.worldDirectory, this.hud.intro, activeMap.id)
      },
      onMapPreviewState: (room) => {
        this.previewRoomState = room
      },
      onPlayerJoined: (player) => {
        console.log('[Multiplayer] Player joined:', player.name)
        if (this.currentRoomState) {
          this.currentRoomState.players[player.id] = player
        }
        this.addRemotePlayer(player)
        this.hud.status.textContent = `${player.name} joined the room.`
      },
      onPlayerLeft: (playerId) => {
        console.log('[Multiplayer] Player left:', playerId)
        if (this.currentRoomState) {
          delete this.currentRoomState.players[playerId]
        }
        this.removeRemotePlayer(playerId)
        this.hud.status.textContent = 'A player left the room.'
      },
      onPlayerUpdate: (playerId, state) => {
        if (this.currentRoomState) {
          const current = this.currentRoomState.players[playerId]
          if (current) {
            this.currentRoomState.players[playerId] = { ...current, ...state }
          }
        }
        if (playerId === this.myPlayerId) {
          if (state.position !== undefined) {
            this.player.set(state.position.x, state.position.y, state.position.z)
            this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 1.3) + this.floorLevel
            console.log('[Multiplayer] Server updated position to', state.position)
          }
          if (state.yaw !== undefined) {
            this.yaw = state.yaw
          }
          if (state.pitch !== undefined) {
            this.pitch = state.pitch
          }
          if (state.health !== undefined) {
            this.healthValue = state.health
          }
          if (state.score !== undefined) {
            this.scoreValue = Math.max(this.scoreValue, state.score)
          }
          if (state.weaponTier !== undefined) {
            this.weaponUpgradeTier = Math.max(this.weaponUpgradeTier, state.weaponTier)
          }
          if (state.invulnerable !== undefined) {
            this.godModeEnabled = this.cheatsEnabled && state.invulnerable
          }
          if (state.isDead === true && !this.gameOverActive) {
            this.damagePlayer(999)
          }
          return
        }
        this.updateRemotePlayer(playerId, state)
      },
      onEnemyUpdate: (enemyId, state) => {
        // Find and update enemy
        const enemy = this.enemies.find((e) => e.id === enemyId)
        if (enemy && state.health !== undefined) {
          enemy.health = state.health
        }
      },
      onEnemySpawn: (enemyState) => {
        // Respawn enemy
        const enemy = this.enemies.find((e) => e.id === enemyState.id)
        if (enemy) {
          enemy.health = enemyState.maxHealth
          enemy.group.position.set(enemyState.position.x, enemyState.position.y, enemyState.position.z)
          enemy.group.visible = true
        }
      },
      onEnemyDied: (enemyId, killerId) => {
        const enemy = this.enemies.find((e) => e.id === enemyId)
        if (enemy) {
          enemy.health = 0
          enemy.group.visible = false
        }
        if (killerId === this.myPlayerId) {
          this.scoreValue += 1
        }
      },
      onProjectileSpawn: (projectile) => {
        // Spawn visual projectile from other players
        if (projectile.playerId !== this.myPlayerId) {
          spawnRemoteProjectileVisual(this.scene, projectile)
        }
      },
      onPickupCollected: (pickupId, playerId) => {
        if (this.currentRoomState?.pickups[pickupId]) {
          this.currentRoomState.pickups[pickupId].collected = true
        }
        this.weaponPickupSystem.markCollected(pickupId)
        // Update remote player's weapon tier
        const remotePlayer = this.getRemotePlayer(playerId)
        if (remotePlayer) {
          const tier = pickupId.includes('tier-2') ? 2 : 1
          remotePlayer.state.weaponTier = tier
        }
      },
      onStateSync: (room, metadata) => {
        this.captureReconciliationTelemetry(room, metadata)
        this.currentRoomState = room
        this.handleRoomState(room)
      },
    }

    this.networkClient = new NetworkClient(callbacks)
    this.networkClient.connect(wsUrls)
    this.networkClient.setMapPreview(activeMap.id)
    this.hud.status.textContent = 'Connected to lobby. Click Engage Arena to join a live world.'
  }

  private isMultiplayerJoined() {
    return this.networkClient?.isConnected() === true && this.myPlayerId !== null
  }

  private requestWorldJoinIfNeeded() {
    if (!this.networkClient?.isConnected() || this.hasRequestedWorldJoin || this.myPlayerId !== null) {
      return
    }
    const playerName = localStorage.getItem('playerName') || 'Player'
    const mapId = activeMap.id
    this.hasRequestedWorldJoin = true
    console.log('[Multiplayer] Joining room with mapId:', mapId, 'as', playerName)
    this.networkClient.join(playerName, mapId)
    this.hud.status.textContent = 'Joining world...'
  }

  private handleRoomState(room: RoomState) {
    this.currentRoomState = room
    const nextRemoteIds = new Set<string>()

    for (const [playerId, playerState] of Object.entries(room.players)) {
      if (playerId === this.myPlayerId) {
        this.weaponUpgradeTier = Math.max(this.weaponUpgradeTier, playerState.weaponTier)
        this.healthValue = playerState.health
        this.scoreValue = Math.max(this.scoreValue, playerState.score)
        this.godModeEnabled = this.cheatsEnabled && playerState.invulnerable
        continue
      }

      nextRemoteIds.add(playerId)
      if (this.hasRemotePlayer(playerId)) {
        this.updateRemotePlayer(playerId, playerState)
      } else {
        this.addRemotePlayer(playerState)
      }
    }

    for (const playerId of this.getRemotePlayerIds()) {
      if (!nextRemoteIds.has(playerId)) {
        this.removeRemotePlayer(playerId)
      }
    }

    for (const enemy of this.enemies) {
      const sharedEnemy = room.enemies[enemy.id]
      if (!sharedEnemy) {
        continue
      }
      enemy.maxHealth = sharedEnemy.maxHealth
      enemy.health = sharedEnemy.health
      enemy.group.position.set(sharedEnemy.position.x, sharedEnemy.position.y, sharedEnemy.position.z)
      enemy.group.visible = !sharedEnemy.isDead
    }

    this.weaponPickupSystem.syncFromRoom(room)
  }

  private captureReconciliationTelemetry(room: RoomState, metadata: Omit<StateSyncPayload, 'room'>) {
    if (!this.useServerReconTelemetry || !this.myPlayerId) {
      return
    }

    const authoritative = room.players[this.myPlayerId]
    if (!authoritative) {
      return
    }

    const dx = this.player.x - authoritative.position.x
    const dy = this.player.y - authoritative.position.y
    const dz = this.player.z - authoritative.position.z
    const positionError = Math.hypot(dx, dy, dz)
    const yawError = Math.abs(Math.atan2(Math.sin(this.yaw - authoritative.yaw), Math.cos(this.yaw - authoritative.yaw)))

    this.reconSamples += 1
    this.reconPosErrorAccum += positionError
    this.reconYawErrorAccum += yawError
    this.reconMaxPosError = Math.max(this.reconMaxPosError, positionError)
    this.reconMaxYawError = Math.max(this.reconMaxYawError, yawError)
    this.reconLastServerTick = Math.max(this.reconLastServerTick, metadata.serverTick ?? 0)

    const sentSeq = this.networkClient?.getLatestSentInputSeq() ?? 0
    const ackSeq = this.networkClient?.getLatestAckInputSeq() ?? 0
    this.reconLastAckGap = Math.max(0, sentSeq - ackSeq)
    this.reconLastOneWayMs = metadata.sentAt ? Math.max(0, Date.now() - metadata.sentAt) : 0

    const authoritativeSeq = metadata.latestInputSeqByPlayer?.[this.myPlayerId]
    if (typeof authoritativeSeq === 'number' && authoritativeSeq > 0) {
      const acknowledgedSample = this.inputHistorySystem.find(authoritativeSeq)
      if (acknowledgedSample) {
        const ackDx = acknowledgedSample.position.x - authoritative.position.x
        const ackDy = acknowledgedSample.position.y - authoritative.position.y
        const ackDz = acknowledgedSample.position.z - authoritative.position.z
        const shadowPosError = Math.hypot(ackDx, ackDy, ackDz)
        const shadowYawError = Math.abs(Math.atan2(
          Math.sin(acknowledgedSample.yaw - authoritative.yaw),
          Math.cos(acknowledgedSample.yaw - authoritative.yaw),
        ))

        this.reconShadowSamples += 1
        this.reconShadowPosErrorAccum += shadowPosError
        this.reconShadowYawErrorAccum += shadowYawError
        this.reconShadowMaxPosError = Math.max(this.reconShadowMaxPosError, shadowPosError)
        this.reconShadowMaxYawError = Math.max(this.reconShadowMaxYawError, shadowYawError)
      }

      // Keep a trailing window around the latest acknowledged sequence.
      this.inputHistorySystem.prune(authoritativeSeq - 32)
    }

    const now = performance.now()
    if (now - this.reconLastLogAt < 1000) {
      return
    }

    this.reconLastLogAt = now
    const avgPosError = this.reconPosErrorAccum / Math.max(1, this.reconSamples)
    const avgYawErrorDeg = (this.reconYawErrorAccum / Math.max(1, this.reconSamples)) * (180 / Math.PI)
    const maxYawErrorDeg = this.reconMaxYawError * (180 / Math.PI)
    const avgShadowPosError = this.reconShadowPosErrorAccum / Math.max(1, this.reconShadowSamples)
    const avgShadowYawErrorDeg = (this.reconShadowYawErrorAccum / Math.max(1, this.reconShadowSamples)) * (180 / Math.PI)
    const maxShadowYawErrorDeg = this.reconShadowMaxYawError * (180 / Math.PI)
    const latencySnapshot = metadata.latencyByPlayer?.[this.myPlayerId]
    const latencyFragment = latencySnapshot
      ? ` rtt=${latencySnapshot.rttMs}ms jitter=${latencySnapshot.jitterMs}ms ooo=${latencySnapshot.outOfOrderInputs} gapDrop=${latencySnapshot.droppedInputGaps}`
      : ''

    console.debug(
      `[Recon/Shadow] tick=${this.reconLastServerTick} samples=${this.reconSamples} `
      + `avgPos=${avgPosError.toFixed(3)}m maxPos=${this.reconMaxPosError.toFixed(3)}m `
      + `avgYaw=${avgYawErrorDeg.toFixed(2)}deg maxYaw=${maxYawErrorDeg.toFixed(2)}deg `
      + `shadowSamples=${this.reconShadowSamples} avgShadowPos=${avgShadowPosError.toFixed(3)}m `
      + `maxShadowPos=${this.reconShadowMaxPosError.toFixed(3)}m `
      + `avgShadowYaw=${avgShadowYawErrorDeg.toFixed(2)}deg maxShadowYaw=${maxShadowYawErrorDeg.toFixed(2)}deg `
      + `ackGap=${this.reconLastAckGap} oneWay=${this.reconLastOneWayMs}ms`
      + latencyFragment,
    )
  }

  private addRemotePlayer(player: PlayerState) {
    if (this.hasRemotePlayer(player.id) || player.id === this.myPlayerId) {
      return
    }

    if (this.useAvatarSystemV2) {
      this.avatarSystem.upsertRemotePlayer(player)
      return
    }

    const mesh = createRemotePlayerAvatar()
    const avatarY = this.getRemoteAvatarBaseY(player.position.y)
    mesh.position.set(player.position.x, avatarY, player.position.z)
    mesh.castShadow = true
    this.scene.add(mesh)

    // Create name label
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = 256
    canvas.height = 64
    context.fillStyle = 'rgba(0, 0, 0, 0.6)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = 'bold 24px sans-serif'
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.fillText(player.name, canvas.width / 2, canvas.height / 2 + 8)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(spriteMaterial)
    sprite.scale.set(2, 0.5, 1)
    sprite.position.set(player.position.x, avatarY + 2.2, player.position.z)
    this.scene.add(sprite)

    this.remotePlayers.set(player.id, { state: player, mesh, nameLabel: sprite })
  }

  private disposeObject3D(root: THREE.Object3D) {
    root.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return
      }
      child.geometry.dispose()
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      for (const material of materials) {
        material.dispose()
      }
    })
  }

  private removeRemotePlayer(playerId: string) {
    if (this.useAvatarSystemV2) {
      this.avatarSystem.removeRemotePlayer(playerId)
      return
    }

    const remotePlayer = this.remotePlayers.get(playerId)
    if (!remotePlayer) {
      return
    }

    this.scene.remove(remotePlayer.mesh)
    this.scene.remove(remotePlayer.nameLabel)
    this.disposeObject3D(remotePlayer.mesh)
    const labelMaterial = remotePlayer.nameLabel.material as THREE.SpriteMaterial
    labelMaterial.map?.dispose()
    labelMaterial.dispose()

    this.remotePlayers.delete(playerId)
  }

  private updateRemotePlayer(playerId: string, state: Partial<PlayerState>) {
    if (this.useAvatarSystemV2) {
      this.avatarSystem.updateRemotePlayer(playerId, state)
      return
    }

    const remotePlayer = this.remotePlayers.get(playerId)
    if (!remotePlayer) {
      return
    }

    // Update state
    Object.assign(remotePlayer.state, state)

    // Update visual position
    if (state.position) {
      const avatarY = this.getRemoteAvatarBaseY(state.position.y)
      remotePlayer.mesh.position.set(state.position.x, avatarY, state.position.z)
      remotePlayer.nameLabel.position.set(state.position.x, avatarY + 2.2, state.position.z)
    }

    // Update rotation
    if (state.yaw !== undefined) {
      remotePlayer.mesh.rotation.y = state.yaw
    }
  }

  private sendInputUpdate() {
    if (!this.isMultiplayerJoined()) {
      return
    }

    const now = Date.now()
    if (now - this.lastInputSentAt < this.inputSendInterval) {
      return
    }

    this.lastInputSentAt = now
    this.networkClient?.sendInput(
      { x: this.player.x, y: this.player.y, z: this.player.z },
      this.yaw,
      this.pitch,
    )

    if (this.useServerReconTelemetry) {
      const latestSentSeq = this.networkClient?.getLatestSentInputSeq() ?? 0
      if (latestSentSeq > 0) {
        this.inputHistorySystem.record(latestSentSeq, this.player, this.yaw)
      }
    }
  }

  private clearEnemyBolts() {
    for (let index = this.enemyBolts.length - 1; index >= 0; index -= 1) {
      this.disposeEnemyBolt(index)
    }
  }

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.animationId = requestAnimationFrame(this.loop)
    const delta = Math.min(this.clock.getDelta(), 0.033)
    this.update(delta)
    if (this.usePostProcessing) {
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.camera)
    }
  }

  private update(delta: number) {
    if (this.gameOverActive) {
      return
    }
    if (this.hud.intro.dataset.hidden !== 'true') {
      // Keep the minimap and world-state HUD live while browsing arenas in the menu.
      this.updateLook()
      this.updateFps(delta)
      this.syncHud()
      return
    }
    this.updateLook()
    this.updateMovement(delta)
    if (this.triggerHeld && document.pointerLockElement === this.renderer.domElement) {
      this.shoot()
    }
    this.updateWeapon(delta)
    this.updateProjectiles(delta)
    this.updateEnemies(delta)
    if (this.isMultiplayerJoined()) {
      this.clearEnemyBolts()
    } else {
      this.updateEnemyBolts(delta)
    }
    this.updateImpacts(delta)
    this.weaponPickupSystem.update(
      delta,
      this.player,
      () => this.isMultiplayerJoined(),
      (id) => this.networkClient?.sendCollectPickup(id),
      (point, color, sizeScale) => this.spawnImpact(point, color, sizeScale),
      (tier, message) => {
        this.weaponUpgradeTier = Math.max(this.weaponUpgradeTier, tier)
        this.hud.status.textContent = message
      },
    )
    this.regenerateHealth(delta)
    this.updateFps(delta)
    this.sendInputUpdate()
    this.syncHud()
  }

  private updateLook() {
    this.cameraRight.set(1, 0, 0).applyAxisAngle(this.upAxis, this.yaw)
    const lateralVelocity = this.velocity.x * this.cameraRight.x + this.velocity.z * this.cameraRight.z
    const strafeTilt = THREE.MathUtils.clamp(-lateralVelocity * 0.016, -0.09, 0.09)
    this.camera.position.copy(this.player)
    this.camera.position.y -= this.landingImpact * 0.05
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch - this.viewKickPitch
    this.camera.rotation.z = strafeTilt + this.viewKickRoll
  }

  private applyGroundFriction(delta: number) {
    const speed = horizontalLength(this.velocity)
    if (speed <= 0.0001) {
      return
    }

    const control = Math.max(speed, 4)
    const drop = control * 8.5 * delta
    const nextSpeed = Math.max(0, speed - drop)
    if (nextSpeed === speed) {
      return
    }

    const scale = nextSpeed / speed
    this.velocity.x *= scale
    this.velocity.z *= scale
  }

  private acceleratePlayer(wishDir: THREE.Vector3, wishSpeed: number, acceleration: number, delta: number) {
    const currentSpeed = this.velocity.x * wishDir.x + this.velocity.z * wishDir.z
    const addSpeed = wishSpeed - currentSpeed
    if (addSpeed <= 0) {
      return
    }

    const accelSpeed = Math.min(addSpeed, acceleration * delta * wishSpeed)
    this.velocity.x += wishDir.x * accelSpeed
    this.velocity.z += wishDir.z * accelSpeed
  }

  private updateMovement(delta: number) {
    const wasGrounded = this.grounded
    const locked = document.pointerLockElement === this.renderer.domElement
    if (locked) {
      this.moveWish.set(0, 0, 0)
      if (isGameActionPressed(this.keys, 'moveForward', this.useInputMapV2)) {
        this.moveWish.z -= 1
      }
      if (isGameActionPressed(this.keys, 'moveBackward', this.useInputMapV2)) {
        this.moveWish.z += 1
      }
      if (isGameActionPressed(this.keys, 'moveLeft', this.useInputMapV2)) {
        this.moveWish.x -= 1
      }
      if (isGameActionPressed(this.keys, 'moveRight', this.useInputMapV2)) {
        this.moveWish.x += 1
      }

      if (this.moveWish.lengthSq() > 0) {
        this.moveWish.normalize()
        this.moveWish.applyAxisAngle(this.upAxis, this.yaw)
        if (this.flyModeEnabled) {
          const acceleration = 18
          this.velocity.x += this.moveWish.x * acceleration * delta
          this.velocity.z += this.moveWish.z * acceleration * delta
        } else {
          const sprinting = isGameActionPressed(this.keys, 'sprint', this.useInputMapV2)
          const groundWishSpeed = (sprinting ? 12.2 : 10.4) * this.movementSpeedScale
          const airWishSpeed = (sprinting ? 10.4 : 9.3) * this.movementSpeedScale
          if (this.grounded) {
            this.acceleratePlayer(this.moveWish, groundWishSpeed, sprinting ? 18 : 15, delta)
          } else {
            this.acceleratePlayer(this.moveWish, Math.min(airWishSpeed, 8.5), sprinting ? 4.4 : 3.6, delta)
          }
        }
      } else if (this.grounded || this.flyModeEnabled) {
        if (this.flyModeEnabled) {
          const friction = Math.exp(-10 * delta)
          this.velocity.x *= friction
          this.velocity.z *= friction
        } else {
          this.applyGroundFriction(delta)
        }
      }

      const sprinting = isGameActionPressed(this.keys, 'sprint', this.useInputMapV2) && !this.flyModeEnabled
      const speedLimit = (this.flyModeEnabled ? 8.2 : this.grounded ? (sprinting ? 12.8 : 11.1) : 18) * this.movementSpeedScale
      const lateralSpeed = horizontalLength(this.velocity)
      if (lateralSpeed > speedLimit) {
        const scale = speedLimit / lateralSpeed
        this.velocity.x *= scale
        this.velocity.z *= scale
      }
    }

    if (this.flyModeEnabled) {
      const ascend = isGameActionPressed(this.keys, 'jump', this.useInputMapV2)
      const descend = isGameActionPressed(this.keys, 'descend', this.useInputMapV2)
      const verticalInput = (ascend ? 1 : 0) - (descend ? 1 : 0)
      this.velocity.y = verticalInput * 7.2
      this.wantsJump = false
      this.grounded = false
    } else {
      if (this.wantsJump && this.grounded) {
        this.velocity.y = 9.1
        this.grounded = false
      }
      this.wantsJump = false
      this.velocity.y -= 26 * delta
    }

    this.player.x += this.velocity.x * delta
    this.player.z += this.velocity.z * delta

    // Fly mode acts as no-clip: do not resolve against solid brush volumes.
    if (!this.flyModeEnabled) {
      this.resolvePlayerCollisions('x')
      this.resolvePlayerCollisions('z')
    }

    this.player.y += this.velocity.y * delta

    if (!this.flyModeEnabled) {
      const playerFeetY = this.player.y - this.floorLevel
      const supportFloor = this.getGroundHeightAt(this.player.x, this.player.z, playerFeetY + 1.3)
      const supportY = supportFloor + this.floorLevel
      if (this.player.y <= supportY) {
        const landingVelocity = this.velocity.y
        this.player.y = supportY
        this.velocity.y = 0
        this.grounded = true
        if (!wasGrounded && landingVelocity < -7.5) {
          this.landingImpact = Math.min(1, Math.abs(landingVelocity) / 18)
        }
      } else {
        this.grounded = false
      }
    }

    if (this.player.y > this.worldCeiling - 0.6) {
      this.player.y = this.worldCeiling - 0.6
      this.velocity.y = Math.min(this.velocity.y, 0)
    }
  }

  private resolvePlayerCollisions(axis: 'x' | 'z') {
    const bounds = getBodyVerticalBounds(this.player.y, this.playerBodyHeight, this.floorLevel)

    for (const volume of this.solidVolumes) {
      if (!this.blocksHorizontalMovement(volume)) {
        continue
      }

      // Stage 1: Broad-phase XZ check
      if (!overlapsVolumeXZBounds(this.player.x, this.player.z, this.playerRadius, volume)) {
        continue
      }

      // Stage 2: Y range check
      if (!overlapsVolumeYRange(bounds, volume)) {
        continue
      }

      // Stage 3: Get surface height and check if we can walk on it
      const nearestPoint = getNearestPointOnVolume(this.player.x, this.player.z, volume)
      const topY = getVolumeSurfaceHeight(volume, nearestPoint.x, nearestPoint.z)

      if (topY === null || bounds.minY >= topY - 0.02) {
        continue
      }

      // Stage 4: Try to auto-step onto surface
      const stepHeight = calculateStepHeight(topY, bounds.minY)
      if (canAutoStep(stepHeight, this.maxAutoStepHeight) && this.velocity.y <= 1.5) {
        const steppedPlayerY = topY + this.floorLevel
        const clearanceProbeY = steppedPlayerY + 0.05
        const clearanceBounds = getBodyVerticalBounds(clearanceProbeY, this.playerBodyHeight, this.floorLevel)

        if (!isPositionBlockedByVolumes(this.player.x, this.player.z, this.solidVolumes, clearanceBounds, this.playerRadius)) {
          this.player.y = Math.max(this.player.y, steppedPlayerY)
          this.velocity.y = Math.max(0, this.velocity.y)
          continue
        }
      }

      // Stage 5: Push player out of volume
      const pushVector = calculatePushVector(this.player.x, this.player.z, this.playerRadius, volume)
      if (pushVector) {
        if (axis === 'x') {
          this.player.x += pushVector.x
          this.velocity.x = 0
        } else {
          this.player.z += pushVector.z
          this.velocity.z = 0
        }
      }
    }
  }

  private isGroundSurface(volume: SolidVolume) {
    if (volume.kind && volume.kind !== 'box') {
      return true
    }
    const height = volume.maxY - volume.minY
    const width = volume.maxX - volume.minX
    const depth = volume.maxZ - volume.minZ
    const footprintMajor = Math.max(width, depth)
    const footprintMinor = Math.min(width, depth)
    // Many authored arenas include a thin top cap to close the volume.
    // Treat those near-roof slabs as ceiling, not walkable ground.
    const nearArenaRoof = volume.minY >= activeMap.bounds.max.y - 1.6
    // Only classify truly walkable floors and thin platforms as ground (not visible obstacle platforms).
    // Use height <= 1.0 to allow natural floor layers while excluding thicker platform blockers.
    // Use footprint bounds to ensure they're substantial enough to be real floors/surfaces.
    return !nearArenaRoof && height <= 1.0 && footprintMajor >= 4 && footprintMinor >= 1.8
  }

  private blocksHorizontalMovement(volume: SolidVolume) {
    if (volume.kind && volume.kind !== 'box') {
      return true
    }
    // Imported Quake-style maps often include explicit floor/ceiling slabs as brushes.
    // Keep only true base-floor slabs non-blocking. Elevated thin slabs/platforms
    // should still block side movement so players cannot run through them.
    if (!this.isGroundSurface(volume)) {
      return true
    }
    const isBaseFloor = volume.minY <= this.floorLevel * 0.5
    return !isBaseFloor
  }

  private getGroundHeightAt(x: number, z: number, maxY = Number.POSITIVE_INFINITY) {
    let groundY = 0

    for (const volume of this.solidVolumes) {
      if (!this.isGroundSurface(volume)) {
        continue
      }

      const topY = getVolumeSurfaceHeight(volume, x, z)
      if (topY === null || topY > maxY) {
        continue
      }

      groundY = Math.max(groundY, topY)
    }

    return groundY
  }

  private isPositionBlocked(x: number, z: number, padding = 0.45, probeY = this.floorLevel) {
    const bounds = getBodyVerticalBounds(probeY, this.playerBodyHeight, this.floorLevel)

    return this.solidVolumes.some((volume) => {
      if (!this.blocksHorizontalMovement(volume)) {
        return false
      }

      // XZ bounds check with padding
      if (!overlapsVolumeXZBounds(x, z, 0, volume, padding)) {
        return false
      }

      // Y range check
      if (!overlapsVolumeYRange(bounds, volume)) {
        return false
      }

      // Get surface height and check if it's automeable
      const nearestPoint = getNearestPointOnVolume(x, z, volume)
      const topY = getVolumeSurfaceHeight(volume, nearestPoint.x, nearestPoint.z)

      if (topY === null || bounds.minY >= topY - 0.02) {
        return false
      }

      // Blocked if we can't auto-step onto it
      const stepHeight = calculateStepHeight(topY, bounds.minY)
      return !canAutoStep(stepHeight, this.maxAutoStepHeight)
    })
  }

  private randomOpenPosition(y = 1.1, padding = 0.7) {
    let attempt = 0
    const candidateHeights = [Math.max(this.floorLevel, y), this.floorLevel, Math.max(this.floorLevel, y + 0.4)]
    while (attempt < 40) {
      const x = WORLD_MIN_X + CELL_SIZE * 3 + Math.random() * Math.max(1, WORLD_WIDTH - CELL_SIZE * 6)
      const z = WORLD_MIN_Z + CELL_SIZE * 3 + Math.random() * Math.max(1, WORLD_HEIGHT - CELL_SIZE * 6)
      for (const candidateY of candidateHeights) {
        if (!this.isPositionBlocked(x, z, padding, candidateY)) {
          return new THREE.Vector3(x, candidateY, z)
        }
      }
      attempt += 1
    }
    const fallbackY = Math.max(this.floorLevel, y)
    return new THREE.Vector3((WORLD_MIN_X + WORLD_MAX_X) * 0.5, fallbackY, (WORLD_MIN_Z + WORLD_MAX_Z) * 0.5)
  }

  private resolveOpenSpawn(position: THREE.Vector3, y: number, padding = 0.7) {
    const candidateHeights = [
      Math.max(this.floorLevel, y),
      this.floorLevel,
      Math.max(this.floorLevel, y + 0.4),
      Math.max(this.floorLevel, y + 0.8),
    ]

    for (const candidateY of candidateHeights) {
      if (!this.isPositionBlocked(position.x, position.z, padding, candidateY)) {
        return position.clone().setY(candidateY)
      }
    }

    // If exact spawn is obstructed, sample nearby points before falling back globally.
    for (let radius = 0.6; radius <= 4.8; radius += 0.6) {
      for (let index = 0; index < 16; index += 1) {
        const angle = (index / 16) * Math.PI * 2
        const candidateX = position.x + Math.cos(angle) * radius
        const candidateZ = position.z + Math.sin(angle) * radius
        for (const candidateY of candidateHeights) {
          if (!this.isPositionBlocked(candidateX, candidateZ, padding, candidateY)) {
            return new THREE.Vector3(candidateX, candidateY, candidateZ)
          }
        }
      }
    }

    return this.randomOpenPosition(Math.max(this.floorLevel, y), padding)
  }

  private updateWeapon(delta: number) {
    const speed = horizontalLength(this.velocity)
    this.bobTime += delta * Math.min(speed, 8)
    const bobScale = Math.min(speed / 5.4, 1)
    const bob = Math.sin(this.bobTime * 8.4) * 0.028 * bobScale
    const sway = Math.cos(this.bobTime * 4.2) * 0.018 * bobScale
    this.weaponKick = Math.max(0, this.weaponKick - delta * 7.5)
    this.viewKickPitch = Math.max(0, this.viewKickPitch - delta * 8.5)
    this.viewKickRoll *= Math.exp(-delta * 9)
    this.landingImpact *= Math.exp(-delta * 10)
    this.weapon.position.x = 0.52 + sway * 0.9
    this.weapon.position.y = -0.45 + bob - this.weaponKick * 0.035 - this.landingImpact * 0.028
    this.weapon.position.z = -0.78 + this.flashTimer * 0.075 + this.weaponKick * 0.09
    this.weapon.rotation.x = -0.16 - this.weaponKick * 0.09 + bob * 0.08
    this.weapon.rotation.y = -0.26 + sway * 0.2
    this.weapon.rotation.z = -0.08 + bob * 1.15 - this.weaponKick * 0.05
    this.leftHand.position.x = -0.42 - sway * 0.75
    this.leftHand.position.y = -0.38 + bob * 0.9 - this.weaponKick * 0.018
    this.leftHand.position.z = -0.9 + this.flashTimer * 0.02 + this.weaponKick * 0.03
    this.leftHand.rotation.z = 0.18 - bob * 0.65 + this.weaponKick * 0.04
    this.flashTimer = Math.max(0, this.flashTimer - delta * 6)
    ;(this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flashTimer * 0.9
    this.muzzleLight.intensity = this.flashTimer * 9
    if (this.globalIlluminationEnabled) {
      this.flashlight.intensity = 0
      this.flashlightCore.intensity = 0
    } else {
      this.flashlight.intensity = 152 + Math.sin(this.bobTime * 1.4) * 3
      this.flashlightCore.intensity = 218 + Math.sin(this.bobTime * 1.9) * 5
    }
    this.hud.damage.style.opacity = String(this.damagePulse)
    this.hitCounterSystem.update(delta)
    this.damagePulse = Math.max(0, this.damagePulse - delta * 1.2)
  }

  private shoot() {
    const now = performance.now() * 0.001
    if (now < this.canShootAt) {
      return
    }
    this.canShootAt = now + getWeaponCooldown(this.weaponUpgradeTier)
    this.flashTimer = 1
    this.weaponKick = Math.min(1.2, this.weaponKick + 1)
    this.viewKickPitch = Math.min(0.16, this.viewKickPitch + 0.045)
    this.viewKickRoll += (Math.random() - 0.5) * 0.035

    const shotDirection = this.camera.getWorldDirection(this.aimDirection.clone())
    const muzzlePoint = this.muzzleFlash.getWorldPosition(new THREE.Vector3())
    const shotNodes = this.computeShotNodes(shotDirection)
    this.spawnProjectile(muzzlePoint, shotNodes)

    // Send shot to server for multiplayer
    if (this.isMultiplayerJoined()) {
      this.networkClient?.sendShoot(
        { x: muzzlePoint.x, y: muzzlePoint.y, z: muzzlePoint.z },
        { x: shotDirection.x, y: shotDirection.y, z: shotDirection.z },
        this.weaponUpgradeTier,
      )
    }
  }

  private computeShotNodes(direction: THREE.Vector3) {
    const nodes: ProjectileNode[] = []
    const rayDirection = direction.clone().normalize()
    const maxRange = 90 + this.weaponUpgradeTier * 10
    const damageMultiplier = getWeaponDamageMultiplier(this.weaponUpgradeTier)
    const impactColor = getProjectileImpactColor(this.weaponUpgradeTier)

    this.raycaster.set(this.camera.position, rayDirection)
    this.raycaster.far = maxRange
    const aimHits = this.raycaster.intersectObjects([...this.hitables, ...this.ricochetSurfaces], false)

    if (aimHits.length === 0) {
      nodes.push({ point: this.camera.position.clone().addScaledVector(rayDirection, maxRange) })
      return nodes
    }

    const aimHit = aimHits[0]
    const directEnemy = this.enemies.find((candidate) => candidate.core === aimHit.object || candidate.hitbox === aimHit.object)
    const initialPoint = aimHit.point.clone()
    const remainingAfterAim = Math.max(0, maxRange - aimHit.distance)

    if (directEnemy) {
      nodes.push({
        point: initialPoint,
        enemy: directEnemy,
        impactColor,
        damageOnArrival: true,
        damageMultiplier,
      })
      return nodes
    }

    nodes.push({ point: initialPoint, impactColor, damageOnArrival: false })
    if (remainingAfterAim <= 0.01) {
      return nodes
    }

    let bounceOrigin = initialPoint.clone()
    let bounceDirection: THREE.Vector3
    if (aimHit.face) {
      bounceDirection = rayDirection.clone().reflect(
        aimHit.face.normal.clone().transformDirection(aimHit.object.matrixWorld).normalize(),
      )
    } else {
      // No face normal available, reflect around a default up vector
      bounceDirection = rayDirection.clone().reflect(new THREE.Vector3(0, 1, 0)).normalize()
    }
    bounceOrigin.addScaledVector(bounceDirection, 0.18)
    let remaining = remainingAfterAim
    let bouncesLeft = 3 + this.weaponUpgradeTier

    while (remaining > 0.01) {
      this.raycaster.set(bounceOrigin, bounceDirection)
      this.raycaster.far = remaining
      const bounceHits = this.raycaster.intersectObjects([...this.hitables, ...this.ricochetSurfaces], false)

      if (bounceHits.length === 0) {
        nodes.push({ point: bounceOrigin.clone().addScaledVector(bounceDirection, remaining) })
        break
      }

      const bounceHit = bounceHits[0]
      remaining -= bounceHit.distance
      const bounceEnemy = this.enemies.find(
        (candidate) => candidate.core === bounceHit.object || candidate.hitbox === bounceHit.object,
      )

      if (bounceEnemy) {
        nodes.push({
          point: bounceHit.point.clone(),
          enemy: bounceEnemy,
          impactColor,
          damageOnArrival: true,
          damageMultiplier,
        })
        break
      }

      nodes.push({ point: bounceHit.point.clone(), impactColor, damageOnArrival: false })
      bouncesLeft -= 1
      if (bouncesLeft <= 0) {
        break
      }

      if (bounceHit.face) {
        const normal = bounceHit.face.normal.clone().transformDirection(bounceHit.object.matrixWorld).normalize()
        bounceDirection.reflect(normal).normalize()
      } else {
        // No face normal, use a default reflection
        bounceDirection.reflect(new THREE.Vector3(0, 1, 0)).normalize()
      }
      bounceOrigin = bounceHit.point.clone().addScaledVector(bounceDirection, 0.18)
    }

    return nodes
  }

  private spawnProjectile(start: THREE.Vector3, nodes: ProjectileNode[]) {
    if (nodes.length === 0) {
      return
    }

    const totalDistance = [start, ...nodes.map((node) => node.point)].reduce((distance, point, index, array) => {
      if (index === 0) {
        return 0
      }
      return distance + array[index - 1].distanceTo(point)
    }, 0)
    const initialDirection = nodes[0].point.clone().sub(start)
    if (initialDirection.lengthSq() <= 0.0001) {
      const immediateNode = nodes[0]
      if (immediateNode.enemy && immediateNode.damageOnArrival) {
        const hitApplied = this.damageEnemy(
          immediateNode.enemy,
          immediateNode.point,
          immediateNode.damageMultiplier ?? getWeaponDamageMultiplier(this.weaponUpgradeTier),
        )
        if (hitApplied && immediateNode.impactColor) {
          this.spawnImpact(immediateNode.point, immediateNode.impactColor)
        }
      } else if (immediateNode.impactColor) {
        this.spawnImpact(immediateNode.point, immediateNode.impactColor)
      }
      return
    }
    initialDirection.normalize()
    const projectileRadius = this.weaponUpgradeTier >= 2 ? 0.095 : this.weaponUpgradeTier === 1 ? 0.065 : 0.035
    const projectileTail = this.weaponUpgradeTier >= 2 ? 0.17 : this.weaponUpgradeTier === 1 ? 0.115 : 0.07
    const projectileColor = getProjectileImpactColor(this.weaponUpgradeTier)
    const projectileOpacity = this.weaponUpgradeTier >= 2 ? 0.98 : this.weaponUpgradeTier === 1 ? 0.95 : 0.92
    const projectile = new THREE.Mesh(
      new THREE.CylinderGeometry(projectileRadius, projectileTail, PROJECTILE_LENGTH + this.weaponUpgradeTier * 0.55, 12),
      new THREE.MeshBasicMaterial({ color: projectileColor, transparent: true, opacity: projectileOpacity }),
    )
    projectile.position.copy(start).addScaledVector(initialDirection, -PROJECTILE_HALF_LENGTH)
    projectile.quaternion.copy(
      this.projectileQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), initialDirection),
    )
    this.scene.add(projectile)
    this.projectiles.push({
      mesh: projectile,
      start: start.clone(),
      nodes,
      segmentIndex: 0,
      segmentProgress: 0,
      speed: 78 + this.weaponUpgradeTier * 22,
      remaining: totalDistance,
      baseOpacity: projectileOpacity,
    })
  }

  private damageEnemy(enemy: Enemy, point: THREE.Vector3, powerMultiplier = 1) {
    if (enemy.health <= 0) {
      return false
    }
    const criticalHit = Math.random() < CRITICAL_HIT_CHANCE
    const baseDamage = criticalHit ? 2 : 1
    const damage = Math.max(1, Math.round(baseDamage * powerMultiplier))
    const appliedDamage = Math.min(damage, enemy.health)

    // Send damage to server for multiplayer sync
    if (this.isMultiplayerJoined() && enemy.id) {
      this.networkClient?.sendDamageEnemy(enemy.id, appliedDamage)
      const impactScale = 1 + (powerMultiplier - 1) * 0.5
      this.spawnImpact(point, getProjectileImpactColor(this.weaponUpgradeTier), impactScale)
      this.hitCounterSystem.showHit(appliedDamage, criticalHit)
      return true
    }

    enemy.health -= appliedDamage

    const impactScale = 1 + (powerMultiplier - 1) * 0.5
    this.spawnImpact(point, getProjectileImpactColor(this.weaponUpgradeTier), impactScale)
    this.hitCounterSystem.showHit(appliedDamage, criticalHit)
    if (enemy.health > 0) {
      return true
    }
    enemy.respawn = 3.4
    enemy.group.visible = false
    if (enemy.visualKind === 'fallback') {
      enemy.core.material = this.enemyDownMaterial
    }
    for (const ring of enemy.rings) {
      ring.visible = false
    }
    this.scoreValue += 1
    return true
  }


  private disposeProjectile(index: number) {
    const projectile = this.projectiles[index]
    this.scene.remove(projectile.mesh)
    projectile.mesh.geometry.dispose()
    ;(projectile.mesh.material as THREE.Material).dispose()
    this.projectiles.splice(index, 1)
  }

  private fireEnemyBolt(enemy: Enemy, direction: THREE.Vector3) {
    const bolt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.08, 1.4, 10),
      new THREE.MeshBasicMaterial({ color: '#ff9c5a', transparent: true, opacity: 0.9 }),
    )
    bolt.position.copy(enemy.group.position)
    bolt.position.y += enemy.aimHeight
    bolt.position.addScaledVector(direction, 0.9)
    bolt.quaternion.copy(this.projectileQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction))
    this.scene.add(bolt)
    this.enemyBolts.push({
      mesh: bolt,
      direction: direction.clone(),
      remaining: 52,
      speed: 28,
    })
  }

  private disposeEnemyBolt(index: number) {
    const bolt = this.enemyBolts[index]
    this.scene.remove(bolt.mesh)
    bolt.mesh.geometry.dispose()
    ;(bolt.mesh.material as THREE.Material).dispose()
    this.enemyBolts.splice(index, 1)
  }

  private segmentHitsPlayer(start: THREE.Vector3, end: THREE.Vector3, radius: number) {
    const line = new THREE.Line3(start, end)
    const closest = line.closestPointToPoint(this.playerTarget.set(this.player.x, this.player.y + 0.2, this.player.z), true, new THREE.Vector3())
    return closest.distanceTo(this.playerTarget) <= radius ? closest : null
  }

  private getEnemyAimPoint() {
    const horizontalSign = Math.random() < 0.5 ? -1 : 1
    const verticalSign = Math.random() < 0.5 ? -1 : 1
    const horizontalOffset = 0.2 + Math.random() * 0.4
    const verticalOffset = 0.1 + Math.random() * 0.3
    this.cameraRight.setFromMatrixColumn(this.camera.matrixWorld, 0).normalize()
    this.cameraUp.setFromMatrixColumn(this.camera.matrixWorld, 1).normalize()
    return this.playerTarget
      .set(this.player.x, this.player.y + 0.15, this.player.z)
      .addScaledVector(this.cameraRight, horizontalSign * horizontalOffset)
      .addScaledVector(this.cameraUp, verticalSign * verticalOffset)
  }

  private tryMoveEnemy(enemy: Enemy, desiredVelocity: THREE.Vector3, delta: number) {
    const turnAngles = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2]

    for (const angle of turnAngles) {
      const candidateVelocity = angle === 0
        ? desiredVelocity
        : desiredVelocity.clone().applyAxisAngle(this.upAxis, angle)
      if (candidateVelocity.lengthSq() <= 0.000001) {
        continue
      }
      const next = this.enemyLoopNext.copy(enemy.group.position).addScaledVector(candidateVelocity, delta)
      if (!this.isPositionBlocked(next.x, next.z, enemy.radius)) {
        enemy.group.position.copy(next)
        return true
      }
    }

    // If fully blocked, probe around the enemy and nudge to the first free pocket.
    for (let ring = 1; ring <= 3; ring += 1) {
      const radius = 0.22 * ring
      for (let step = 0; step < 12; step += 1) {
        const angle = (step / 12) * Math.PI * 2
        const probeX = enemy.group.position.x + Math.cos(angle) * radius
        const probeZ = enemy.group.position.z + Math.sin(angle) * radius
        if (!this.isPositionBlocked(probeX, probeZ, enemy.radius)) {
          enemy.group.position.x = probeX
          enemy.group.position.z = probeZ
          return true
        }
      }
    }

    return false
  }

  private spawnImpact(point: THREE.Vector3, color: string, sizeScale = 1) {
    const safePoint = point.clone()
    const cameraDistance = safePoint.distanceTo(this.camera.position)
    const minVisualDistance = 1.35

    // Guard against occasional near-camera hit points that make impact circles look huge.
    if (cameraDistance < minVisualDistance) {
      this.aimDirection
        .set(0, 0, -1)
        .applyQuaternion(this.camera.quaternion)
        .normalize()

      if (cameraDistance > 0.001) {
        safePoint.sub(this.camera.position).normalize().multiplyScalar(minVisualDistance).add(this.camera.position)
      } else {
        safePoint.copy(this.camera.position).addScaledVector(this.aimDirection, minVisualDistance)
      }
    }

    const distance = safePoint.distanceTo(this.camera.position)
    const radius = 0.045 * sizeScale * clamp(1.15 - distance / 70, 0.32, 1)
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), material)
    mesh.position.copy(safePoint)
    this.scene.add(mesh)
    this.impacts.push({ mesh, life: 0.35 })
  }

  private updateProjectiles(delta: number) {
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index]
      let travel = Math.min(projectile.remaining, projectile.speed * delta)

      while (travel > 0 && projectile.segmentIndex < projectile.nodes.length) {
        const from = projectile.segmentIndex === 0
          ? projectile.start
          : projectile.nodes[projectile.segmentIndex - 1].point
        const to = projectile.nodes[projectile.segmentIndex].point
        const direction = to.clone().sub(from)
        const segmentDistance = direction.length()
        if (segmentDistance <= 0.0001) {
          projectile.segmentIndex += 1
          projectile.segmentProgress = 0
          continue
        }

        direction.normalize()
        const remainingInSegment = segmentDistance - projectile.segmentProgress
        const step = Math.min(remainingInSegment, travel)
        projectile.segmentProgress += step
        projectile.mesh.position.copy(from).addScaledVector(direction, projectile.segmentProgress - PROJECTILE_HALF_LENGTH)
        projectile.mesh.quaternion.copy(
          this.projectileQuaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction),
        )
        travel -= step
        projectile.remaining -= step

        if (projectile.segmentProgress + 0.0001 < segmentDistance) {
          break
        }

        const node = projectile.nodes[projectile.segmentIndex]
        projectile.segmentIndex += 1
        projectile.segmentProgress = 0
        if (node.enemy && node.damageOnArrival) {
          const hitApplied = this.damageEnemy(node.enemy, node.point, node.damageMultiplier ?? getWeaponDamageMultiplier(this.weaponUpgradeTier))
          if (hitApplied && node.impactColor) {
            this.spawnImpact(node.point, node.impactColor)
          }
          this.disposeProjectile(index)
          travel = 0
          break
        }

        if (node.impactColor) {
          this.spawnImpact(node.point, node.impactColor)
        }
      }

      ;(projectile.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(projectile.remaining / 10, 0, projectile.baseOpacity)
      if (projectile.remaining > 0 && projectile.segmentIndex < projectile.nodes.length) {
        continue
      }
      this.disposeProjectile(index)
    }
  }

  private updateImpacts(delta: number) {
    for (let index = this.impacts.length - 1; index >= 0; index -= 1) {
      const impact = this.impacts[index]
      impact.life -= delta
      impact.mesh.scale.multiplyScalar(1 + delta * 8)
      ;(impact.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(impact.life * 3, 0)
      if (impact.life > 0) {
        continue
      }
      this.scene.remove(impact.mesh)
      impact.mesh.geometry.dispose()
      ;(impact.mesh.material as THREE.Material).dispose()
      this.impacts.splice(index, 1)
    }
  }

  private updateEnemies(delta: number) {
    const playerFlat = this.enemyLoopPlayerFlat.set(this.player.x, 0, this.player.z)
    const now = performance.now() * 0.001
    const multiplayerActive = this.isMultiplayerJoined()
    for (const enemy of this.enemies) {
      enemy.mixer?.update(delta)

      if (enemy.health <= 0) {
        if (multiplayerActive) {
          continue
        }
        enemy.respawn -= delta
        if (enemy.respawn <= 0) {
          const archetype = this.rollEnemyArchetype()
          this.configureEnemy(enemy, archetype)
          enemy.group.visible = true
          enemy.group.position.copy(this.randomOpenPosition(enemy.modelRoot ? 0 : 1.1))
          enemy.canShootAt = now + 0.27 + Math.random() * 0.73
        }
        continue
      }

      enemy.angle += delta * (1.4 + enemy.speed * 0.15 + Math.sin(now * 0.7 + enemy.bobOffset) * 0.3)

      const enemyFlat = this.enemyLoopEnemyFlat.set(enemy.group.position.x, 0, enemy.group.position.z)
      const offsetToPlayer = this.enemyLoopOffsetToPlayer.copy(playerFlat).sub(enemyFlat)
      const distance = Math.max(offsetToPlayer.length(), 0.001)
      const toPlayer = this.enemyLoopToPlayer.copy(offsetToPlayer).multiplyScalar(1 / distance)
      enemy.group.rotation.y = Math.atan2(toPlayer.x, toPlayer.z) + Math.sin(enemy.angle * 1.3) * 0.12

      const strafeVariation = Math.sin(now * 1.2 + enemy.bobOffset * 2) * 0.4 + Math.cos(now * 0.8 + enemy.angle) * 0.3
      const strafe = this.enemyLoopStrafe.set(-toPlayer.z, 0, toPlayer.x).multiplyScalar(Math.sin(enemy.angle) * 0.7 + strafeVariation)
      const speedVariation = 1 + Math.sin(now * 0.6 + enemy.bobOffset) * 0.25
      const desired = this.enemyLoopDesired
        .copy(toPlayer)
        .multiplyScalar((distance > 7 ? enemy.speed : -enemy.speed * 0.45) * speedVariation)
        .add(strafe)
      if (!multiplayerActive) {
        this.tryMoveEnemy(enemy, desired, delta)
      }

      const enemyFeetY = enemy.modelRoot ? enemy.group.position.y : enemy.group.position.y - 1.1
      const enemyGround = this.getGroundHeightAt(enemy.group.position.x, enemy.group.position.z, enemyFeetY + 1.35)
      enemy.group.position.y = enemy.modelRoot
        ? enemyGround + Math.sin(performance.now() * 0.0028 + enemy.bobOffset) * 0.03
        : enemyGround + 1.1 + Math.sin(performance.now() * 0.003 + enemy.bobOffset) * 0.18

      for (const [ringIndex, ring] of enemy.rings.entries()) {
        if (!ring.visible) {
          continue
        }
        ring.rotation.z += delta * (0.9 + ringIndex * 0.35)
        ring.rotation.y = enemy.angle * (0.55 + ringIndex * 0.18)
      }

      if (!multiplayerActive && distance > 2.6 && distance < 28 && now >= enemy.canShootAt) {
        const fireOrigin = this.enemyFireOrigin.copy(enemy.group.position).add(new THREE.Vector3(0, enemy.aimHeight, 0))
        const fireDirection = this.enemyFireDirection.copy(this.getEnemyAimPoint()).sub(fireOrigin)
        const fireDistance = fireDirection.length()
        if (fireDistance > 0.001) {
          fireDirection.normalize()
          this.raycaster.set(fireOrigin, fireDirection)
          this.raycaster.far = fireDistance
          const blockers = this.raycaster.intersectObjects(this.ricochetSurfaces, false)
          if (blockers.length === 0) {
            this.fireEnemyBolt(enemy, fireDirection)
            enemy.canShootAt = now + 0.73 + Math.random() * 0.87
          }
        }
      }

      if (!multiplayerActive && distance < 1.9) {
        this.damagePlayer(6.25 * delta)
      }
    }
  }

  private updateEnemyBolts(delta: number) {
    for (let index = this.enemyBolts.length - 1; index >= 0; index -= 1) {
      const bolt = this.enemyBolts[index]
      const step = Math.min(bolt.remaining, bolt.speed * delta)
      const start = bolt.mesh.position.clone().addScaledVector(bolt.direction, PROJECTILE_HALF_LENGTH)
      const end = start.clone().addScaledVector(bolt.direction, step)
      const playerHit = this.segmentHitsPlayer(start, end, 0.55)
      if (playerHit) {
        this.spawnImpact(playerHit, '#ff8b5d')
        this.damagePlayer(6.6)
        this.disposeEnemyBolt(index)
        continue
      }

      this.raycaster.set(start, bolt.direction)
      this.raycaster.far = step + 0.2
      const wallHits = this.raycaster.intersectObjects(this.ricochetSurfaces, false)
      if (wallHits.length > 0) {
        this.spawnImpact(wallHits[0].point, '#ff8b5d')
        this.disposeEnemyBolt(index)
        continue
      }

      bolt.mesh.position.addScaledVector(bolt.direction, step)
      bolt.remaining -= step
      ;(bolt.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(bolt.remaining / 18, 0, 0.9)
      if (bolt.remaining > 0) {
        continue
      }
      this.disposeEnemyBolt(index)
    }
  }

  private damagePlayer(amount: number) {
    if (this.cheatsEnabled && this.godModeEnabled) {
      return
    }
    this.healthValue = Math.max(0, this.healthValue - amount)
    this.damagePulse = Math.min(0.75, this.damagePulse + amount * 0.015)
    if (this.healthValue > 0) {
      return
    }
    const finalScore = Math.max(0, this.scoreValue)
    if (finalScore > 0) {
      void this.recordHighScore(finalScore)
    }
    if (this.isMultiplayerJoined()) {
      this.networkClient?.sendDeath(finalScore)
    }
    this.gameOverActive = true
    this.hud.finalScore.textContent = finalScore.toString()
    this.hud.gameOver.setAttribute('data-hidden', 'false')
    this.hud.intro.dataset.hidden = 'true'
    document.exitPointerLock()
  }

  private handleRespawn = () => {
    this.gameOverActive = false
    this.healthValue = 100
    
    // In multiplayer, server will send us a new spawn position
    if (!this.isMultiplayerJoined()) {
      this.player.copy(this.resolveOpenSpawn(PLAYER_SPAWN, PLAYER_SPAWN.y))
      this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 1.3) + this.floorLevel
      this.yaw = 0
      this.pitch = 0
    }
    
    this.velocity.set(0, 0, 0)
    this.scoreValue = Math.max(0, this.scoreValue - 1)
    this.weaponUpgradeTier = 0
    this.weaponPickupSystem.reset()
    if (this.isMultiplayerJoined()) {
      this.networkClient?.sendRespawn()
    }
    this.hud.gameOver.setAttribute('data-hidden', 'true')
    this.hud.intro.dataset.hidden = 'true'
    this.hud.status.textContent = 'Suit reconstructed. Re-entering the arena.'
    this.requestPointerLock()
  }

  private handleMainMenu = () => {
    if (this.isMultiplayerJoined()) {
      this.networkClient?.leaveWorld()
      this.myPlayerId = null
      this.currentRoomState = null
      this.reconSamples = 0
      this.reconPosErrorAccum = 0
      this.reconMaxPosError = 0
      this.reconYawErrorAccum = 0
      this.reconMaxYawError = 0
      this.reconLastAckGap = 0
      this.reconLastOneWayMs = 0
      this.reconLastServerTick = 0
      this.reconLastLogAt = 0
      this.inputHistorySystem.clear()
      this.reconShadowSamples = 0
      this.reconShadowPosErrorAccum = 0
      this.reconShadowMaxPosError = 0
      this.reconShadowYawErrorAccum = 0
      this.reconShadowMaxYawError = 0
      this.hasRequestedWorldJoin = false
      for (const playerId of this.getRemotePlayerIds()) {
        this.removeRemotePlayer(playerId)
      }
    }

    // Reset game over state and show intro menu
    this.gameOverActive = false
    this.healthValue = 100
    this.player.copy(this.resolveOpenSpawn(PLAYER_SPAWN, PLAYER_SPAWN.y))
    this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 1.3) + this.floorLevel
    this.velocity.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this.weaponUpgradeTier = 0
    this.weaponPickupSystem.reset()
    this.hud.gameOver.setAttribute('data-hidden', 'true')
    this.hud.intro.setAttribute('data-hidden', 'false')
    this.hud.status.textContent = 'Click engage, then clear the sentinels.'
  }

  private regenerateHealth(delta: number) {
    // Regenerate 5 health per second (100 health in 20 seconds)
    if (this.healthValue < 100) {
      this.healthValue = Math.min(100, this.healthValue + 5 * delta)
    }
  }

  private async recordHighScore(score: number) {
    try {
      await submitHighScore({
        name: 'Anonymous',
        score,
        mapId: activeMap.id,
      })
      this.hud.status.textContent = `Score archived at ${score}. Re-entering the arena.`
    } catch {
      this.hud.status.textContent = 'Suit reconstructed. Backend unavailable, score kept local.'
    }
  }

  private updateFps(delta: number) {
    this.fpsAccumulator += delta
    this.fpsFrames += 1
    if (this.fpsAccumulator >= 0.5) {
      this.fpsValue = Math.round(this.fpsFrames / this.fpsAccumulator)
      this.fpsAccumulator = 0
      this.fpsFrames = 0
    }
  }

  private syncHud() {
    this.hud.health.textContent = Math.ceil(this.healthValue).toString().padStart(3, '0')
    const healthPercent = Math.max(0, Math.min(100, this.healthValue))
    this.hud.healthBar.style.height = `${healthPercent}%`
    this.hud.score.textContent = this.scoreValue.toString().padStart(2, '0')
    this.hud.targets.textContent = this.enemies.filter((enemy) => enemy.health > 0).length.toString()
    this.hud.fps.textContent = this.fpsValue.toString().padStart(2, '0')
    this.drawMinimap()
    this.hud.hint.textContent = getHudHintText({
      pointerLocked: document.pointerLockElement === this.renderer.domElement,
      cheatsEnabled: this.cheatsEnabled,
      godModeEnabled: this.godModeEnabled,
    })
  }

  private drawMinimap() {
    const snapshot = createMinimapSnapshot({
      worldMinX: WORLD_MIN_X,
      worldMinZ: WORLD_MIN_Z,
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      brushes: activeMap.brushes.map((brush) => ({
        min: { x: brush.min.x, z: brush.min.z },
        max: { x: brush.max.x, z: brush.max.z },
      })),
      myPlayerId: this.myPlayerId,
      liveRoomState: this.isMultiplayerJoined() ? this.currentRoomState : null,
      previewRoomState: !this.isMultiplayerJoined() ? this.previewRoomState : null,
      localEnemies: this.enemies.map((enemy) => ({
        health: enemy.health,
        visible: enemy.group.visible,
        x: enemy.group.position.x,
        z: enemy.group.position.z,
      })),
      remotePlayers: Array.from(this.getRemotePlayers()).map((remotePlayer) => ({
        id: remotePlayer.state.id,
        yaw: remotePlayer.state.yaw,
        x: remotePlayer.mesh.position.x,
        z: remotePlayer.mesh.position.z,
      })),
      worldPickups: this.weaponPickupSystem.getPickupSnapshot(),
      localPlayer: { x: this.player.x, z: this.player.z, yaw: this.yaw },
    })

    drawMinimapFrame(this.hud.minimap, this.minimapContext, snapshot, this.minimapPlayerPalette)
  }
}

export const startGame = async (root: HTMLDivElement) => {
  const selectedMapId = new URLSearchParams(window.location.search).get('map') ?? 'iron-cathedral'
  const [loadedMap, availableMaps, zombieAsset, blobAsset, glubAsset] = await Promise.all([
    loadArenaMap(selectedMapId, DEFAULT_MAP),
    loadAvailableMaps(DEFAULT_MAP),
    loadZombieEnemyAsset(),
    loadBlobEnemyAsset(),
    loadGlubEnemyAsset(),
  ])
  configureMap(loadedMap)

  const hud = mountGameShell(root, loadedMap, availableMaps)
  const host = hud.renderHost

  const game = new VibeQuake(host, hud, {
    zombie: zombieAsset,
    blob: blobAsset,
    glub: glubAsset,
  })

  let switchingMap = false
  const mapButtons = root.querySelectorAll<HTMLButtonElement>('.map-button')
  mapButtons.forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const mapId = button.getAttribute('data-map-id')
      if (!mapId || switchingMap || mapId === activeMap.id) {
        return
      }

      switchingMap = true
      hud.status.textContent = `Loading ${mapId}...`
      mapButtons.forEach((mapButton) => {
        mapButton.disabled = true
      })

      try {
        if (document.pointerLockElement) {
          document.exitPointerLock()
          await new Promise((resolve) => setTimeout(resolve, 50))
        }

        // Keep deep-link behavior without forcing a full page navigation.
        window.history.replaceState(null, '', `?map=${mapId}`)
        game.dispose()
        await startGame(root)
      } catch {
        hud.status.textContent = 'Map switch failed. Try again.'
        mapButtons.forEach((mapButton) => {
          mapButton.disabled = false
        })
        switchingMap = false
      }
    })
  })

  window.addEventListener('beforeunload', () => game.dispose(), { once: true })
}
