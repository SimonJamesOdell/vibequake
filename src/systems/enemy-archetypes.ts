export type EnemyVisualKind = 'zombie' | 'blob' | 'glub' | 'fallback'

export type EnemyArchetypePreset = {
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

export const ENEMY_ARCHETYPE_PRESETS: EnemyArchetypePreset[] = [
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

export function getVisualBodyHeight(kind: EnemyVisualKind, hasModelAsset: boolean): number {
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

export function getVisualAimHeight(kind: EnemyVisualKind, scale: number): number {
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

export function getEnemyVisualScaleMultiplier(kind: EnemyVisualKind): number {
  return kind === 'blob' ? 3 : 1
}
