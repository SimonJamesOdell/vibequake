import * as THREE from 'three'

import type { PlayerState } from '../shared/multiplayer'

export function createRemotePlayerAvatar() {
  const avatar = new THREE.Group()

  const suitMaterial = new THREE.MeshStandardMaterial({
    color: '#2f7dff',
    emissive: '#123e93',
    emissiveIntensity: 0.28,
    metalness: 0.35,
    roughness: 0.55,
  })
  const armorMaterial = new THREE.MeshStandardMaterial({
    color: '#e6f2ff',
    metalness: 0.58,
    roughness: 0.24,
  })
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: '#8be9ff',
    emissive: '#5fd4ff',
    emissiveIntensity: 0.55,
    metalness: 0.2,
    roughness: 0.2,
  })
  const weaponMaterial = new THREE.MeshStandardMaterial({
    color: '#28303f',
    emissive: '#8be9ff',
    emissiveIntensity: 0.16,
    metalness: 0.52,
    roughness: 0.36,
  })

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.34), suitMaterial)
  torso.position.set(0, 1.18, 0)
  torso.castShadow = true
  avatar.add(torso)

  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.12, 0.36), armorMaterial)
  shoulders.position.set(0, 1.58, 0)
  shoulders.castShadow = true
  avatar.add(shoulders)

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 14), armorMaterial)
  head.position.set(0, 1.82, 0)
  head.castShadow = true
  avatar.add(head)

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.1, 0.2), visorMaterial)
  visor.position.set(0, 1.82, 0.13)
  visor.castShadow = true
  avatar.add(visor)

  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.46, 4, 8), suitMaterial)
    arm.position.set(0.33 * side, 1.22, 0)
    arm.castShadow = true
    avatar.add(arm)

    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.56, 4, 8), suitMaterial)
    leg.position.set(0.15 * side, 0.58, 0)
    leg.castShadow = true
    avatar.add(leg)

    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.28), armorMaterial)
    boot.position.set(0.15 * side, 0.2, 0.05)
    boot.castShadow = true
    avatar.add(boot)
  }

  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.6), weaponMaterial)
  weapon.position.set(0.28, 1.08, 0.24)
  weapon.rotation.x = 0.12
  weapon.castShadow = true
  avatar.add(weapon)

  return avatar
}

export type RemotePlayerVisual = {
  state: PlayerState
  mesh: THREE.Group
  nameLabel: THREE.Sprite
}

type AvatarSystemOptions = {
  scene: THREE.Scene
  getAvatarBaseY: (playerEyeY: number) => number
}

export class AvatarSystem {
  private readonly scene: THREE.Scene
  private readonly getAvatarBaseY: (playerEyeY: number) => number
  private readonly remotePlayers = new Map<string, RemotePlayerVisual>()

  constructor(options: AvatarSystemOptions) {
    this.scene = options.scene
    this.getAvatarBaseY = options.getAvatarBaseY
  }

  hasRemotePlayer(playerId: string) {
    return this.remotePlayers.has(playerId)
  }

  getRemotePlayer(playerId: string) {
    return this.remotePlayers.get(playerId)
  }

  getRemotePlayerIds() {
    return this.remotePlayers.keys()
  }

  getRemotePlayers() {
    return this.remotePlayers.values()
  }

  upsertRemotePlayer(player: PlayerState) {
    const existing = this.remotePlayers.get(player.id)
    if (existing) {
      this.updateRemotePlayer(player.id, player)
      return
    }

    const mesh = this.createRemotePlayerAvatar()
    const avatarY = this.getAvatarBaseY(player.position.y)
    mesh.position.set(player.position.x, avatarY, player.position.z)
    mesh.castShadow = true
    this.scene.add(mesh)

    const sprite = this.createNameLabel(player.name)
    sprite.position.set(player.position.x, avatarY + 2.2, player.position.z)
    this.scene.add(sprite)

    this.remotePlayers.set(player.id, {
      state: {
        ...player,
        position: { ...player.position },
      },
      mesh,
      nameLabel: sprite,
    })
  }

  updateRemotePlayer(playerId: string, state: Partial<PlayerState>) {
    const remotePlayer = this.remotePlayers.get(playerId)
    if (!remotePlayer) {
      return
    }

    Object.assign(remotePlayer.state, state)

    if (state.position) {
      remotePlayer.state.position = { ...state.position }
      const avatarY = this.getAvatarBaseY(state.position.y)
      remotePlayer.mesh.position.set(state.position.x, avatarY, state.position.z)
      remotePlayer.nameLabel.position.set(state.position.x, avatarY + 2.2, state.position.z)
    }

    if (state.yaw !== undefined) {
      remotePlayer.mesh.rotation.y = state.yaw
    }

    if (state.name && state.name !== remotePlayer.state.name) {
      remotePlayer.state.name = state.name
      this.updateNameLabelTexture(remotePlayer.nameLabel, state.name)
    }
  }

  removeRemotePlayer(playerId: string) {
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

  clearAll() {
    for (const playerId of Array.from(this.remotePlayers.keys())) {
      this.removeRemotePlayer(playerId)
    }
  }

  private createNameLabel(name: string) {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    canvas.width = 256
    canvas.height = 64
    context.fillStyle = 'rgba(0, 0, 0, 0.6)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = 'bold 24px sans-serif'
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.fillText(name, canvas.width / 2, canvas.height / 2 + 8)

    const texture = new THREE.CanvasTexture(canvas)
    const material = new THREE.SpriteMaterial({ map: texture })
    const sprite = new THREE.Sprite(material)
    sprite.scale.set(2, 0.5, 1)
    return sprite
  }

  private updateNameLabelTexture(sprite: THREE.Sprite, name: string) {
    const material = sprite.material as THREE.SpriteMaterial
    const texture = material.map
    if (!texture || !(texture.image instanceof HTMLCanvasElement)) {
      return
    }
    const canvas = texture.image
    const context = canvas.getContext('2d')
    if (!context) {
      return
    }

    context.clearRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = 'rgba(0, 0, 0, 0.6)'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.font = 'bold 24px sans-serif'
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.fillText(name, canvas.width / 2, canvas.height / 2 + 8)
    texture.needsUpdate = true
  }

  private createRemotePlayerAvatar() {
    return createRemotePlayerAvatar()
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
}
