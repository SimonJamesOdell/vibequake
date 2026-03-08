import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type { ArenaMap, ArenaMapSummary, HighScoreSubmission } from './shared/contracts'
import { legacyTilesToBrushMap } from './shared/legacy-map'
import { TextureManager } from './texture-manager'

type HudRefs = {
  shell: HTMLDivElement
  intro: HTMLDivElement
  startButton: HTMLButtonElement
  gameOver: HTMLDivElement
  respawnButton: HTMLButtonElement
  mainMenuButton: HTMLButtonElement
  finalScore: HTMLSpanElement
  status: HTMLParagraphElement
  health: HTMLSpanElement
  healthBar: HTMLDivElement
  score: HTMLSpanElement
  targets: HTMLSpanElement
  fps: HTMLSpanElement
  hint: HTMLParagraphElement
  damage: HTMLDivElement
  hitCounter: HTMLDivElement
  minimap: HTMLCanvasElement
}

type Enemy = {
  group: THREE.Group
  core: THREE.Mesh
  hitbox: THREE.Mesh
  rings: THREE.Mesh[]
  visualKind: 'zombie' | 'blob' | 'glub' | 'fallback'
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

type EnemyModelAsset = {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

type EnemyVisualAssets = {
  zombie: EnemyModelAsset | null
  blob: EnemyModelAsset | null
  glub: EnemyModelAsset | null
}

type EnemyArchetypePreset = {
  name: string
  minHealth: number
  maxHealth: number
  scale: number
  speed: number
  radius: number
  ringCount: number
  weight: number
  coreColor: string
  emissiveColor: string
  ringColor: string
}

type EnemyArchetype = EnemyArchetypePreset & {
  coreMaterial: THREE.MeshStandardMaterial
  ringMaterial: THREE.MeshStandardMaterial
}

type Impact = {
  mesh: THREE.Mesh
  life: number
}

type FloatingHit = {
  element: HTMLSpanElement
  life: number
  duration: number
  offsetX: number
  driftX: number
  riseY: number
}

type ProjectileNode = {
  point: THREE.Vector3
  enemy?: Enemy
  impactColor?: string
  damageOnArrival?: boolean
}

type Projectile = {
  mesh: THREE.Mesh
  start: THREE.Vector3
  nodes: ProjectileNode[]
  segmentIndex: number
  segmentProgress: number
  speed: number
  remaining: number
}

type EnemyBolt = {
  mesh: THREE.Mesh
  direction: THREE.Vector3
  remaining: number
  speed: number
}

type SolidVolume = {
  minY: number
  maxY: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

const PROJECTILE_LENGTH = 1.8
const PROJECTILE_HALF_LENGTH = PROJECTILE_LENGTH / 2
const CRITICAL_HIT_CHANCE = 0.18
const ZOMBIE_MODEL_PATH = '/models/poly-pizza-zombie.glb'
const BLOB_MODEL_PATH = '/models/poly-pizza-green-spiky-blob.glb'
const GLUB_MODEL_PATH = '/models/poly-pizza-glub-evolved.glb'

const enemyModelLoader = new GLTFLoader()
let zombieAssetPromise: Promise<EnemyModelAsset | null> | null = null
let blobAssetPromise: Promise<EnemyModelAsset | null> | null = null
let glubAssetPromise: Promise<EnemyModelAsset | null> | null = null

const loadEnemyModelAsset = async (path: string, targetHeight: number) =>
  enemyModelLoader
    .loadAsync(path)
    .then((gltf) => {
      const container = new THREE.Group()
      const scene = gltf.scene
      scene.updateMatrixWorld(true)

      const bounds = new THREE.Box3().setFromObject(scene)
      const size = bounds.getSize(new THREE.Vector3())
      const center = bounds.getCenter(new THREE.Vector3())
      scene.position.set(-center.x, -bounds.min.y, -center.z)
      container.scale.setScalar(targetHeight / Math.max(size.y, 0.001))

      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.SkinnedMesh)) {
          return
        }
        // Animated skinned meshes are expensive shadow casters under a moving flashlight.
        child.castShadow = false
        child.receiveShadow = true
      })

      container.add(scene)
      return {
        scene: container,
        animations: gltf.animations,
      }
    })
    .catch(() => null)

const loadZombieEnemyAsset = async () => {
  if (!zombieAssetPromise) {
    zombieAssetPromise = loadEnemyModelAsset(ZOMBIE_MODEL_PATH, 1.6)
  }

  return zombieAssetPromise
}

const loadBlobEnemyAsset = async () => {
  if (!blobAssetPromise) {
    blobAssetPromise = loadEnemyModelAsset(BLOB_MODEL_PATH, 1.15)
  }

  return blobAssetPromise
}

const loadGlubEnemyAsset = async () => {
  if (!glubAssetPromise) {
    glubAssetPromise = loadEnemyModelAsset(GLUB_MODEL_PATH, 1.75)
  }

  return glubAssetPromise
}

const ENEMY_ARCHETYPE_PRESETS: EnemyArchetypePreset[] = [
  {
    name: 'Wisp',
    minHealth: 3,
    maxHealth: 4,
    scale: 0.8,
    speed: 2.35,
    radius: 0.48,
    ringCount: 1,
    weight: 4,
    coreColor: '#b7ecff',
    emissiveColor: '#58d8ff',
    ringColor: '#66efff',
  },
  {
    name: 'Sentinel',
    minHealth: 5,
    maxHealth: 6,
    scale: 1,
    speed: 2.05,
    radius: 0.58,
    ringCount: 2,
    weight: 3,
    coreColor: '#e7d5a7',
    emissiveColor: '#f0a64d',
    ringColor: '#ffcf70',
  },
  {
    name: 'Brute',
    minHealth: 7,
    maxHealth: 8,
    scale: 1.2,
    speed: 1.82,
    radius: 0.68,
    ringCount: 2,
    weight: 2,
    coreColor: '#d7a0a0',
    emissiveColor: '#ff6a5c',
    ringColor: '#ff9072',
  },
  {
    name: 'Archon',
    minHealth: 9,
    maxHealth: 10,
    scale: 1.38,
    speed: 1.62,
    radius: 0.82,
    ringCount: 3,
    weight: 1,
    coreColor: '#f8efcf',
    emissiveColor: '#ffd15a',
    ringColor: '#fff1a6',
  },
]

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

const apiFetch = async <T>(input: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(input, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    throw new Error(`API request failed with ${response.status}`)
  }
  return response.json() as Promise<T>
}

const loadArenaMap = async (mapId = DEFAULT_MAP.id) => {
  try {
    return await apiFetch<ArenaMap>(`/api/maps/${mapId}`)
  } catch {
    return DEFAULT_MAP
  }
}

const loadAvailableMaps = async () => {
  try {
    return await apiFetch<ArenaMapSummary[]>('/api/maps')
  } catch {
    return [{
      id: DEFAULT_MAP.id,
      name: DEFAULT_MAP.name,
      description: DEFAULT_MAP.description,
      updatedAt: DEFAULT_MAP.updatedAt,
    }]
  }
}

const submitHighScore = async (submission: HighScoreSubmission) => {
  await apiFetch('/api/highscores', {
    method: 'POST',
    body: JSON.stringify(submission),
  })
}

configureMap(DEFAULT_MAP)

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

const horizontalLength = (vector: THREE.Vector3) => Math.hypot(vector.x, vector.z)

const fract = (value: number) => value - Math.floor(value)

const smoothstep = (value: number) => value * value * (3 - 2 * value)

const hash2 = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123)

const valueNoise = (x: number, y: number) => {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  const localX = x - cellX
  const localY = y - cellY
  const u = smoothstep(localX)
  const v = smoothstep(localY)
  const a = hash2(cellX, cellY)
  const b = hash2(cellX + 1, cellY)
  const c = hash2(cellX, cellY + 1)
  const d = hash2(cellX + 1, cellY + 1)
  const top = a + (b - a) * u
  const bottom = c + (d - c) * u
  return top + (bottom - top) * v
}

const fbm = (x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5) => {
  let amplitude = 0.5
  let frequency = 1
  let sum = 0
  let totalAmplitude = 0
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency) * amplitude
    totalAmplitude += amplitude
    amplitude *= gain
    frequency *= lacunarity
  }
  return totalAmplitude > 0 ? sum / totalAmplitude : 0
}

const makePatternTexture = (
  drawer: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeatX: number,
  repeatY: number,
) => {
  const canvas = document.createElement('canvas')
  const size = 128
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('2D context unavailable')
  }
  drawer(ctx, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(repeatX, repeatY)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapLinearFilter
  return texture
}

const wallTexture = (variant: 'neon' | 'cavern' | 'abyssal' = 'neon') =>
  makePatternTexture((ctx, size) => {
    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const primary = fbm(x / 30, y / 22, 5)
        const secondary = fbm((x + 18) / 9, (y - 11) / 11, 3)
        const ridge = Math.abs(secondary - 0.5) * 2
        const shade = clamp(primary * 0.75 + ridge * 0.25, 0, 1)
        const crack = fbm(x / 7, y / 48, 2)
        const index = (y * size + x) * 4
        const red = variant === 'abyssal'
          ? Math.round(18 + shade * 32 + crack * 8)
          : variant === 'cavern'
          ? Math.round(26 + shade * 50 + crack * 18)
          : Math.round(45 + shade * 85 + crack * 15)
        const green = variant === 'abyssal'
          ? Math.round(30 + shade * 50 - crack * 3)
          : variant === 'cavern'
          ? Math.round(20 + shade * 36 - crack * 4)
          : Math.round(15 + shade * 45 - crack * 5)
        const blue = variant === 'abyssal'
          ? Math.round(34 + shade * 62 + crack * 14)
          : variant === 'cavern'
          ? Math.round(18 + shade * 26 + crack * 6)
          : Math.round(60 + shade * 110 + crack * 20)
        image.data[index] = red
        image.data[index + 1] = green
        image.data[index + 2] = blue
        image.data[index + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    if (variant === 'cavern' || variant === 'abyssal') {
      // Add subtle mineral veins for cave walls.
      ctx.strokeStyle = variant === 'abyssal' ? 'rgba(112, 181, 192, 0.45)' : 'rgba(215, 143, 83, 0.4)'
      ctx.lineWidth = variant === 'abyssal' ? 1.2 : 1.4
      for (let seam = 12; seam < size; seam += 26) {
        ctx.beginPath()
        ctx.moveTo(seam, 0)
        for (let y = 0; y <= size; y += 9) {
          const drift = (fbm(seam / 11, y / 14, 3) - 0.5) * 5
          ctx.lineTo(seam + drift, y)
        }
        ctx.stroke()
      }
    } else {
      // Bright neon cyan panel edges
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.85)'
      ctx.lineWidth = 2
      for (let seam = 10; seam < size; seam += 24) {
        ctx.beginPath()
        ctx.moveTo(seam, 0)
        for (let y = 0; y <= size; y += 10) {
          const drift = (fbm(seam / 14, y / 17, 3) - 0.5) * 7
          ctx.lineTo(seam + drift, y)
        }
        ctx.stroke()
      }
      // Electric magenta highlights
      ctx.fillStyle = 'rgba(255, 0, 200, 0.3)'
      for (let y = 12; y < size; y += 26) {
        ctx.fillRect(0, y, size, 3)
      }
    }
  }, 1.5, 2.5)

const ceilingTexture = (variant: 'neon' | 'cavern' | 'abyssal' = 'neon') =>
  makePatternTexture((ctx, size) => {
    const image = ctx.createImageData(size, size)
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const rock = fbm(x / 16, y / 16, 5)
        const pockets = fbm((x + 24) / 34, (y + 80) / 28, 4)
        const rough = clamp(rock * 0.65 + pockets * 0.35, 0, 1)
        const index = (y * size + x) * 4
        image.data[index] = variant === 'abyssal' ? Math.round(14 + rough * 26) : variant === 'cavern' ? Math.round(22 + rough * 38) : Math.round(15 + rough * 40)
        image.data[index + 1] = variant === 'abyssal' ? Math.round(24 + rough * 44) : variant === 'cavern' ? Math.round(16 + rough * 24) : Math.round(8 + rough * 25)
        image.data[index + 2] = variant === 'abyssal' ? Math.round(30 + rough * 55) : variant === 'cavern' ? Math.round(14 + rough * 18) : Math.round(25 + rough * 50)
        image.data[index + 3] = 255
      }
    }
    ctx.putImageData(image, 0, 0)
    if (variant === 'cavern' || variant === 'abyssal') {
      ctx.strokeStyle = variant === 'abyssal' ? 'rgba(120, 190, 210, 0.4)' : 'rgba(96, 66, 44, 0.45)'
      ctx.lineWidth = 1.4
      for (let y = 10; y < size; y += 24) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 10) {
          const wobble = (fbm(x / 16, y / 12, 3) - 0.5) * 5
          ctx.lineTo(x, y + wobble)
        }
        ctx.stroke()
      }
    } else {
      // Neon magenta accent lines
      ctx.strokeStyle = 'rgba(255, 0, 200, 0.5)'
      ctx.lineWidth = 1.5
      for (let y = 8; y < size; y += 22) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        for (let x = 0; x <= size; x += 12) {
          const wobble = (fbm(x / 20, y / 14, 3) - 0.5) * 6
          ctx.lineTo(x, y + wobble)
        }
        ctx.stroke()
      }
    }
  }, 8, 8)

class VibeQuake {
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(78, 1, 0.1, 200)
  private readonly renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  private readonly composer: EffectComposer
  private readonly clock = new THREE.Clock()
  private readonly textureManager = new TextureManager()
  private readonly keys = new Set<string>()
  private readonly player = new THREE.Vector3(-5.5, 1.6, 5.5)
  private readonly velocity = new THREE.Vector3()
  private readonly moveWish = new THREE.Vector3()
  private readonly impacts: Impact[] = []
  private readonly floatingHits: FloatingHit[] = []
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
  private readonly accentLights: THREE.PointLight[] = []
  private ambientLight: THREE.HemisphereLight | null = null
  private sunlight: THREE.DirectionalLight | null = null
  private ssaoPass: SSAOPass | null = null
  private bloomPass: UnrealBloomPass | null = null
  private readonly leftHand = new THREE.Group()
  private readonly weapon = new THREE.Group()
  private readonly muzzleFlash = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 10, 10),
    new THREE.MeshBasicMaterial({ color: '#ffd36b', transparent: true, opacity: 0, visible: false }),
  )
  private readonly muzzleLight = new THREE.PointLight('#ffb55a', 0, 7, 2)
  private readonly flashlightGlow = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 10, 10),
    new THREE.MeshBasicMaterial({ color: '#ffe7b5', transparent: true, opacity: 0, visible: false }),
  )
  private readonly flashlight = new THREE.SpotLight('#fff1c9', 86, 48, 0.62, 0.78, 1.2)
  private readonly flashlightCore = new THREE.SpotLight('#fff7d6', 34, 30, 0.28, 0.9, 1.5)
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
  private healthValue = 100
  private scoreValue = 0
  private damagePulse = 0
  private fpsAccumulator = 0
  private fpsFrames = 0
  private fpsValue = 0
  private disposed = false
  private structureViewMode: 'full' | 'layout' = 'full'
  private globalIlluminationEnabled = true
  private flyModeEnabled = false
  private lastSpaceTapAt = -10
  private detailLevel: 'full' | 'major' | 'structure' = 'full'
  private gameOverActive = false

  constructor(container: HTMLDivElement, hud: HudRefs, enemyVisualAssets: EnemyVisualAssets) {
    this.container = container
    this.hud = hud
    this.enemyVisualAssets = enemyVisualAssets
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
    this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.worldCeiling) + this.floorLevel
    this.camera.position.copy(this.player)
    this.buildWeapon()
    this.spawnEnemies()
    this.bindEvents()
    this.syncHud()
    this.hud.status.textContent = this.detailLevel === 'structure'
      ? 'Detail level: Structure only. Press L to cycle detail levels (structure/major/full).'
      : 'Detail level: Full geometry. Press L to cycle detail levels (structure/major/full).'
    this.onResize()
    this.loop()
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.animationId)
    for (const floatingHit of this.floatingHits) {
      floatingHit.element.remove()
    }
    this.floatingHits.length = 0
    this.renderer.dispose()
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
    this.renderer.domElement.addEventListener('click', () => {
      if (this.hud.intro.dataset.hidden === 'true') {
        this.requestPointerLock()
      }
    })
  }

  private readonly onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.composer.setSize(window.innerWidth, window.innerHeight)
  }

  private readonly onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat && (event.code === 'KeyG' || event.code === 'KeyV' || event.code === 'KeyL')) {
      return
    }
    if (event.code === 'KeyL') {
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
      return
    }
    if (event.code === 'KeyG') {
      this.globalIlluminationEnabled = !this.globalIlluminationEnabled
      this.applyGlobalIllumination()
      this.hud.status.textContent = this.globalIlluminationEnabled
        ? 'Global illumination ON (full visibility). Press G for cinematic lighting.'
        : 'Cinematic lighting ON. Press G for full visibility.'
      return
    }
    if (event.code === 'KeyV') {
      this.structureViewMode = this.structureViewMode === 'full' ? 'layout' : 'full'
      this.applyStructureViewMode()
      this.hud.status.textContent = this.structureViewMode === 'layout'
        ? 'Layout view active. Press V for full geometry.'
        : 'Full geometry view active. Press V for layout view.'
      return
    }
    if (event.code === 'Space') {
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

  private readonly onKeyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code)
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
      ? 'Arena live. Clear the sentinels.'
      : 'Pointer lock released. Click engage or the viewport to jump back in.'
  }

  private readonly requestPointerLock = () => {
    if (this.gameOverActive) {
      return
    }
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
    const worldVariant = activeMap.id === 'dark-caverns'
      ? 'cavern'
      : activeMap.id === 'abyssal-grotto'
      ? 'abyssal'
      : 'neon'
    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture(worldVariant),
      roughness: worldVariant === 'cavern' ? 0.86 : 0.4,
      metalness: worldVariant === 'cavern' ? 0.08 : 0.6,
      emissive: worldVariant === 'cavern' ? '#140e0b' : '#1a0a28',
      emissiveIntensity: worldVariant === 'cavern' ? 0.18 : 0.3,
    })
    for (const brush of activeMap.brushes) {
      const material = brush.texture || wallMaterial
      this.addSolidBrush(brush, material)
    }
  }

  private buildWorld() {
    const isDarkCaverns = activeMap.id === 'dark-caverns'
    const isAbyssalGrotto = activeMap.id === 'abyssal-grotto'
    const isCavernFamily = isDarkCaverns || isAbyssalGrotto
    const worldVariant = isDarkCaverns ? 'cavern' : isAbyssalGrotto ? 'abyssal' : 'neon'
    const centerX = (WORLD_MIN_X + WORLD_MAX_X) * 0.5
    const centerZ = (WORLD_MIN_Z + WORLD_MAX_Z) * 0.5
    const positionAt = (xFactor: number, zFactor: number, y = 0) =>
      new THREE.Vector3(
        THREE.MathUtils.lerp(WORLD_MIN_X, WORLD_MAX_X, xFactor),
        y,
        THREE.MathUtils.lerp(WORLD_MIN_Z, WORLD_MAX_Z, zFactor),
      )

    this.scene.background = new THREE.Color(isAbyssalGrotto ? '#020709' : isDarkCaverns ? '#070503' : '#050510')
    this.scene.fog = new THREE.Fog(isAbyssalGrotto ? '#041115' : isDarkCaverns ? '#080604' : '#010101', 6, isAbyssalGrotto ? 30 : isDarkCaverns ? 34 : 44)

    // Enhanced ambient lighting for better texture visibility
    this.ambientLight = isAbyssalGrotto
      ? new THREE.HemisphereLight('#1b3238', '#071217', 0.32)
      : isDarkCaverns
      ? new THREE.HemisphereLight('#2a241e', '#0f0907', 0.3)
      : new THREE.HemisphereLight('#4a5570', '#1a1520', 0.4)
    this.scene.add(this.ambientLight)

    // Add directional light for shadows and depth
    this.sunlight = new THREE.DirectionalLight(isAbyssalGrotto ? '#b8f2ff' : isDarkCaverns ? '#ffd9b1' : '#ffffff', isAbyssalGrotto ? 0.42 : isDarkCaverns ? 0.46 : 0.8)
    this.sunlight.position.set(isAbyssalGrotto ? 6 : isDarkCaverns ? -8 : 12, isAbyssalGrotto ? 13 : isDarkCaverns ? 14 : 18, isAbyssalGrotto ? -12 : isDarkCaverns ? -10 : 8)
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
    const accentLight1 = new THREE.PointLight(isAbyssalGrotto ? '#6fe6f3' : isDarkCaverns ? '#ffb56b' : '#00ffff', isAbyssalGrotto ? 1.1 : isDarkCaverns ? 0.8 : 1.2, isAbyssalGrotto ? 28 : isDarkCaverns ? 26 : 35, 2)
    accentLight1.position.set(centerX - WORLD_WIDTH * 0.3, isAbyssalGrotto ? 2.6 : isDarkCaverns ? 3.8 : 6, centerZ - WORLD_HEIGHT * 0.3)
    accentLight1.castShadow = false
    this.accentLights.push(accentLight1)
    this.scene.add(accentLight1)

    const accentLight2 = new THREE.PointLight(isAbyssalGrotto ? '#9ec8ff' : isDarkCaverns ? '#7ea2bd' : '#ff00aa', isAbyssalGrotto ? 1.0 : isDarkCaverns ? 0.7 : 1.2, isAbyssalGrotto ? 26 : isDarkCaverns ? 24 : 35, 2)
    accentLight2.position.set(centerX + WORLD_WIDTH * 0.3, isAbyssalGrotto ? 2.9 : isDarkCaverns ? 4.2 : 6, centerZ + WORLD_HEIGHT * 0.3)
    accentLight2.castShadow = false
    this.accentLights.push(accentLight2)
    this.scene.add(accentLight2)

    const accentLight3 = new THREE.PointLight(isAbyssalGrotto ? '#89f3ff' : isDarkCaverns ? '#c47f53' : '#6600ff', isAbyssalGrotto ? 0.95 : isDarkCaverns ? 0.55 : 0.9, isAbyssalGrotto ? 20 : isDarkCaverns ? 18 : 30, 2)
    accentLight3.position.set(centerX, isAbyssalGrotto ? 1.7 : isDarkCaverns ? 2.8 : 8, centerZ)
    accentLight3.castShadow = false
    this.accentLights.push(accentLight3)
    this.scene.add(accentLight3)

    // Keep a gameplay floor fallback so sparse map geometry does not create visual/collision holes.
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH + CELL_SIZE * 4, WORLD_HEIGHT + CELL_SIZE * 4),
      new THREE.MeshStandardMaterial({
        color: isAbyssalGrotto ? '#0a1a1f' : isDarkCaverns ? '#17110d' : '#0d1626',
        emissive: isAbyssalGrotto ? '#0b2228' : isDarkCaverns ? '#0f0905' : '#032033',
        emissiveIntensity: isAbyssalGrotto ? 0.14 : isDarkCaverns ? 0.06 : 0.12,
        roughness: isAbyssalGrotto ? 0.55 : isDarkCaverns ? 0.94 : 0.7,
        metalness: isAbyssalGrotto ? 0.12 : isDarkCaverns ? 0.04 : 0.25,
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
        roughness: isAbyssalGrotto ? 0.62 : isDarkCaverns ? 0.9 : 0.5,
        metalness: isAbyssalGrotto ? 0.2 : isDarkCaverns ? 0.1 : 0.5,
        emissive: isAbyssalGrotto ? '#0d2f36' : isDarkCaverns ? '#17110f' : '#0f051a',
        emissiveIntensity: isAbyssalGrotto ? 0.22 : isDarkCaverns ? 0.11 : 0.25,
      }),
    )
    ceiling.position.y = this.worldCeiling
    ceiling.rotation.x = Math.PI / 2
    ceiling.position.set(centerX, this.worldCeiling, centerZ)
    this.scene.add(ceiling)
    this.ricochetSurfaces.push(ceiling)

    const wallMaterial = new THREE.MeshStandardMaterial({
      map: wallTexture(worldVariant),
      roughness: isAbyssalGrotto ? 0.6 : isDarkCaverns ? 0.86 : 0.4,
      metalness: isAbyssalGrotto ? 0.18 : isDarkCaverns ? 0.08 : 0.6,
      emissive: isAbyssalGrotto ? '#0b242b' : isDarkCaverns ? '#140e0b' : '#1a0a28',
      emissiveIntensity: isAbyssalGrotto ? 0.26 : isDarkCaverns ? 0.18 : 0.3,
    })
    const supportMaterial = new THREE.MeshStandardMaterial({
      color: '#2a1a3f',
      emissive: '#6600ff',
      emissiveIntensity: 0.4,
      roughness: 0.3,
      metalness: 0.8,
    })
    const trimMaterial = new THREE.MeshStandardMaterial({
      color: '#1a3f4a',
      emissive: '#00ffff',
      emissiveIntensity: 0.35,
      roughness: 0.25,
      metalness: 0.85,
    })
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: '#ff00aa',
      emissive: '#ff0088',
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.95,
    })
    const marbleMaterial = new THREE.MeshStandardMaterial({
      color: '#4a2a5f',
      emissive: '#8800ff',
      emissiveIntensity: 0.3,
      roughness: 0.4,
      metalness: 0.6,
    })
    const emberMaterial = new THREE.MeshStandardMaterial({
      color: '#0a2a2d',
      emissive: '#00ffee',
      emissiveIntensity: 0.9,
      roughness: 0.3,
      metalness: 0.06,
    })
    const velvetMaterial = new THREE.MeshStandardMaterial({
      color: '#5d1821',
      emissive: '#24090d',
      emissiveIntensity: 0.32,
      roughness: 0.94,
      metalness: 0.04,
    })
    const verdigrisMaterial = new THREE.MeshStandardMaterial({
      color: '#35555a',
      emissive: '#112329',
      emissiveIntensity: 0.24,
      roughness: 0.82,
      metalness: 0.18,
    })
    const obsidianMaterial = new THREE.MeshStandardMaterial({
      color: '#221c22',
      emissive: '#0e090d',
      emissiveIntensity: 0.18,
      roughness: 0.72,
      metalness: 0.22,
    })

    const addFramedPanel = (anchor: THREE.Vector3, width: number, height: number, rotationY: number, insetMaterial: THREE.Material) => {
      const panel = new THREE.Group()
      const panelDepth = 0.08
      const frameThickness = 0.12
      const backplate = new THREE.Mesh(new THREE.BoxGeometry(width, height, panelDepth), insetMaterial)
      backplate.castShadow = true
      backplate.receiveShadow = true
      const top = new THREE.Mesh(new THREE.BoxGeometry(width + 0.16, frameThickness, panelDepth + 0.04), goldMaterial)
      top.position.y = height / 2 + frameThickness * 0.25
      const bottom = top.clone()
      bottom.position.y = -height / 2 - frameThickness * 0.25
      const left = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, height + 0.16, panelDepth + 0.04), goldMaterial)
      left.position.x = -width / 2 - frameThickness * 0.25
      const right = left.clone()
      right.position.x = width / 2 + frameThickness * 0.25
      const cameo = new THREE.Mesh(new THREE.SphereGeometry(Math.min(width, height) * 0.22, 18, 18), marbleMaterial)
      cameo.scale.set(1, 1.25, 0.2)
      cameo.position.z = panelDepth * 0.68
      panel.add(backplate, top, bottom, left, right, cameo)
      panel.position.copy(anchor)
      panel.rotation.y = rotationY
      this.scene.add(panel)
    }

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
        // Add cave spikes to give Dark Caverns a distinct natural silhouette.
        const spikeMaterial = new THREE.MeshStandardMaterial({
          color: isAbyssalGrotto ? '#18353c' : '#2f2520',
          emissive: isAbyssalGrotto ? '#0c2329' : '#1a110c',
          emissiveIntensity: isAbyssalGrotto ? 0.2 : 0.12,
          roughness: isAbyssalGrotto ? 0.7 : 0.95,
          metalness: isAbyssalGrotto ? 0.12 : 0.02,
        })
        for (const [xFactor, zFactor, height] of [
          [0.16, 0.18, 2.8], [0.28, 0.34, 3.6], [0.42, 0.21, 2.4], [0.58, 0.77, 3.2],
          [0.73, 0.62, 4.1], [0.84, 0.28, 2.9], [0.24, 0.78, 3.7], [0.66, 0.44, 2.6],
        ] as Array<[number, number, number]>) {
          const stalagmite = new THREE.Mesh(new THREE.ConeGeometry(0.45, height, 7), spikeMaterial)
          stalagmite.position.copy(positionAt(xFactor, zFactor, height * 0.5))
          stalagmite.castShadow = true
          this.scene.add(stalagmite)

          const stalactite = new THREE.Mesh(new THREE.ConeGeometry(0.4, height * 0.75, 7), spikeMaterial)
          stalactite.position.copy(positionAt(xFactor + 0.03, zFactor - 0.02, this.worldCeiling - height * 0.38))
          stalactite.rotation.x = Math.PI
          stalactite.castShadow = true
          this.scene.add(stalactite)
        }

        for (const point of [positionAt(0.12, 0.22, 1.9), positionAt(0.84, 0.18, 2.1), positionAt(0.78, 0.82, 1.7), positionAt(0.22, 0.74, 2.0)]) {
          const ember = new THREE.PointLight(isAbyssalGrotto ? '#75f0ff' : '#ffac6e', isAbyssalGrotto ? 5.2 : 3.8, isAbyssalGrotto ? 14 : 12, 2)
          ember.position.copy(point)
          this.scene.add(ember)
        }

        if (isAbyssalGrotto) {
          // Glossy puddle strips to sell a wet cavern floor.
          const puddleMaterial = new THREE.MeshStandardMaterial({
            color: '#0c2328',
            emissive: '#144650',
            emissiveIntensity: 0.3,
            roughness: 0.18,
            metalness: 0.35,
            transparent: true,
            opacity: 0.72,
          })
          for (const [xFactor, zFactor, sx, sz] of [
            [0.22, 0.52, 7.2, 1.8],
            [0.54, 0.36, 6.4, 1.5],
            [0.74, 0.64, 5.6, 1.6],
          ] as Array<[number, number, number, number]>) {
            const puddle = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), puddleMaterial)
            puddle.rotation.x = -Math.PI / 2
            puddle.position.copy(positionAt(xFactor, zFactor, 0.025))
            this.scene.add(puddle)
          }
        }
      } else {
      const perimeterOffsets = [0.18, 0.5, 0.82]
      for (const offset of perimeterOffsets) {
        addFramedPanel(positionAt(0.05, offset, 2.2).add(new THREE.Vector3(0.2, 0, 0)), 1.8, 2.1, Math.PI / 2, velvetMaterial)
        addFramedPanel(positionAt(0.95, offset, 2.2).add(new THREE.Vector3(-0.2, 0, 0)), 1.8, 2.1, -Math.PI / 2, verdigrisMaterial)
      }
      for (const offset of [0.28, 0.5, 0.72]) {
        addFramedPanel(positionAt(offset, 0.05, 2.15).add(new THREE.Vector3(0, 0, 0.2)), 2.6, 2.1, 0, marbleMaterial)
        addFramedPanel(positionAt(offset, 0.95, 2.15).add(new THREE.Vector3(0, 0, -0.2)), 2.6, 2.1, Math.PI, obsidianMaterial)
      }

      for (const position of [
        new THREE.Vector3(centerX, this.worldCeiling - 0.42, WORLD_MIN_Z + 0.55),
        new THREE.Vector3(centerX, this.worldCeiling - 0.42, WORLD_MAX_Z - 0.55),
      ]) {
        const cornice = new THREE.Mesh(new THREE.BoxGeometry(WORLD_WIDTH - 2.4, 0.16, 0.24), goldMaterial)
        cornice.position.copy(position)
        cornice.castShadow = true
        this.scene.add(cornice)
      }

      for (const position of [
        new THREE.Vector3(WORLD_MIN_X + 0.55, this.worldCeiling - 0.42, centerZ),
        new THREE.Vector3(WORLD_MAX_X - 0.55, this.worldCeiling - 0.42, centerZ),
      ]) {
        const cornice = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, WORLD_HEIGHT - 2.4), goldMaterial)
        cornice.position.copy(position)
        cornice.castShadow = true
        this.scene.add(cornice)
      }

      for (const point of [positionAt(0.25, 0.24, this.worldCeiling - 0.95), positionAt(0.75, 0.24, this.worldCeiling - 0.95), positionAt(0.5, 0.72, this.worldCeiling - 0.95)]) {
        const chandelier = new THREE.Group()
        const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.1, 8), goldMaterial)
        chain.position.y = 0.55
        const crown = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.08, 10, 24), goldMaterial)
        crown.rotation.x = Math.PI / 2
        const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 12), marbleMaterial)
        bowl.scale.set(1, 0.45, 1)
        bowl.position.y = -0.18
        chandelier.add(chain, crown, bowl)
        for (let index = 0; index < 6; index += 1) {
          const angle = (index / 6) * Math.PI * 2
          const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.64, 8), goldMaterial)
          arm.rotation.z = Math.PI / 2
          arm.rotation.y = angle
          arm.position.set(Math.cos(angle) * 0.34, -0.05, Math.sin(angle) * 0.34)
          const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), marbleMaterial)
          candle.position.set(Math.cos(angle) * 0.68, -0.02, Math.sin(angle) * 0.68)
          const flame = new THREE.PointLight('#ffc27d', 3.2, 8, 2)
          flame.position.set(Math.cos(angle) * 0.7, 0.12, Math.sin(angle) * 0.7)
          chandelier.add(arm, candle, flame)
        }
        chandelier.position.copy(point)
        this.scene.add(chandelier)
      }

      for (const zFactor of [0.2, 0.4, 0.6, 0.8]) {
        for (const xFactor of [0.25, 0.5, 0.75]) {
          const coffer = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(2, WORLD_WIDTH * 0.1), 0.18, Math.max(1.2, WORLD_HEIGHT * 0.06)),
            marbleMaterial,
          )
          coffer.position.copy(positionAt(xFactor, zFactor, this.worldCeiling - 0.14))
          coffer.castShadow = true
          this.scene.add(coffer)

          const inset = new THREE.Mesh(
            new THREE.BoxGeometry(Math.max(1.1, WORLD_WIDTH * 0.06), 0.08, Math.max(0.7, WORLD_HEIGHT * 0.035)),
            goldMaterial,
          )
          inset.position.copy(positionAt(xFactor, zFactor, this.worldCeiling - 0.22))
          this.scene.add(inset)
        }
      }

      for (const point of [positionAt(0.22, 0.22, 1.15), positionAt(0.78, 0.22, 1.15), positionAt(0.22, 0.78, 1.15), positionAt(0.78, 0.78, 1.15)]) {
        const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 10), trimMaterial)
        base.position.copy(point)
        base.castShadow = true
        const spire = new THREE.Mesh(new THREE.ConeGeometry(0.65, 2.6, 8), supportMaterial)
        spire.position.copy(point.clone().add(new THREE.Vector3(0, 1.55, 0)))
        spire.castShadow = true
        this.scene.add(base, spire)
      }

      for (const xFactor of [0.18, 0.5, 0.82]) {
        const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, WORLD_HEIGHT - 2.6), trimMaterial)
        beam.position.copy(positionAt(xFactor, 0.5, this.worldCeiling - 0.55))
        beam.castShadow = true
        this.scene.add(beam)
      }

      const centralRing = new THREE.Mesh(
        new THREE.TorusGeometry(Math.min(WORLD_WIDTH, WORLD_HEIGHT) * 0.2, 0.24, 12, 64),
        new THREE.MeshStandardMaterial({ color: '#3a2b2d', emissive: '#611f26', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.7 }),
      )
      centralRing.rotation.x = Math.PI / 2
      centralRing.position.set(centerX, this.worldCeiling - 0.9, centerZ)
      this.scene.add(centralRing)

      for (const point of [positionAt(0.08, 0.16, 2.4), positionAt(0.92, 0.16, 2.4), positionAt(0.08, 0.84, 2.4), positionAt(0.92, 0.84, 2.4), positionAt(0.5, 0.52, 2.9)]) {
        const lamp = new THREE.Group()
        const housing = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.14, 0.42, 8),
          trimMaterial,
        )
        housing.position.copy(point)
        housing.castShadow = true
        const flame = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), emberMaterial)
        flame.position.copy(point.clone().add(new THREE.Vector3(0, 0.24, 0)))
        const light = new THREE.PointLight('#ffb46f', 14, 14, 2)
        light.position.copy(point.clone().add(new THREE.Vector3(0, 0.24, 0)))
        lamp.add(housing)
        lamp.add(flame)
        lamp.add(light)
        this.scene.add(lamp)
      }

      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(Math.max(WORLD_WIDTH, WORLD_HEIGHT) * 0.47, 0.15, 10, 72),
        new THREE.MeshBasicMaterial({ color: '#6d1e24', transparent: true, opacity: 0.18 }),
      )
      ring.rotation.x = Math.PI / 2
      ring.position.y = 0.02
      ring.position.x = centerX
      ring.position.z = centerZ
      this.scene.add(ring)
      }
    }

    this.applyStructureViewMode()
    this.applyGlobalIllumination()
  }

  private applyGlobalIllumination() {
    this.hud.shell.classList.toggle('gi-fullbright', this.globalIlluminationEnabled)
    
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
        this.ssaoPass.enabled = true
      }
      if (this.bloomPass) {
        this.bloomPass.enabled = true
        this.bloomPass.strength = 0.35
      }
      const fogColor = activeMap.id === 'abyssal-grotto' ? '#041115' : activeMap.id === 'dark-caverns' ? '#080604' : '#010101'
      const fogFar = activeMap.id === 'abyssal-grotto' ? 30 : activeMap.id === 'dark-caverns' ? 34 : 44
      this.scene.fog = new THREE.Fog(fogColor, 8, fogFar)
      this.renderer.toneMappingExposure = 0.7
    }

    if (this.ambientLight) {
      this.ambientLight.intensity = this.globalIlluminationEnabled ? 1.25 : 0.28
    }
    if (this.sunlight) {
      this.sunlight.intensity = this.globalIlluminationEnabled ? 1.8 : 0.55
      this.sunlight.castShadow = !this.globalIlluminationEnabled
    }
    const accentIntensity = this.globalIlluminationEnabled ? [0.25, 0.25, 0.2] : [0.8, 0.8, 0.6]
    for (const [index, light] of this.accentLights.entries()) {
      light.intensity = accentIntensity[index] ?? accentIntensity[accentIntensity.length - 1]
    }
  }

  private applyStructureViewMode() {
    if (this.structureViewMode === 'full') {
      for (const brush of this.brushMeshes) {
        brush.mesh.visible = true
      }
      return
    }

    // Slice around player walkable height to make floor-plan structure readable.
    const sliceMinY = this.floorLevel - 0.3
    const sliceMaxY = this.floorLevel + 2.6
    for (const brush of this.brushMeshes) {
      brush.mesh.visible = brush.maxY >= sliceMinY && brush.minY <= sliceMaxY
    }
  }

  private addSolidBrush(brush: ArenaMap['brushes'][number], material: THREE.Material | string) {
    const mat = typeof material === 'string' ? this.textureManager.getMaterial(material) : material
    const size = new THREE.Vector3(brush.max.x - brush.min.x, brush.max.y - brush.min.y, brush.max.z - brush.min.z)
    const position = new THREE.Vector3(
      (brush.min.x + brush.max.x) * 0.5,
      (brush.min.y + brush.max.y) * 0.5,
      (brush.min.z + brush.max.z) * 0.5,
    )

    const isNonRenderableTexture = (textureName: string | undefined) => {
      if (!textureName) {
        return false
      }
      const name = textureName.toLowerCase()
      return name.includes('common/caulk') || name.includes('common/skip') || name.includes('common/clip')
    }

    const calculateFaceArea = (points: Array<{ x: number; y: number; z: number }>) => {
      if (points.length < 3) return 0
      let area = 0
      const origin = points[0]
      for (let i = 1; i < points.length - 1; i++) {
        const a = points[i]
        const b = points[i + 1]
        const v1 = { x: a.x - origin.x, y: a.y - origin.y, z: a.z - origin.z }
        const v2 = { x: b.x - origin.x, y: b.y - origin.y, z: b.z - origin.z }
        const cross = {
          x: v1.y * v2.z - v1.z * v2.y,
          y: v1.z * v2.x - v1.x * v2.z,
          z: v1.x * v2.y - v1.y * v2.x,
        }
        const magnitude = Math.sqrt(cross.x ** 2 + cross.y ** 2 + cross.z ** 2)
        area += magnitude / 2
      }
      return area
    }

    const triangulateFace = (
      points: Array<{ x: number; y: number; z: number }>,
      normal: { x: number; y: number; z: number },
    ) => {
      const center = {
        x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
        y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
        z: points.reduce((sum, p) => sum + p.z, 0) / points.length,
      }

      const reference = Math.abs(normal.y) < 0.9
        ? { x: 0, y: 1, z: 0 }
        : { x: 1, y: 0, z: 0 }
      const tangentRaw = {
        x: reference.y * normal.z - reference.z * normal.y,
        y: reference.z * normal.x - reference.x * normal.z,
        z: reference.x * normal.y - reference.y * normal.x,
      }
      const tangentLength = Math.sqrt(tangentRaw.x ** 2 + tangentRaw.y ** 2 + tangentRaw.z ** 2)
      if (tangentLength < 0.0001) {
        return [] as number[][]
      }
      const tangent = {
        x: tangentRaw.x / tangentLength,
        y: tangentRaw.y / tangentLength,
        z: tangentRaw.z / tangentLength,
      }
      const bitangent = {
        x: normal.y * tangent.z - normal.z * tangent.y,
        y: normal.z * tangent.x - normal.x * tangent.z,
        z: normal.x * tangent.y - normal.y * tangent.x,
      }

      const projected = points.map((p) => {
        const offset = { x: p.x - center.x, y: p.y - center.y, z: p.z - center.z }
        return new THREE.Vector2(
          offset.x * tangent.x + offset.y * tangent.y + offset.z * tangent.z,
          offset.x * bitangent.x + offset.y * bitangent.y + offset.z * bitangent.z,
        )
      })

      const triangleIndices = THREE.ShapeUtils.triangulateShape(projected, [])
      return triangleIndices
    }

    const getAreaThreshold = () => {
      const isQuakeMap = activeMap.sourceFormat === 'quake-map'
      // BSP files are pre-optimized, so no special thresholds needed
      if (this.detailLevel === 'structure') return isQuakeMap ? 2.0 : 1.0
      if (this.detailLevel === 'major') return isQuakeMap ? 0.35 : 0.1
      return 0
    }

    // Quake .map brushes are convex solids; render as one convex mesh to avoid face-triangulation shards.
    // BSP "brushes" are actually pre-triangulated faces, so they use the standard face rendering path below.
    if (activeMap.sourceFormat === 'quake-map' && brush.points && brush.points.length >= 4) {
      const points = brush.points.map((point) => new THREE.Vector3(point.x, point.y, point.z))
      const preferredTexture = brush.faces?.find((face) => !isNonRenderableTexture(face.texture))?.texture
      const brushMaterial = this.textureManager.getMaterial(preferredTexture || brush.texture || 'default/face')
      const mesh = new THREE.Mesh(new ConvexGeometry(points), brushMaterial)
      mesh.castShadow = true
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.brushMeshes.push({ mesh, minY: brush.min.y, maxY: brush.max.y })
      this.wallBoxes.push(mesh)
      this.ricochetSurfaces.push(mesh)
      this.solidVolumes.push({
        minY: brush.min.y,
        maxY: brush.max.y,
        minX: brush.min.x,
        maxX: brush.max.x,
        minZ: brush.min.z,
        maxZ: brush.max.z,
      })
      return
    }

    if (brush.faces && brush.faces.length > 0) {
      const areaThreshold = getAreaThreshold()
      const group = new THREE.Group()
      for (const face of brush.faces) {
        if (isNonRenderableTexture(face.texture)) {
          continue
        }
        if (!face.points || face.points.length < 3) {
          continue
        }
        if (areaThreshold > 0) {
          const area = calculateFaceArea(face.points)
          if (area < areaThreshold) {
            continue
          }
        }

        const faceMaterial = this.textureManager.getMaterial(face.texture || brush.texture || 'default/face')
        
        // Calculate face normal to ensure correct winding after coordinate transformation
        if (face.points.length < 3) continue
        
        const p0 = face.points[0]
        const p1 = face.points[1]
        const p2 = face.points[2]
        
        const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
        const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z }
        
        // Cross product to get normal
        const normal = {
          x: v1.y * v2.z - v1.z * v2.y,
          y: v1.z * v2.x - v1.x * v2.z,
          z: v1.x * v2.y - v1.y * v2.x,
        }
        
        // Skip degenerate faces (collinear points)
        const normalMagnitude = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
        if (normalMagnitude < 0.0001) {
          continue
        }
        
        // Calculate brush center for orientation check
        const brushCenter = {
          x: (brush.min.x + brush.max.x) * 0.5,
          y: (brush.min.y + brush.max.y) * 0.5,
          z: (brush.min.z + brush.max.z) * 0.5,
        }
        
        // Vector from brush center to face center
        const faceCenter = {
          x: face.points.reduce((sum, p) => sum + p.x, 0) / face.points.length,
          y: face.points.reduce((sum, p) => sum + p.y, 0) / face.points.length,
          z: face.points.reduce((sum, p) => sum + p.z, 0) / face.points.length,
        }
        
        const toFace = {
          x: faceCenter.x - brushCenter.x,
          y: faceCenter.y - brushCenter.y,
          z: faceCenter.z - brushCenter.z,
        }
        
        // Check if normal points outward (dot product should be positive)
        const dotProduct = normal.x * toFace.x + normal.y * toFace.y + normal.z * toFace.z
        const needsReverse = dotProduct < 0
        
        const positions: number[] = []
        const triangles = triangulateFace(face.points, normal)
        for (const tri of triangles) {
          const pa = face.points[tri[0]]
          const pb = face.points[tri[1]]
          const pc = face.points[tri[2]]

          const tv1 = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z }
          const tv2 = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z }
          const tcross = {
            x: tv1.y * tv2.z - tv1.z * tv2.y,
            y: tv1.z * tv2.x - tv1.x * tv2.z,
            z: tv1.x * tv2.y - tv1.y * tv2.x,
          }
          const tarea = Math.sqrt(tcross.x ** 2 + tcross.y ** 2 + tcross.z ** 2) / 2
          if (tarea < 0.00001) {
            continue
          }

          if (needsReverse) {
            positions.push(
              pa.x, pa.y, pa.z,
              pc.x, pc.y, pc.z,
              pb.x, pb.y, pb.z,
            )
          } else {
            positions.push(
              pa.x, pa.y, pa.z,
              pb.x, pb.y, pb.z,
              pc.x, pc.y, pc.z,
            )
          }
        }
        
        // Skip face if no valid triangles
        if (positions.length === 0) {
          continue
        }

        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
        geometry.computeVertexNormals()
        const faceMesh = new THREE.Mesh(geometry, faceMaterial)
        faceMesh.castShadow = true
        faceMesh.receiveShadow = true
        group.add(faceMesh)
        this.ricochetSurfaces.push(faceMesh)
      }

      if (group.children.length > 0) {
        this.scene.add(group)
        this.brushMeshes.push({ mesh: group, minY: brush.min.y, maxY: brush.max.y })
        this.solidVolumes.push({
          minY: brush.min.y,
          maxY: brush.max.y,
          minX: brush.min.x,
          maxX: brush.max.x,
          minZ: brush.min.z,
          maxZ: brush.max.z,
        })
        return
      }
    }

    const points = brush.points?.map((point) => new THREE.Vector3(point.x, point.y, point.z))
    const geometry = points && points.length >= 4
      ? new ConvexGeometry(points)
      : new THREE.BoxGeometry(size.x, size.y, size.z)
    const mesh = new THREE.Mesh(geometry, mat)
    if (!points || points.length < 4) {
      mesh.position.copy(position)
    }
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    this.brushMeshes.push({ mesh, minY: brush.min.y, maxY: brush.max.y })
    this.wallBoxes.push(mesh)
    this.ricochetSurfaces.push(mesh)
    this.solidVolumes.push({
      minY: brush.min.y,
      maxY: brush.max.y,
      minX: brush.min.x,
      maxX: brush.max.x,
      minZ: brush.min.z,
      maxZ: brush.max.z,
    })
  }

  private buildWeapon() {
    const frameMaterial = new THREE.MeshStandardMaterial({
      color: '#262d38',
      emissive: '#0a121b',
      emissiveIntensity: 0.45,
      roughness: 0.34,
      metalness: 0.88,
    })
    const coreMaterial = new THREE.MeshStandardMaterial({
      color: '#5e1622',
      emissive: '#7a2232',
      emissiveIntensity: 0.55,
      roughness: 0.46,
      metalness: 0.42,
    })
    const energyMaterial = new THREE.MeshStandardMaterial({
      color: '#8fd9ff',
      emissive: '#54c2ff',
      emissiveIntensity: 1.2,
      roughness: 0.18,
      metalness: 0.72,
    })
    const gloveMaterial = new THREE.MeshStandardMaterial({
      color: '#40332e',
      emissive: '#150d0c',
      emissiveIntensity: 0.16,
      roughness: 0.92,
      metalness: 0.08,
    })

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.2, 0.5), frameMaterial)
    stock.position.set(-0.05, 0.01, 0)

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.18, 0.34), coreMaterial)
    receiver.position.set(0.2, 0.08, 0)

    const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.12), frameMaterial)
    topRail.position.set(0.16, 0.18, 0)

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.92, 16), frameMaterial)
    barrel.rotation.z = Math.PI / 2
    barrel.position.set(0.62, 0.07, 0)

    const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.24), frameMaterial)
    shroud.position.set(0.48, 0.07, 0)

    const cell = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.14), energyMaterial)
    cell.position.set(0.18, -0.01, 0)

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), energyMaterial)
    sight.position.set(0.42, 0.19, 0)

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.18), gloveMaterial)
    grip.position.set(0.02, -0.16, 0.01)
    grip.rotation.z = -0.18

    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.2), gloveMaterial)
    hand.position.set(0.06, -0.03, 0.02)
    hand.rotation.z = -0.12

    this.muzzleFlash.position.set(0.86, 0.05, 0)
    this.muzzleLight.position.copy(this.muzzleFlash.position)

    this.weapon.add(stock, receiver, topRail, barrel, shroud, cell, sight, grip, hand, this.muzzleFlash, this.muzzleLight)
    this.weapon.position.set(0.52, -0.45, -0.78)
    this.weapon.rotation.set(-0.18, -0.28, -0.1)
    this.camera.add(this.weapon)

    const leftForearm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.18), gloveMaterial)
    leftForearm.position.set(-0.06, -0.12, 0.02)
    leftForearm.rotation.z = 0.24

    const leftPalm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.11, 0.2), gloveMaterial)
    leftPalm.position.set(0.04, 0.01, 0.08)
    leftPalm.rotation.z = 0.38

    const flashlightBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.38, 12), frameMaterial)
    flashlightBody.rotation.x = -Math.PI / 2
    flashlightBody.position.set(0.14, 0.03, -0.08)

    const flashlightHead = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.095, 0.12, 12), coreMaterial)
    flashlightHead.rotation.x = -Math.PI / 2
    flashlightHead.position.set(0.14, 0.03, -0.33)

    this.flashlightGlow.position.set(0.14, 0.03, -0.42)
    this.flashlight.position.copy(this.flashlightGlow.position)
    this.flashlightCore.position.copy(this.flashlightGlow.position)
    // Flashlight shadows cause visible striping with SSAO + bloom, so keep it shadowless.
    this.flashlight.castShadow = false
    this.flashlightCore.castShadow = false
    this.flashlightTarget.position.set(3.2, -0.08, -40)
    this.flashlight.target = this.flashlightTarget
    this.flashlightCore.target = this.flashlightTarget

    this.leftHand.add(
      leftForearm,
      leftPalm,
      flashlightBody,
      flashlightHead,
      this.flashlightGlow,
      this.flashlight,
      this.flashlightCore,
      this.flashlightTarget,
    )
    this.leftHand.position.set(-0.42, -0.38, -0.9)
    this.leftHand.rotation.set(-0.26, 0.16, 0.18)
      this.leftHand.visible = !this.globalIlluminationEnabled
    this.camera.add(this.leftHand)
  }

  private spawnEnemies() {
    for (const [index, spawn] of ENEMY_SPAWNS.entries()) {
      const archetype = this.rollEnemyArchetype()
      const visualKind = this.pickEnemyVisualKind(archetype)
      const visualAsset = this.getEnemyVisualAsset(visualKind)
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
      core.position.y = this.getVisualBodyHeight(visualKind, Boolean(visualAsset))
      hitbox.position.y = this.getVisualBodyHeight(visualKind, Boolean(visualAsset)) + (visualAsset ? 0 : 0.04)

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
      const initialEnemyGround = this.getGroundHeightAt(group.position.x, group.position.z, this.worldCeiling)
      group.position.y = visualAsset ? initialEnemyGround : initialEnemyGround + 1.1
      this.scene.add(group)
      const enemy: Enemy = {
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
        aimHeight: this.getVisualAimHeight(visualKind, archetype.scale),
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

  private getVisualBodyHeight(kind: Enemy['visualKind'], hasModelAsset: boolean) {
    if (!hasModelAsset) {
      return 0
    }
    if (kind === 'zombie') {
      return 0.82
    }
    if (kind === 'blob') {
      return 0.45
    }
    if (kind === 'glub') {
      return 0.88
    }
    return 0.95
  }

  private getVisualAimHeight(kind: Enemy['visualKind'], scale: number) {
    if (kind === 'zombie') {
      return 0.88 * scale
    }
    if (kind === 'blob') {
      return 0.52 * scale
    }
    if (kind === 'glub') {
      return 0.95 * scale
    }
    return 0.12
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

  private pickEnemyVisualKind(archetype: EnemyArchetype): Enemy['visualKind'] {
    if (archetype.name === 'Wisp' && this.enemyVisualAssets.blob) {
      return Math.random() < 0.88 ? 'blob' : this.enemyVisualAssets.zombie ? 'zombie' : 'fallback'
    }
    if (archetype.name === 'Sentinel' && this.enemyVisualAssets.zombie) {
      return Math.random() < 0.76 ? 'zombie' : this.enemyVisualAssets.glub ? 'glub' : 'fallback'
    }
    if ((archetype.name === 'Brute' || archetype.name === 'Archon') && this.enemyVisualAssets.glub) {
      return Math.random() < 0.8 ? 'glub' : this.enemyVisualAssets.zombie ? 'zombie' : 'fallback'
    }
    if (this.enemyVisualAssets.zombie) {
      return 'zombie'
    }
    if (this.enemyVisualAssets.blob) {
      return 'blob'
    }
    if (this.enemyVisualAssets.glub) {
      return 'glub'
    }
    return 'fallback'
  }

  private getEnemyVisualAsset(kind: Enemy['visualKind']) {
    if (kind === 'zombie') {
      return this.enemyVisualAssets.zombie
    }
    if (kind === 'blob') {
      return this.enemyVisualAssets.blob
    }
    if (kind === 'glub') {
      return this.enemyVisualAssets.glub
    }
    return null
  }

  private configureEnemy(enemy: Enemy, archetype: EnemyArchetype) {
    const health = this.rollEnemyHealth(archetype)
    enemy.group.scale.setScalar(archetype.scale)
    if (enemy.visualKind === 'fallback') {
      enemy.core.material = archetype.coreMaterial
    }
    enemy.speed = archetype.speed
    enemy.radius = archetype.radius
    enemy.aimHeight = this.getVisualAimHeight(enemy.visualKind, archetype.scale)
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

  private loop = () => {
    if (this.disposed) {
      return
    }
    this.animationId = requestAnimationFrame(this.loop)
    const delta = Math.min(this.clock.getDelta(), 0.033)
    this.update(delta)
    this.composer.render()
  }

  private update(delta: number) {
    if (this.gameOverActive) {
      return
    }
    if (this.hud.intro.dataset.hidden !== 'true') {
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
    this.updateEnemyBolts(delta)
    this.updateImpacts(delta)
    this.regenerateHealth(delta)
    this.updateFps(delta)
    this.syncHud()
  }

  private updateLook() {
    this.camera.rotation.y = this.yaw
    this.camera.rotation.x = this.pitch
    this.camera.position.copy(this.player)
  }

  private updateMovement(delta: number) {
    const locked = document.pointerLockElement === this.renderer.domElement
    if (locked) {
      this.moveWish.set(0, 0, 0)
      if (this.keys.has('KeyW')) {
        this.moveWish.z -= 1
      }
      if (this.keys.has('KeyS')) {
        this.moveWish.z += 1
      }
      if (this.keys.has('KeyA')) {
        this.moveWish.x -= 1
      }
      if (this.keys.has('KeyD')) {
        this.moveWish.x += 1
      }

      if (this.moveWish.lengthSq() > 0) {
        this.moveWish.normalize()
        this.moveWish.applyAxisAngle(this.upAxis, this.yaw)
        const acceleration = this.flyModeEnabled ? 18 : this.grounded ? 26 : 12
        this.velocity.x += this.moveWish.x * acceleration * delta
        this.velocity.z += this.moveWish.z * acceleration * delta
      } else if (this.grounded || this.flyModeEnabled) {
        const friction = Math.exp(-(this.flyModeEnabled ? 10 : 8) * delta)
        this.velocity.x *= friction
        this.velocity.z *= friction
      }

      const sprinting = this.keys.has('ShiftLeft') && !this.flyModeEnabled
      const speedLimit = this.flyModeEnabled ? 8.2 : sprinting ? 9.2 : 7.1
      const lateralSpeed = horizontalLength(this.velocity)
      if (lateralSpeed > speedLimit) {
        const scale = speedLimit / lateralSpeed
        this.velocity.x *= scale
        this.velocity.z *= scale
      }
    }

    if (this.flyModeEnabled) {
      const ascend = this.keys.has('Space')
      const descend = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')
      const verticalInput = (ascend ? 1 : 0) - (descend ? 1 : 0)
      this.velocity.y = verticalInput * 7.2
      this.wantsJump = false
      this.grounded = false
    } else {
      if (this.wantsJump && this.grounded) {
        this.velocity.y = 8.8
        this.grounded = false
      }
      this.wantsJump = false
      this.velocity.y -= 24 * delta
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
      const supportFloor = this.getGroundHeightAt(this.player.x, this.player.z, this.player.y + 0.4)
      const supportY = supportFloor + this.floorLevel
      if (this.player.y <= supportY) {
        this.player.y = supportY
        this.velocity.y = 0
        this.grounded = true
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
    const bodyMinY = this.player.y - this.floorLevel
    const bodyMaxY = bodyMinY + this.playerBodyHeight
    for (const volume of this.solidVolumes) {
      if (!this.blocksHorizontalMovement(volume)) {
        continue
      }
      if (bodyMaxY < volume.minY || bodyMinY > volume.maxY) {
        continue
      }
      if (
        this.player.x < volume.minX - this.playerRadius ||
        this.player.x > volume.maxX + this.playerRadius ||
        this.player.z < volume.minZ - this.playerRadius ||
        this.player.z > volume.maxZ + this.playerRadius
      ) {
        continue
      }
      const nearestX = clamp(this.player.x, volume.minX, volume.maxX)
      const nearestZ = clamp(this.player.z, volume.minZ, volume.maxZ)
        let deltaX = this.player.x - nearestX
        let deltaZ = this.player.z - nearestZ
        const distanceSq = deltaX * deltaX + deltaZ * deltaZ
        if (distanceSq >= this.playerRadius * this.playerRadius) {
          continue
        }
        if (distanceSq === 0) {
          if (axis === 'x') {
            deltaX = this.player.x < (volume.minX + volume.maxX) * 0.5 ? -1 : 1
          } else {
            deltaZ = this.player.z < (volume.minZ + volume.maxZ) * 0.5 ? -1 : 1
          }
        }
        const distance = Math.max(Math.sqrt(deltaX * deltaX + deltaZ * deltaZ), 0.0001)
        const push = this.playerRadius - distance
        if (axis === 'x') {
          this.player.x += (deltaX / distance) * push
          this.velocity.x = 0
        } else {
          this.player.z += (deltaZ / distance) * push
          this.velocity.z = 0
        }
    }
  }

  private isGroundSurface(volume: SolidVolume) {
    const height = volume.maxY - volume.minY
    const width = volume.maxX - volume.minX
    const depth = volume.maxZ - volume.minZ
    return height <= 1.25 && width >= 4 && depth >= 4
  }

  private blocksHorizontalMovement(volume: SolidVolume) {
    // Imported Quake-style maps often include explicit floor/ceiling slabs as brushes.
    // Those should not block XZ movement/spawn checks, only upright solids should.
    return !this.isGroundSurface(volume)
  }

  private getGroundHeightAt(x: number, z: number, maxY = Number.POSITIVE_INFINITY) {
    let groundY = 0
    for (const volume of this.solidVolumes) {
      if (!this.isGroundSurface(volume)) {
        continue
      }
      if (volume.maxY > maxY) {
        continue
      }
      if (x < volume.minX || x > volume.maxX || z < volume.minZ || z > volume.maxZ) {
        continue
      }
      groundY = Math.max(groundY, volume.maxY)
    }
    return groundY
  }

  private isPositionBlocked(x: number, z: number, padding = 0.45, probeY = this.floorLevel) {
    const bodyMinY = probeY - this.floorLevel
    const bodyMaxY = bodyMinY + this.playerBodyHeight
    return this.solidVolumes.some(
      (volume) =>
        this.blocksHorizontalMovement(volume) &&
        bodyMaxY >= volume.minY &&
        bodyMinY <= volume.maxY &&
        x > volume.minX - padding &&
        x < volume.maxX + padding &&
        z > volume.minZ - padding &&
        z < volume.maxZ + padding,
    )
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
    const bob = Math.sin(this.bobTime * 7.5) * 0.018 * Math.min(speed / 4, 1)
    this.weapon.position.x = 0.52 + Math.sin(this.bobTime * 3.75) * 0.015
    this.weapon.position.y = -0.45 + bob
    this.weapon.position.z = -0.78 + this.flashTimer * 0.08
    this.weapon.rotation.z = -0.08 + bob * 0.9
    this.leftHand.position.x = -0.42 - Math.sin(this.bobTime * 3.75) * 0.012
    this.leftHand.position.y = -0.38 + bob * 0.85
    this.leftHand.position.z = -0.9 + this.flashTimer * 0.025
    this.leftHand.rotation.z = 0.18 - bob * 0.5
    this.flashTimer = Math.max(0, this.flashTimer - delta * 6)
    ;(this.muzzleFlash.material as THREE.MeshBasicMaterial).opacity = this.flashTimer * 0.9
    this.muzzleLight.intensity = this.flashTimer * 9
    if (this.globalIlluminationEnabled) {
      this.flashlight.intensity = 0
      this.flashlightCore.intensity = 0
    } else {
      this.flashlight.intensity = 118 + Math.sin(this.bobTime * 1.4) * 2.5
      this.flashlightCore.intensity = 168 + Math.sin(this.bobTime * 1.9) * 4
    }
    this.hud.damage.style.opacity = String(this.damagePulse)
    this.updateFloatingHits(delta)
    this.damagePulse = Math.max(0, this.damagePulse - delta * 1.2)
  }

  private updateFloatingHits(delta: number) {
    for (let index = this.floatingHits.length - 1; index >= 0; index -= 1) {
      const floatingHit = this.floatingHits[index]
      floatingHit.life = Math.max(0, floatingHit.life - delta)
      const progress = 1 - floatingHit.life / floatingHit.duration
      const opacity = 1 - progress
      const x = floatingHit.offsetX + floatingHit.driftX * progress
      const y = -12 - floatingHit.riseY * progress
      const scale = 0.92 + progress * 0.16
      floatingHit.element.style.opacity = String(opacity)
      floatingHit.element.style.transform = `translate(${x}px, ${y}px) scale(${scale})`
      if (floatingHit.life > 0) {
        continue
      }
      floatingHit.element.remove()
      this.floatingHits.splice(index, 1)
    }
  }

  private shoot() {
    const now = performance.now() * 0.001
    if (now < this.canShootAt) {
      return
    }
    this.canShootAt = now + 0.12
    this.flashTimer = 1

    const shotDirection = this.camera.getWorldDirection(this.aimDirection.clone())
    const muzzlePoint = this.muzzleFlash.getWorldPosition(new THREE.Vector3())
    const shotNodes = this.computeShotNodes(shotDirection)
    this.spawnProjectile(muzzlePoint, shotNodes)
  }

  private computeShotNodes(direction: THREE.Vector3) {
    const nodes: ProjectileNode[] = []
    const rayDirection = direction.clone().normalize()
    const maxRange = 90

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
      this.damageEnemy(directEnemy, initialPoint)
      nodes.push({ point: initialPoint, impactColor: '#ffcf63', damageOnArrival: false })
      return nodes
    }

    nodes.push({ point: initialPoint, impactColor: '#ffcf63', damageOnArrival: false })
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
    let bouncesLeft = 3

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
        nodes.push({ point: bounceHit.point.clone(), enemy: bounceEnemy, impactColor: '#ffcf63', damageOnArrival: true })
        break
      }

      nodes.push({ point: bounceHit.point.clone(), impactColor: '#ffcf63', damageOnArrival: false })
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
      return
    }
    initialDirection.normalize()
    const projectile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.07, PROJECTILE_LENGTH, 10),
      new THREE.MeshBasicMaterial({ color: '#ffd84f', transparent: true, opacity: 0.92 }),
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
      speed: 78,
      remaining: totalDistance,
    })
  }

  private damageEnemy(enemy: Enemy, point: THREE.Vector3) {
    if (enemy.health <= 0) {
      return
    }
    const criticalHit = Math.random() < CRITICAL_HIT_CHANCE
    const damage = criticalHit ? 2 : 1
    const appliedDamage = Math.min(damage, enemy.health)
    enemy.health -= appliedDamage
    this.spawnImpact(point, '#ffcf63')
    this.showHitCounter(appliedDamage, criticalHit)
    if (enemy.health > 0) {
      return
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
  }

  private showHitCounter(damage: number, criticalHit: boolean) {
    const marker = document.createElement('span')
    marker.className = 'hit-counter-value'
    if (criticalHit) {
      marker.classList.add('critical-hit')
    }
    marker.textContent = criticalHit ? `-${damage} CRITICAL HIT` : `-${damage}`

    const floatingHit: FloatingHit = {
      element: marker,
      life: criticalHit ? 0.72 : 0.55,
      duration: criticalHit ? 0.72 : 0.55,
      offsetX: (Math.random() - 0.5) * (criticalHit ? 36 : 28),
      driftX: (Math.random() - 0.5) * (criticalHit ? 24 : 18),
      riseY: (criticalHit ? 48 : 34) + Math.random() * (criticalHit ? 26 : 20),
    }

    marker.style.opacity = '1'
    marker.style.transform = `translate(${floatingHit.offsetX}px, -12px) scale(0.92)`
    this.hud.hitCounter.appendChild(marker)
    this.floatingHits.push(floatingHit)

    if (this.floatingHits.length > 18) {
      const oldest = this.floatingHits.shift()
      oldest?.element.remove()
    }
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

  private spawnImpact(point: THREE.Vector3, color: string) {
    const distance = point.distanceTo(this.camera.position)
    const radius = 0.045 * clamp(1.15 - distance / 70, 0.3, 1)
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 8, 8), material)
    mesh.position.copy(point)
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
        if (node.impactColor) {
          this.spawnImpact(node.point, node.impactColor)
        }
        if (node.enemy && node.damageOnArrival) {
          this.damageEnemy(node.enemy, node.point)
          this.disposeProjectile(index)
          travel = 0
          break
        }
      }

      ;(projectile.mesh.material as THREE.MeshBasicMaterial).opacity = clamp(projectile.remaining / 10, 0, 0.92)
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
    for (const enemy of this.enemies) {
      enemy.mixer?.update(delta)

      if (enemy.health <= 0) {
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
      const next = this.enemyLoopNext.copy(enemy.group.position).addScaledVector(desired, delta)
      if (!this.isPositionBlocked(next.x, next.z, enemy.radius)) {
        enemy.group.position.copy(next)
      }

      const enemyGround = this.getGroundHeightAt(enemy.group.position.x, enemy.group.position.z, this.worldCeiling)
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

      if (distance > 2.6 && distance < 28 && now >= enemy.canShootAt) {
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

      if (distance < 1.9) {
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
    this.healthValue = Math.max(0, this.healthValue - amount)
    this.damagePulse = Math.min(0.75, this.damagePulse + amount * 0.015)
    if (this.healthValue > 0) {
      return
    }
    const finalScore = Math.max(0, this.scoreValue)
    if (finalScore > 0) {
      void this.recordHighScore(finalScore)
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
    this.player.copy(this.resolveOpenSpawn(PLAYER_SPAWN, PLAYER_SPAWN.y))
    this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.worldCeiling) + this.floorLevel
    this.velocity.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
    this.scoreValue = Math.max(0, this.scoreValue - 1)
    this.hud.gameOver.setAttribute('data-hidden', 'true')
    this.hud.intro.dataset.hidden = 'true'
    this.hud.status.textContent = 'Suit reconstructed. Re-entering the arena.'
    this.requestPointerLock()
  }

  private handleMainMenu = () => {
    // Reset game over state and show intro menu
    this.gameOverActive = false
    this.healthValue = 100
    this.player.copy(this.resolveOpenSpawn(PLAYER_SPAWN, PLAYER_SPAWN.y))
    this.player.y = this.getGroundHeightAt(this.player.x, this.player.z, this.worldCeiling) + this.floorLevel
    this.velocity.set(0, 0, 0)
    this.yaw = 0
    this.pitch = 0
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
    this.hud.hint.textContent = document.pointerLockElement === this.renderer.domElement
      ? 'WASD move  SHIFT surge  SPACE jump  MOUSE fire'
      : 'Click engage to capture the mouse'
  }

  private drawMinimap() {
    const canvas = this.hud.minimap
    const context = this.minimapContext
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
      const normalizedX = clamp((x - WORLD_MIN_X) / Math.max(WORLD_WIDTH, 0.001), 0, 1)
      const normalizedZ = clamp((z - WORLD_MIN_Z) / Math.max(WORLD_HEIGHT, 0.001), 0, 1)
      return {
        x: padding + normalizedX * usable,
        y: padding + normalizedZ * usable,
      }
    }

    context.fillStyle = 'rgba(156, 125, 104, 0.9)'
    for (const brush of activeMap.brushes) {
      const min = toMapPoint(brush.min.x, brush.min.z)
      const max = toMapPoint(brush.max.x, brush.max.z)
      context.fillRect(min.x, min.y, Math.max(1, max.x - min.x), Math.max(1, max.y - min.y))
    }

    for (const enemy of this.enemies) {
      if (enemy.health <= 0 || !enemy.group.visible) {
        continue
      }
      const point = toMapPoint(enemy.group.position.x, enemy.group.position.z)
      context.beginPath()
      context.fillStyle = '#ff7d66'
      context.arc(point.x, point.y, 3.8, 0, Math.PI * 2)
      context.fill()
    }

    const playerPoint = toMapPoint(this.player.x, this.player.z)
    context.beginPath()
    context.fillStyle = '#f3dfb2'
    context.arc(playerPoint.x, playerPoint.y, 4.6, 0, Math.PI * 2)
    context.fill()

    const headingLength = 14
    const rightLength = 5
    const headingX = -Math.sin(this.yaw)
    const headingY = -Math.cos(this.yaw)
    context.beginPath()
    context.moveTo(playerPoint.x + headingX * headingLength, playerPoint.y + headingY * headingLength)
    context.lineTo(playerPoint.x - headingX * 5 + headingY * rightLength, playerPoint.y - headingY * 5 - headingX * rightLength)
    context.lineTo(playerPoint.x - headingX * 5 - headingY * rightLength, playerPoint.y - headingY * 5 + headingX * rightLength)
    context.closePath()
    context.fillStyle = '#d8aa57'
    context.fill()
  }
}

export const startGame = async (root: HTMLDivElement) => {
  const selectedMapId = new URLSearchParams(window.location.search).get('map') ?? 'cathedral-cavern'
  const [loadedMap, availableMaps, zombieAsset, blobAsset, glubAsset] = await Promise.all([
    loadArenaMap(selectedMapId),
    loadAvailableMaps(),
    loadZombieEnemyAsset(),
    loadBlobEnemyAsset(),
    loadGlubEnemyAsset(),
  ])
  configureMap(loadedMap)

  root.innerHTML = `
    <div class="game-shell">
      <div class="render-host"></div>
      <div class="health-bar-container" aria-hidden="true">
        <div class="health-bar-fill" data-health-bar></div>
      </div>
      <div class="hud-panel hud-top">
        <span class="hud-chip">Health <strong data-health>100</strong></span>
        <span class="hud-chip">Kills <strong data-score>00</strong></span>
        <span class="hud-chip">Targets <strong data-targets>0</strong></span>
        <span class="hud-chip">FPS <strong data-fps>00</strong></span>
      </div>
      <div class="minimap-panel" aria-hidden="true">
        <canvas class="minimap-canvas" data-minimap width="352" height="352"></canvas>
      </div>
      <div class="flashlight-falloff" aria-hidden="true"></div>
      <div class="light-stencil" aria-hidden="true"></div>
      <div class="hit-counter-layer" data-hit-counter aria-hidden="true"></div>
      <div class="crosshair" aria-hidden="true"></div>
      <div class="damage-vignette" aria-hidden="true"></div>
      <div class="game-over-overlay" data-game-over data-hidden="true">
        <h2>SUIT BREACH</h2>
        <p class="game-over-message">Photonic systems offline</p>
        <p class="final-score-display">Kills: <strong data-final-score>0</strong></p>
        <button type="button" data-respawn>Reconstruct Suit</button>
        <button type="button" class="secondary-button" data-main-menu>Return to Main Menu</button>
      </div>
      <div class="intro-card" data-intro data-hidden="false">
        <p class="eyebrow">${loadedMap.name}</p>
        <h1>PHOTONIC</h1>
        <p class="intro-copy">${loadedMap.description}</p>
        <div class="map-selector">
          <label class="map-selector-label">Select Arena:</label>
          <div class="map-buttons">
            ${availableMaps.map(map => `
              <button type="button" class="map-button ${map.id === loadedMap.id ? 'active' : ''}" data-map-id="${map.id}">
                ${map.name}
              </button>
            `).join('')}
          </div>
        </div>
        <button type="button" data-start>Engage Arena</button>
        <p class="status-line" data-status>Click engage, then clear the sentinels.</p>
        <p class="hint-line" data-hint>WASD move  SHIFT surge  SPACE jump  MOUSE fire</p>
      </div>
    </div>
  `

  const shell = root.querySelector<HTMLDivElement>('.game-shell')
  const host = root.querySelector<HTMLDivElement>('.render-host')
  const intro = root.querySelector<HTMLDivElement>('[data-intro]')
  const startButton = root.querySelector<HTMLButtonElement>('[data-start]')
  const gameOver = root.querySelector<HTMLDivElement>('[data-game-over]')
  const respawnButton = root.querySelector<HTMLButtonElement>('[data-respawn]')
  const mainMenuButton = root.querySelector<HTMLButtonElement>('[data-main-menu]')
  const finalScore = root.querySelector<HTMLSpanElement>('[data-final-score]')
  const status = root.querySelector<HTMLParagraphElement>('[data-status]')
  const health = root.querySelector<HTMLSpanElement>('[data-health]')
  const healthBar = root.querySelector<HTMLDivElement>('[data-health-bar]')
  const score = root.querySelector<HTMLSpanElement>('[data-score]')
  const targets = root.querySelector<HTMLSpanElement>('[data-targets]')
  const fps = root.querySelector<HTMLSpanElement>('[data-fps]')
  const hint = root.querySelector<HTMLParagraphElement>('[data-hint]')
  const damage = root.querySelector<HTMLDivElement>('.damage-vignette')
  const hitCounter = root.querySelector<HTMLDivElement>('[data-hit-counter]')
  const minimap = root.querySelector<HTMLCanvasElement>('[data-minimap]')

  if (!shell || !host || !intro || !startButton || !gameOver || !respawnButton || !mainMenuButton || !finalScore || !status || !health || !healthBar || !score || !targets || !fps || !hint || !damage || !hitCounter || !minimap) {
    throw new Error('Game UI failed to mount')
  }

  const mapButtons = root.querySelectorAll<HTMLButtonElement>('.map-button')
  mapButtons.forEach(button => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const mapId = button.getAttribute('data-map-id')
      if (mapId) {
        // Exit pointer lock before changing maps to prevent auto-start
        if (document.pointerLockElement) {
          document.exitPointerLock()
          // Brief delay to ensure pointer lock is fully released
          setTimeout(() => {
            window.location.search = `?map=${mapId}`
          }, 50)
        } else {
          window.location.search = `?map=${mapId}`
        }
      }
    })
  })

  const game = new VibeQuake(host, {
    shell,
    intro,
    startButton,
    gameOver,
    respawnButton,
    mainMenuButton,
    finalScore,
    status,
    health,
    healthBar,
    score,
    targets,
    fps,
    hint,
    damage,
    hitCounter,
    minimap,
  }, {
    zombie: zombieAsset,
    blob: blobAsset,
    glub: glubAsset,
  })

  window.addEventListener('beforeunload', () => game.dispose(), { once: true })
}