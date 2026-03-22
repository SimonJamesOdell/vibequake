import * as THREE from 'three'
import type { ArenaMap } from '../shared/contracts'

export type WeaponUpgradePickup = {
  group: THREE.Group
  light: THREE.PointLight
  basePosition: THREE.Vector3
  tier: 1 | 2
  spinOffset: number
  collected: boolean
}

export class WeaponPickupSystem {
  private readonly pickups: WeaponUpgradePickup[] = []

  constructor() {}

  getPickups() {
    return this.pickups
  }

  spawn(
    scene: THREE.Scene,
    map: ArenaMap,
    floorLevel: number,
    resolveOpenSpawnFn: (pos: THREE.Vector3, y: number, padding: number) => THREE.Vector3,
  ) {
    // Clear old pickups
    for (const pickup of this.pickups) {
      scene.remove(pickup.group)
      pickup.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      })
    }
    this.pickups.length = 0

    // Only spawn on abyssal family maps
    if (map.id !== 'abyssal-grotto' && map.id !== 'abyssal-grotto-prime') {
      return
    }

    const pickupSpecs: Array<{ tier: 1 | 2; x: number; z: number }> = [
      // Hidden toward opposite corners of the arena.
      { tier: 1, x: map.bounds.min.x + 5.4, z: map.bounds.max.z - 6.2 },
      { tier: 2, x: map.bounds.max.x - 6.1, z: map.bounds.min.z + 5.1 },
    ]

    for (const spec of pickupSpecs) {
      const color = spec.tier === 1 ? '#ffb96b' : '#85fbff'
      const emissive = spec.tier === 1 ? '#ff7f42' : '#35b8d2'
      const spawn = resolveOpenSpawnFn(new THREE.Vector3(spec.x, floorLevel + 0.6, spec.z), floorLevel + 0.5, 0.6)

      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.25, 0),
        new THREE.MeshStandardMaterial({
          color,
          emissive,
          emissiveIntensity: 1.1,
          roughness: 0.25,
          metalness: 0.6,
        }),
      )
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.04, 8, 24),
        new THREE.MeshStandardMaterial({
          color: '#0d1018',
          emissive: color,
          emissiveIntensity: 0.95,
          roughness: 0.2,
          metalness: 0.8,
        }),
      )
      ring.rotation.x = Math.PI / 2

      const group = new THREE.Group()
      group.add(core, ring)
      group.position.copy(spawn)
      group.position.y += 0.5
      group.userData.id = `${map.id}-pickup-tier-${spec.tier}`

      const light = new THREE.PointLight(color, spec.tier === 1 ? 3 : 4.2, spec.tier === 1 ? 9 : 11, 2)
      light.position.y = 0.18
      group.add(light)
      scene.add(group)

      this.pickups.push({
        group,
        light,
        basePosition: group.position.clone(),
        tier: spec.tier,
        spinOffset: Math.random() * Math.PI * 2,
        collected: false,
      })
    }
  }

  reset() {
    // Note: This method receives weaponUpgradeTier as a parameter but doesn't modify it
    // The caller updates weaponUpgradeTier directly
    for (const pickup of this.pickups) {
      pickup.collected = false
      pickup.group.visible = true
      pickup.group.position.copy(pickup.basePosition)
      pickup.light.intensity = pickup.tier === 1 ? 3 : 4.2
    }
  }

  update(
    delta: number,
    playerPosition: THREE.Vector3,
    isMultiplayerJoinedFn: () => boolean,
    sendCollectPickupFn: (id: string) => void,
    spawnImpactFn: (point: THREE.Vector3, color: string, sizeScale: number) => void,
    onCollectedFn: (tier: 1 | 2, message: string) => void,
  ): { maxTier: number } {
    if (this.pickups.length === 0) {
      return { maxTier: 0 }
    }

    const now = performance.now() * 0.001
    let maxTier = 0

    for (const pickup of this.pickups) {
      if (pickup.collected) {
        continue
      }

      const bob = Math.sin(now * 2.6 + pickup.spinOffset) * 0.08
      pickup.group.position.y = pickup.basePosition.y + bob
      pickup.group.rotation.y += delta * (0.9 + pickup.tier * 0.35)
      pickup.group.rotation.x = Math.sin(now * 1.4 + pickup.spinOffset) * 0.12

      const distance = pickup.group.position.distanceTo(playerPosition)
      if (distance > 1.25) {
        continue
      }

      pickup.collected = true
      pickup.group.visible = false
      pickup.light.intensity = 0
      maxTier = Math.max(maxTier, pickup.tier)

      // Send pickup collection to server for multiplayer sync
      if (isMultiplayerJoinedFn() && pickup.group.userData.id) {
        sendCollectPickupFn(pickup.group.userData.id)
      }

      const burstColor = pickup.tier === 1 ? '#ff9e57' : '#76f7ff'
      spawnImpactFn(pickup.group.position, burstColor, pickup.tier === 1 ? 1.8 : 2.4)

      const message =
        pickup.tier === 1
          ? 'Weapon upgrade found: Pulse Core I online.'
          : 'Weapon upgrade found: Pulse Core II online. Firepower maxed.'
      onCollectedFn(pickup.tier, message)
    }

    return { maxTier }
  }

  markCollected(pickupId: string) {
    const pickup = this.pickups.find((p) => p.group.userData.id === pickupId)
    if (pickup) {
      pickup.collected = true
      pickup.group.visible = false
      pickup.light.intensity = 0
    }
  }

  syncFromRoom(room: { pickups: Record<string, { collected: boolean }> }) {
    for (const pickup of this.pickups) {
      const pickupId = pickup.group.userData.id as string | undefined
      if (!pickupId) {
        continue
      }
      const sharedPickup = room.pickups[pickupId]
      if (!sharedPickup) {
        continue
      }
      pickup.collected = sharedPickup.collected
      pickup.group.visible = !sharedPickup.collected
      pickup.light.intensity = sharedPickup.collected ? 0 : pickup.tier === 1 ? 3 : 4.2
    }
  }

  getPickupSnapshot() {
    return this.pickups.map((pickup) => ({
      collected: pickup.collected,
      x: pickup.group.position.x,
      z: pickup.group.position.z,
    }))
  }

  dispose() {
    for (const pickup of this.pickups) {
      pickup.group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      })
    }
    this.pickups.length = 0
  }
}
