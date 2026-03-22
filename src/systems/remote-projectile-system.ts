import * as THREE from 'three'

export type RemoteProjectilePayload = {
  position: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
  tier: number
}

export function spawnRemoteProjectileVisual(scene: THREE.Scene, projectile: RemoteProjectilePayload) {
  // Create a visual projectile only; it does not apply gameplay damage.
  const colors = ['#ffcf63', '#ff9e57', '#76f7ff']
  const color = colors[projectile.tier] || colors[0]

  const geometry = new THREE.SphereGeometry(0.035 + projectile.tier * 0.015, 6, 6)
  const material = new THREE.MeshBasicMaterial({ color })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(projectile.position.x, projectile.position.y, projectile.position.z)

  const light = new THREE.PointLight(color, 2, 5, 2)
  mesh.add(light)
  scene.add(mesh)

  const direction = new THREE.Vector3(projectile.direction.x, projectile.direction.y, projectile.direction.z)
  const velocity = direction.multiplyScalar(40)

  const startTime = Date.now()
  const duration = 2000

  const animate = () => {
    const elapsed = Date.now() - startTime
    if (elapsed > duration) {
      scene.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      return
    }

    mesh.position.addScaledVector(velocity, 0.016)
    requestAnimationFrame(animate)
  }

  animate()
}
