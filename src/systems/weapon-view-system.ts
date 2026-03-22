import * as THREE from 'three'

type BuildWeaponViewOptions = {
  camera: THREE.PerspectiveCamera
  weapon: THREE.Group
  leftHand: THREE.Group
  muzzleFlash: THREE.Mesh
  muzzleLight: THREE.PointLight
  flashlightGlow: THREE.Mesh
  flashlight: THREE.SpotLight
  flashlightCore: THREE.SpotLight
  flashlightTarget: THREE.Object3D
  globalIlluminationEnabled: boolean
}

export const buildWeaponView = (options: BuildWeaponViewOptions) => {
  const frameMaterial = new THREE.MeshStandardMaterial({
    color: '#39322d',
    emissive: '#120d0a',
    emissiveIntensity: 0.16,
    roughness: 0.58,
    metalness: 0.72,
  })
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: '#5a3327',
    emissive: '#22120d',
    emissiveIntensity: 0.12,
    roughness: 0.72,
    metalness: 0.36,
  })
  const energyMaterial = new THREE.MeshStandardMaterial({
    color: '#c8a15f',
    emissive: '#3d2412',
    emissiveIntensity: 0.18,
    roughness: 0.36,
    metalness: 0.82,
  })
  const gloveMaterial = new THREE.MeshStandardMaterial({
    color: '#40332e',
    emissive: '#150d0c',
    emissiveIntensity: 0.16,
    roughness: 0.92,
    metalness: 0.08,
  })

  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.54), frameMaterial)
  stock.position.set(-0.08, 0.02, 0)

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.2, 0.36), coreMaterial)
  receiver.position.set(0.18, 0.09, 0)

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.13), frameMaterial)
  topRail.position.set(0.12, 0.2, 0)

  const chamber = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.28), energyMaterial)
  chamber.position.set(0.04, 0.08, 0)

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.84, 16), frameMaterial)
  barrel.rotation.z = Math.PI / 2
  barrel.position.set(0.58, 0.08, 0)

  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.26), frameMaterial)
  shroud.position.set(0.42, 0.08, 0)

  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.12, 0.22), coreMaterial)
  pump.position.set(0.46, -0.04, 0)

  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.09, 0.15), energyMaterial)
  cell.position.set(0.14, -0.02, 0)

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.1), energyMaterial)
  sight.position.set(0.36, 0.21, 0)

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.18), gloveMaterial)
  grip.position.set(0.02, -0.16, 0.01)
  grip.rotation.z = -0.18

  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.2), gloveMaterial)
  hand.position.set(0.06, -0.03, 0.02)
  hand.rotation.z = -0.12

  options.muzzleFlash.position.set(0.86, 0.05, 0)
  options.muzzleLight.position.copy(options.muzzleFlash.position)

  options.weapon.add(stock, receiver, topRail, chamber, barrel, shroud, pump, cell, sight, grip, hand, options.muzzleFlash, options.muzzleLight)
  options.weapon.position.set(0.52, -0.45, -0.78)
  options.weapon.rotation.set(-0.16, -0.26, -0.08)
  options.camera.add(options.weapon)

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

  options.flashlightGlow.position.set(0.14, 0.03, -0.42)
  options.flashlight.position.copy(options.flashlightGlow.position)
  options.flashlightCore.position.copy(options.flashlightGlow.position)
  // Flashlight shadows cause visible striping with SSAO + bloom, so keep it shadowless.
  options.flashlight.castShadow = false
  options.flashlightCore.castShadow = false
  options.flashlightTarget.position.set(3.2, -0.08, -40)
  options.flashlight.target = options.flashlightTarget
  options.flashlightCore.target = options.flashlightTarget

  options.leftHand.add(
    leftForearm,
    leftPalm,
    flashlightBody,
    flashlightHead,
    options.flashlightGlow,
    options.flashlight,
    options.flashlightCore,
    options.flashlightTarget,
  )
  options.leftHand.position.set(-0.42, -0.38, -0.9)
  options.leftHand.rotation.set(-0.26, 0.16, 0.18)
  options.leftHand.visible = !options.globalIlluminationEnabled
  options.camera.add(options.leftHand)
}
