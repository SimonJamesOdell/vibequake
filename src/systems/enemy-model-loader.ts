import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export type EnemyModelAsset = {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

export type EnemyVisualAssets = {
  zombie: EnemyModelAsset | null
  blob: EnemyModelAsset | null
  glub: EnemyModelAsset | null
}

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

export const loadZombieEnemyAsset = async () => {
  if (!zombieAssetPromise) {
    zombieAssetPromise = loadEnemyModelAsset(ZOMBIE_MODEL_PATH, 1.6)
  }

  return zombieAssetPromise
}

export const loadBlobEnemyAsset = async () => {
  if (!blobAssetPromise) {
    blobAssetPromise = loadEnemyModelAsset(BLOB_MODEL_PATH, 1.15)
  }

  return blobAssetPromise
}

export const loadGlubEnemyAsset = async () => {
  if (!glubAssetPromise) {
    glubAssetPromise = loadEnemyModelAsset(GLUB_MODEL_PATH, 1.75)
  }

  return glubAssetPromise
}

import type { EnemyVisualKind } from './enemy-archetypes'

export function getEnemyVisualAsset(
  kind: EnemyVisualKind,
  assets: EnemyVisualAssets,
): EnemyModelAsset | null {
  if (kind === 'zombie') return assets.zombie
  if (kind === 'blob') return assets.blob
  if (kind === 'glub') return assets.glub
  return null
}

export function pickEnemyVisualKind(
  archetypeName: string,
  assets: EnemyVisualAssets,
): EnemyVisualKind {
  if (archetypeName === 'Wisp' && assets.blob) {
    return Math.random() < 0.88 ? 'blob' : assets.zombie ? 'zombie' : 'fallback'
  }
  if (archetypeName === 'Sentinel' && assets.zombie) {
    return Math.random() < 0.76 ? 'zombie' : assets.glub ? 'glub' : 'fallback'
  }
  if ((archetypeName === 'Brute' || archetypeName === 'Archon') && assets.glub) {
    return Math.random() < 0.8 ? 'glub' : assets.zombie ? 'zombie' : 'fallback'
  }
  if (assets.zombie) return 'zombie'
  if (assets.blob) return 'blob'
  if (assets.glub) return 'glub'
  return 'fallback'
}
