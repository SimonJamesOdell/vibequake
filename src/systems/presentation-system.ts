import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { BrushSolid } from '../shared/contracts'

type BuildIndustrialRustPresentationOptions = {
  brushes: BrushSolid[]
  worldCeiling: number
  worldMinX: number
  worldMaxX: number
  worldMinZ: number
  worldMaxZ: number
  worldWidth: number
  worldHeight: number
  addPresentationMesh: (mesh: THREE.Object3D, minY: number, maxY: number) => void
}

/**
 * Builds industrial-rust visual dressing: wall ribs, floor trim, elevated platform
 * supports, ceiling beams, pipe bundles, and vault arches with hanging lanterns.
 * Pure construction — reads brush geometry and emits presentation meshes via the
 * `addPresentationMesh` callback; no game-state mutations.
 */
export function buildIndustrialRustPresentation({
  brushes,
  worldCeiling,
  worldMinX,
  worldMaxX,
  worldMinZ,
  worldMaxZ,
  worldWidth,
  worldHeight,
  addPresentationMesh,
}: BuildIndustrialRustPresentationOptions): void {
  const centerX = (worldMinX + worldMaxX) * 0.5
  const centerZ = (worldMinZ + worldMaxZ) * 0.5
  const supportMaterial = new THREE.MeshStandardMaterial({
    color: '#8c7363',
    emissive: '#3a2a22',
    emissiveIntensity: 0.2,
    roughness: 0.82,
    metalness: 0.52,
  })
  const plateMaterial = new THREE.MeshStandardMaterial({
    color: '#786055',
    emissive: '#31211a',
    emissiveIntensity: 0.16,
    roughness: 0.9,
    metalness: 0.24,
  })
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: '#b58a69',
    emissive: '#5b3a26',
    emissiveIntensity: 0.2,
    roughness: 0.7,
    metalness: 0.6,
  })
  const grateMaterial = new THREE.MeshStandardMaterial({
    color: '#6d6f70',
    emissive: '#2f2f2e',
    emissiveIntensity: 0.12,
    roughness: 0.62,
    metalness: 0.76,
  })
  const pipeMaterial = new THREE.MeshStandardMaterial({
    color: '#8a7060',
    emissive: '#36261f',
    emissiveIntensity: 0.14,
    roughness: 0.74,
    metalness: 0.66,
  })

  const addDecorBox = (
    group: THREE.Group,
    size: THREE.Vector3,
    position: THREE.Vector3,
    material: THREE.Material,
    castShadow = false,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material)
    mesh.position.copy(position)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const addDecorHull = (
    group: THREE.Group,
    points: THREE.Vector3[],
    material: THREE.Material,
    castShadow = false,
  ) => {
    const mesh = new THREE.Mesh(new ConvexGeometry(points), material)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const addDecorStrut = (
    group: THREE.Group,
    start: THREE.Vector3,
    end: THREE.Vector3,
    radius: number,
    material: THREE.Material,
    radialSegments = 10,
  ) => {
    const delta = new THREE.Vector3().subVectors(end, start)
    const length = delta.length()
    if (length <= 0.001) {
      return
    }
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, radialSegments), material)
    mesh.position.copy(start).add(end).multiplyScalar(0.5)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  const majorWalls = brushes.filter((brush) => {
    const width = brush.max.x - brush.min.x
    const depth = brush.max.z - brush.min.z
    const height = brush.max.y - brush.min.y
    return height >= 5 && ((width <= 3.2 && depth >= 9) || (depth <= 3.2 && width >= 9))
  }).slice(0, 18)

  for (const [index, brush] of majorWalls.entries()) {
    const width = brush.max.x - brush.min.x
    const depth = brush.max.z - brush.min.z
    const height = brush.max.y - brush.min.y
    const xThin = width <= depth
    const span = xThin ? depth : width
    const wallThickness = xThin ? width : depth
    const centerX = (brush.min.x + brush.max.x) * 0.5
    const centerZ = (brush.min.z + brush.max.z) * 0.5
    const ribY = brush.min.y + height * 0.5
    const ribHeight = Math.max(2.8, height - 1.1)
    const trimYLow = brush.min.y + 0.5
    const trimYHigh = brush.max.y - 0.45
    const ribCount = Math.max(2, Math.min(5, Math.floor((span - 2.4) / 5.2) + 1))
    const group = new THREE.Group()

    const capSpan = Math.max(2.6, span - 1.2)
    const capRise = Math.min(2.6, Math.max(1.15, height * 0.16))
    if (xThin) {
      addDecorHull(
        group,
        [
          new THREE.Vector3(centerX - wallThickness * 0.52, brush.max.y - 0.04, centerZ - capSpan * 0.5),
          new THREE.Vector3(centerX + wallThickness * 0.52, brush.max.y - 0.04, centerZ - capSpan * 0.5),
          new THREE.Vector3(centerX - wallThickness * 0.52, brush.max.y - 0.04, centerZ + capSpan * 0.5),
          new THREE.Vector3(centerX + wallThickness * 0.52, brush.max.y - 0.04, centerZ + capSpan * 0.5),
          new THREE.Vector3(centerX, brush.max.y + capRise, centerZ - capSpan * 0.5),
          new THREE.Vector3(centerX, brush.max.y + capRise, centerZ + capSpan * 0.5),
        ],
        trimMaterial,
        true,
      )
    } else {
      addDecorHull(
        group,
        [
          new THREE.Vector3(centerX - capSpan * 0.5, brush.max.y - 0.04, centerZ - wallThickness * 0.52),
          new THREE.Vector3(centerX + capSpan * 0.5, brush.max.y - 0.04, centerZ - wallThickness * 0.52),
          new THREE.Vector3(centerX - capSpan * 0.5, brush.max.y - 0.04, centerZ + wallThickness * 0.52),
          new THREE.Vector3(centerX + capSpan * 0.5, brush.max.y - 0.04, centerZ + wallThickness * 0.52),
          new THREE.Vector3(centerX - capSpan * 0.5, brush.max.y + capRise, centerZ),
          new THREE.Vector3(centerX + capSpan * 0.5, brush.max.y + capRise, centerZ),
        ],
        trimMaterial,
        true,
      )
    }

    for (const sign of [-1, 1] as const) {
      const faceOffset = wallThickness * 0.5 + 0.16
      const trimLength = Math.max(2, span - 1.5)
      const lowerTrimPosition = xThin
        ? new THREE.Vector3(centerX + sign * faceOffset, trimYLow, centerZ)
        : new THREE.Vector3(centerX, trimYLow, centerZ + sign * faceOffset)
      const upperTrimPosition = xThin
        ? new THREE.Vector3(centerX + sign * faceOffset, trimYHigh, centerZ)
        : new THREE.Vector3(centerX, trimYHigh, centerZ + sign * faceOffset)
      addDecorBox(
        group,
        xThin ? new THREE.Vector3(0.16, 0.16, trimLength) : new THREE.Vector3(trimLength, 0.16, 0.16),
        lowerTrimPosition,
        trimMaterial,
      )
      addDecorBox(
        group,
        xThin ? new THREE.Vector3(0.16, 0.16, trimLength) : new THREE.Vector3(trimLength, 0.16, 0.16),
        upperTrimPosition,
        trimMaterial,
      )

      for (let ribIndex = 0; ribIndex < ribCount; ribIndex += 1) {
        const t = ribCount === 1 ? 0.5 : ribIndex / (ribCount - 1)
        const along = THREE.MathUtils.lerp(-span * 0.5 + 1.3, span * 0.5 - 1.3, t)
        const ribPosition = xThin
          ? new THREE.Vector3(centerX + sign * faceOffset, ribY, centerZ + along)
          : new THREE.Vector3(centerX + along, ribY, centerZ + sign * faceOffset)
        addDecorBox(
          group,
          xThin ? new THREE.Vector3(0.28, ribHeight, 0.84) : new THREE.Vector3(0.84, ribHeight, 0.28),
          ribPosition,
          supportMaterial,
          true,
        )
      }

      const panelSpan = Math.max(2.4, span - 3.8)
      const panelPosition = xThin
        ? new THREE.Vector3(centerX + sign * (faceOffset - 0.08), brush.min.y + height * 0.52, centerZ)
        : new THREE.Vector3(centerX, brush.min.y + height * 0.52, centerZ + sign * (faceOffset - 0.08))
      addDecorBox(
        group,
        xThin ? new THREE.Vector3(0.08, ribHeight - 0.7, panelSpan) : new THREE.Vector3(panelSpan, ribHeight - 0.7, 0.08),
        panelPosition,
        plateMaterial,
      )

      for (const t of [0.18, 0.5, 0.82]) {
        const along = THREE.MathUtils.lerp(-span * 0.5 + 1.6, span * 0.5 - 1.6, t)
        const foot = xThin
          ? new THREE.Vector3(centerX + sign * (faceOffset + 0.65), brush.min.y + 0.35, centerZ + along)
          : new THREE.Vector3(centerX + along, brush.min.y + 0.35, centerZ + sign * (faceOffset + 0.65))
        const head = xThin
          ? new THREE.Vector3(centerX + sign * (faceOffset - 0.02), brush.max.y - 1.2, centerZ + along * 0.94)
          : new THREE.Vector3(centerX + along * 0.94, brush.max.y - 1.2, centerZ + sign * (faceOffset - 0.02))
        addDecorStrut(group, foot, head, 0.09, supportMaterial)
      }

      if (index % 3 === 0) {
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, Math.max(2.8, span - 2.1), 10), pipeMaterial)
        pipe.rotation.z = xThin ? 0 : Math.PI / 2
        pipe.rotation.x = xThin ? Math.PI / 2 : 0
        pipe.position.copy(
          xThin
            ? new THREE.Vector3(centerX + sign * (faceOffset + 0.12), brush.min.y + height * 0.72, centerZ)
            : new THREE.Vector3(centerX, brush.min.y + height * 0.72, centerZ + sign * (faceOffset + 0.12)),
        )
        pipe.receiveShadow = true
        group.add(pipe)

        addDecorBox(
          group,
          xThin ? new THREE.Vector3(0.4, 1.2, 0.36) : new THREE.Vector3(0.36, 1.2, 0.4),
          xThin
            ? new THREE.Vector3(centerX + sign * (faceOffset + 0.1), brush.min.y + height * 0.44, centerZ)
            : new THREE.Vector3(centerX, brush.min.y + height * 0.44, centerZ + sign * (faceOffset + 0.1)),
          grateMaterial,
        )
      }
    }

    addPresentationMesh(group, brush.min.y, brush.max.y)
  }

  const majorFloors = brushes.filter((brush) => {
    const width = brush.max.x - brush.min.x
    const depth = brush.max.z - brush.min.z
    const height = brush.max.y - brush.min.y
    return height <= 1.25 && width >= 8 && depth >= 8 && brush.max.y <= 8
  }).slice(0, 8)

  for (const [index, brush] of majorFloors.entries()) {
    const width = brush.max.x - brush.min.x
    const depth = brush.max.z - brush.min.z
    const topY = brush.max.y + 0.08
    const centerX = (brush.min.x + brush.max.x) * 0.5
    const centerZ = (brush.min.z + brush.max.z) * 0.5
    const group = new THREE.Group()

    addDecorBox(group, new THREE.Vector3(width - 0.6, 0.12, 0.34), new THREE.Vector3(centerX, topY, brush.min.z + 0.2), trimMaterial)
    addDecorBox(group, new THREE.Vector3(width - 0.6, 0.12, 0.34), new THREE.Vector3(centerX, topY, brush.max.z - 0.2), trimMaterial)
    addDecorBox(group, new THREE.Vector3(0.34, 0.12, depth - 0.6), new THREE.Vector3(brush.min.x + 0.2, topY, centerZ), trimMaterial)
    addDecorBox(group, new THREE.Vector3(0.34, 0.12, depth - 0.6), new THREE.Vector3(brush.max.x - 0.2, topY, centerZ), trimMaterial)

    if (index % 2 === 0) {
      addDecorBox(
        group,
        width >= depth ? new THREE.Vector3(width * 0.58, 0.05, 0.9) : new THREE.Vector3(0.9, 0.05, depth * 0.58),
        new THREE.Vector3(centerX, topY + 0.03, centerZ),
        grateMaterial,
      )
    }

    if (brush.max.y >= 1.2) {
      addDecorBox(group, new THREE.Vector3(width - 0.2, 0.18, 0.12), new THREE.Vector3(centerX, brush.max.y - 0.06, brush.min.z + 0.05), supportMaterial)
      addDecorBox(group, new THREE.Vector3(width - 0.2, 0.18, 0.12), new THREE.Vector3(centerX, brush.max.y - 0.06, brush.max.z - 0.05), supportMaterial)
      addDecorBox(group, new THREE.Vector3(0.12, 0.18, depth - 0.2), new THREE.Vector3(brush.min.x + 0.05, brush.max.y - 0.06, centerZ), supportMaterial)
      addDecorBox(group, new THREE.Vector3(0.12, 0.18, depth - 0.2), new THREE.Vector3(brush.max.x - 0.05, brush.max.y - 0.06, centerZ), supportMaterial)
    }

    addPresentationMesh(group, brush.min.y, topY + 0.14)
  }

  const elevatedFloors = majorFloors.filter((brush) => brush.min.y >= 1.5)
  for (const brush of elevatedFloors) {
    const width = brush.max.x - brush.min.x
    const depth = brush.max.z - brush.min.z
    const undersideY = brush.min.y - 0.08
    const centerX = (brush.min.x + brush.max.x) * 0.5
    const centerZ = (brush.min.z + brush.max.z) * 0.5
    const group = new THREE.Group()
    const supportHeight = Math.max(brush.min.y - 0.12, 0.6)
    const cornerInsetX = Math.min(1.1, width * 0.18)
    const cornerInsetZ = Math.min(1.1, depth * 0.18)
    const columnHalf = 0.24
    const columnCenters = [
      new THREE.Vector3(brush.min.x + cornerInsetX, supportHeight * 0.5, brush.min.z + cornerInsetZ),
      new THREE.Vector3(brush.max.x - cornerInsetX, supportHeight * 0.5, brush.min.z + cornerInsetZ),
      new THREE.Vector3(brush.min.x + cornerInsetX, supportHeight * 0.5, brush.max.z - cornerInsetZ),
      new THREE.Vector3(brush.max.x - cornerInsetX, supportHeight * 0.5, brush.max.z - cornerInsetZ),
    ]

    for (const center of columnCenters) {
      addDecorBox(group, new THREE.Vector3(columnHalf * 2, supportHeight, columnHalf * 2), center, supportMaterial, true)
    }

    addDecorBox(group, new THREE.Vector3(Math.max(2.4, width - cornerInsetX * 1.6), 0.2, 0.24), new THREE.Vector3(centerX, undersideY, brush.min.z + cornerInsetZ), trimMaterial)
    addDecorBox(group, new THREE.Vector3(Math.max(2.4, width - cornerInsetX * 1.6), 0.2, 0.24), new THREE.Vector3(centerX, undersideY, brush.max.z - cornerInsetZ), trimMaterial)
    addDecorBox(group, new THREE.Vector3(0.24, 0.2, Math.max(2.4, depth - cornerInsetZ * 1.6)), new THREE.Vector3(brush.min.x + cornerInsetX, undersideY, centerZ), trimMaterial)
    addDecorBox(group, new THREE.Vector3(0.24, 0.2, Math.max(2.4, depth - cornerInsetZ * 1.6)), new THREE.Vector3(brush.max.x - cornerInsetX, undersideY, centerZ), trimMaterial)

    const undersideTargets = [
      new THREE.Vector3(centerX, undersideY, centerZ),
      new THREE.Vector3(centerX, undersideY, brush.min.z + cornerInsetZ),
      new THREE.Vector3(centerX, undersideY, brush.max.z - cornerInsetZ),
    ]
    for (const source of columnCenters) {
      addDecorStrut(group, new THREE.Vector3(source.x, supportHeight, source.z), undersideTargets[0], 0.08, pipeMaterial)
    }
    addDecorStrut(group, new THREE.Vector3(brush.min.x + cornerInsetX, supportHeight, brush.min.z + cornerInsetZ), undersideTargets[2], 0.07, pipeMaterial)
    addDecorStrut(group, new THREE.Vector3(brush.max.x - cornerInsetX, supportHeight, brush.min.z + cornerInsetZ), undersideTargets[1], 0.07, pipeMaterial)
    addDecorStrut(group, new THREE.Vector3(brush.min.x + cornerInsetX, supportHeight, brush.max.z - cornerInsetZ), undersideTargets[1], 0.07, pipeMaterial)
    addDecorStrut(group, new THREE.Vector3(brush.max.x - cornerInsetX, supportHeight, brush.max.z - cornerInsetZ), undersideTargets[2], 0.07, pipeMaterial)

    addPresentationMesh(group, 0, brush.max.y)
  }

  const ceilingGroup = new THREE.Group()
  const beamCount = Math.max(3, Math.min(6, Math.floor(worldWidth / 18)))
  for (let index = 0; index < beamCount; index += 1) {
    const t = beamCount === 1 ? 0.5 : (index + 0.5) / beamCount
    const x = THREE.MathUtils.lerp(worldMinX + 5, worldMaxX - 5, t)
    addDecorBox(
      ceilingGroup,
      new THREE.Vector3(0.56, 0.4, worldHeight - 8),
      new THREE.Vector3(x, worldCeiling - 0.45, (worldMinZ + worldMaxZ) * 0.5),
      supportMaterial,
      true,
    )
  }

  for (const zFactor of [0.26, 0.5, 0.74]) {
    const pipeBundle = new THREE.Group()
    const z = THREE.MathUtils.lerp(worldMinZ + 7, worldMaxZ - 7, zFactor)
    for (const [offset, radius] of [[-0.28, 0.11], [0, 0.15], [0.28, 0.09]] as Array<[number, number]>) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, worldWidth - 10, 10), pipeMaterial)
      pipe.rotation.z = Math.PI / 2
      pipe.position.set((worldMinX + worldMaxX) * 0.5, worldCeiling - 1.0 + offset * 0.15, z + offset)
      pipe.receiveShadow = true
      pipeBundle.add(pipe)
    }
    addPresentationMesh(pipeBundle, worldCeiling - 1.25, worldCeiling - 0.7)
  }

  const vaultGroup = new THREE.Group()
  const naveRadius = Math.max(8, Math.min(worldWidth, worldHeight) * 0.16)
  for (const zFactor of [0.24, 0.5, 0.76]) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(naveRadius, 0.16, 10, 28, Math.PI), trimMaterial)
    rib.position.set(centerX, 7.6, THREE.MathUtils.lerp(worldMinZ + 10, worldMaxZ - 10, zFactor))
    rib.castShadow = true
    rib.receiveShadow = true
    vaultGroup.add(rib)

    const crown = new THREE.Mesh(new THREE.BoxGeometry(naveRadius * 1.7, 0.18, 0.32), supportMaterial)
    crown.position.set(centerX, 7.6 + naveRadius, rib.position.z)
    crown.castShadow = true
    crown.receiveShadow = true
    vaultGroup.add(crown)
  }

  for (const xFactor of [0.3, 0.7]) {
    const transeptRib = new THREE.Mesh(new THREE.TorusGeometry(Math.max(7, worldHeight * 0.13), 0.14, 10, 24, Math.PI), plateMaterial)
    transeptRib.rotation.y = Math.PI / 2
    transeptRib.position.set(THREE.MathUtils.lerp(worldMinX + 11, worldMaxX - 11, xFactor), 8.4, centerZ)
    transeptRib.castShadow = true
    transeptRib.receiveShadow = true
    vaultGroup.add(transeptRib)
  }

  for (const point of [
    new THREE.Vector3(centerX, worldCeiling - 1.2, centerZ),
    new THREE.Vector3(centerX - worldWidth * 0.18, worldCeiling - 1.4, centerZ - worldHeight * 0.14),
    new THREE.Vector3(centerX + worldWidth * 0.18, worldCeiling - 1.4, centerZ + worldHeight * 0.14),
  ]) {
    const lantern = new THREE.Group()
    const cage = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 1.35, 8), grateMaterial)
    cage.castShadow = true
    cage.receiveShadow = true
    const core = new THREE.PointLight('#ffc27a', 5.4, 18, 2)
    core.position.y = -0.08
    const chainStart = point.clone()
    chainStart.y = worldCeiling - 0.35
    addDecorStrut(lantern, new THREE.Vector3(0, 0.5, 0), new THREE.Vector3(0, 1.45, 0), 0.03, supportMaterial, 8)
    lantern.add(cage, core)
    lantern.position.copy(point)
    vaultGroup.add(lantern)
    addDecorStrut(vaultGroup, chainStart, point.clone().add(new THREE.Vector3(0, 0.7, 0)), 0.025, supportMaterial, 8)
  }

  addPresentationMesh(vaultGroup, 6.8, worldCeiling)

  addPresentationMesh(ceilingGroup, worldCeiling - 0.7, worldCeiling - 0.2)
}

type BuildCavernDecorationOptions = {
  scene: THREE.Scene
  worldCeiling: number
  worldMinX: number
  worldMaxX: number
  worldMinZ: number
  worldMaxZ: number
  isAbyssalGrotto: boolean
  isAbyssalGrottoPrime: boolean
}

/**
 * Adds stalactites, stalagmites, ember lights, and (for abyssal maps) reflective
 * puddle strips. Writes directly to the scene; no collision state is modified.
 */
export function buildCavernDecoration({
  scene,
  worldCeiling,
  worldMinX,
  worldMaxX,
  worldMinZ,
  worldMaxZ,
  isAbyssalGrotto,
  isAbyssalGrottoPrime,
}: BuildCavernDecorationOptions): void {
  const isDarkCaverns = !isAbyssalGrotto && !isAbyssalGrottoPrime
  const positionAt = (xFactor: number, zFactor: number, y = 0) =>
    new THREE.Vector3(
      THREE.MathUtils.lerp(worldMinX, worldMaxX, xFactor),
      y,
      THREE.MathUtils.lerp(worldMinZ, worldMaxZ, zFactor),
    )

  const spikeMaterial = new THREE.MeshStandardMaterial({
    color: isAbyssalGrottoPrime ? '#1d4952' : isAbyssalGrotto ? '#18353c' : '#2f2520',
    emissive: isAbyssalGrottoPrime ? '#11424a' : isAbyssalGrotto ? '#0c2329' : '#1a110c',
    emissiveIntensity: isAbyssalGrottoPrime ? 0.28 : isAbyssalGrotto ? 0.2 : 0.12,
    roughness: isAbyssalGrottoPrime ? 0.58 : isAbyssalGrotto ? 0.7 : 0.95,
    metalness: isAbyssalGrottoPrime ? 0.2 : isAbyssalGrotto ? 0.12 : 0.02,
  })
  for (const [xFactor, zFactor, height] of [
    [0.16, 0.18, 2.8], [0.28, 0.34, 3.6], [0.42, 0.21, 2.4], [0.58, 0.77, 3.2],
    [0.73, 0.62, 4.1], [0.84, 0.28, 2.9], [0.24, 0.78, 3.7], [0.66, 0.44, 2.6],
  ] as Array<[number, number, number]>) {
    const stalagmite = new THREE.Mesh(new THREE.ConeGeometry(0.45, height, 7), spikeMaterial)
    stalagmite.position.copy(positionAt(xFactor, zFactor, height * 0.5))
    stalagmite.castShadow = true
    scene.add(stalagmite)

    const stalactite = new THREE.Mesh(new THREE.ConeGeometry(0.4, height * 0.75, 7), spikeMaterial)
    stalactite.position.copy(positionAt(xFactor + 0.03, zFactor - 0.02, worldCeiling - height * 0.38))
    stalactite.rotation.x = Math.PI
    stalactite.castShadow = true
    scene.add(stalactite)
  }

  for (const point of [positionAt(0.12, 0.22, 1.9), positionAt(0.84, 0.18, 2.1), positionAt(0.78, 0.82, 1.7), positionAt(0.22, 0.74, 2.0)]) {
    const ember = new THREE.PointLight(isAbyssalGrottoPrime ? '#92fbff' : isAbyssalGrotto ? '#75f0ff' : '#ffac6e', isAbyssalGrottoPrime ? 6.2 : isAbyssalGrotto ? 5.2 : 3.8, isAbyssalGrottoPrime ? 16 : isAbyssalGrotto ? 14 : 12, 2)
    ember.position.copy(point)
    scene.add(ember)
  }

  if (isAbyssalGrotto || isAbyssalGrottoPrime) {
    const puddleMaterial = new THREE.MeshStandardMaterial({
      color: isAbyssalGrottoPrime ? '#10363f' : '#0c2328',
      emissive: isAbyssalGrottoPrime ? '#1f6f7d' : '#144650',
      emissiveIntensity: isAbyssalGrottoPrime ? 0.44 : 0.3,
      roughness: isAbyssalGrottoPrime ? 0.08 : 0.18,
      metalness: isAbyssalGrottoPrime ? 0.52 : 0.35,
      transparent: true,
      opacity: isAbyssalGrottoPrime ? 0.8 : 0.72,
    })
    for (const [xFactor, zFactor, sx, sz] of [
      [0.22, 0.52, 7.2, 1.8],
      [0.54, 0.36, 6.4, 1.5],
      [0.74, 0.64, 5.6, 1.6],
    ] as Array<[number, number, number, number]>) {
      const puddle = new THREE.Mesh(new THREE.PlaneGeometry(sx, sz), puddleMaterial)
      puddle.rotation.x = -Math.PI / 2
      puddle.position.copy(positionAt(xFactor, zFactor, 0.025))
      scene.add(puddle)
    }
  }

  // Suppress unused-variable TS warning — isDarkCaverns could drive future variant-specific logic
  void isDarkCaverns
}

type BuildNeonTechDecorationOptions = {
  scene: THREE.Scene
  worldCeiling: number
  worldMinX: number
  worldMaxX: number
  worldMinZ: number
  worldMaxZ: number
  worldWidth: number
  worldHeight: number
}

/**
 * Adds framed wall panels, ceiling cornices, chandeliers, ceiling coffers, corner
 * spires, cross-beams, lamps, central ring, and a perimeter torus to the scene.
 * Writes directly to the scene; no collision state is modified.
 */
export function buildNeonTechDecoration({
  scene,
  worldCeiling,
  worldMinX,
  worldMaxX,
  worldMinZ,
  worldMaxZ,
  worldWidth,
  worldHeight,
}: BuildNeonTechDecorationOptions): void {
  const centerX = (worldMinX + worldMaxX) * 0.5
  const centerZ = (worldMinZ + worldMaxZ) * 0.5
  const positionAt = (xFactor: number, zFactor: number, y = 0) =>
    new THREE.Vector3(
      THREE.MathUtils.lerp(worldMinX, worldMaxX, xFactor),
      y,
      THREE.MathUtils.lerp(worldMinZ, worldMaxZ, zFactor),
    )

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
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: '#1a3f4a',
    emissive: '#00ffff',
    emissiveIntensity: 0.35,
    roughness: 0.25,
    metalness: 0.85,
  })
  const supportMaterial = new THREE.MeshStandardMaterial({
    color: '#2a1a3f',
    emissive: '#6600ff',
    emissiveIntensity: 0.4,
    roughness: 0.3,
    metalness: 0.8,
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
    scene.add(panel)
  }

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
    new THREE.Vector3(centerX, worldCeiling - 0.42, worldMinZ + 0.55),
    new THREE.Vector3(centerX, worldCeiling - 0.42, worldMaxZ - 0.55),
  ]) {
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(worldWidth - 2.4, 0.16, 0.24), goldMaterial)
    cornice.position.copy(position)
    cornice.castShadow = true
    scene.add(cornice)
  }

  for (const position of [
    new THREE.Vector3(worldMinX + 0.55, worldCeiling - 0.42, centerZ),
    new THREE.Vector3(worldMaxX - 0.55, worldCeiling - 0.42, centerZ),
  ]) {
    const cornice = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, worldHeight - 2.4), goldMaterial)
    cornice.position.copy(position)
    cornice.castShadow = true
    scene.add(cornice)
  }

  for (const point of [positionAt(0.25, 0.24, worldCeiling - 0.95), positionAt(0.75, 0.24, worldCeiling - 0.95), positionAt(0.5, 0.72, worldCeiling - 0.95)]) {
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
    scene.add(chandelier)
  }

  for (const zFactor of [0.2, 0.4, 0.6, 0.8]) {
    for (const xFactor of [0.25, 0.5, 0.75]) {
      const coffer = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(2, worldWidth * 0.1), 0.18, Math.max(1.2, worldHeight * 0.06)),
        marbleMaterial,
      )
      coffer.position.copy(positionAt(xFactor, zFactor, worldCeiling - 0.14))
      coffer.castShadow = true
      scene.add(coffer)

      const inset = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(1.1, worldWidth * 0.06), 0.08, Math.max(0.7, worldHeight * 0.035)),
        goldMaterial,
      )
      inset.position.copy(positionAt(xFactor, zFactor, worldCeiling - 0.22))
      scene.add(inset)
    }
  }

  for (const point of [positionAt(0.22, 0.22, 1.15), positionAt(0.78, 0.22, 1.15), positionAt(0.22, 0.78, 1.15), positionAt(0.78, 0.78, 1.15)]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 0.5, 10), trimMaterial)
    base.position.copy(point)
    base.castShadow = true
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.65, 2.6, 8), supportMaterial)
    spire.position.copy(point.clone().add(new THREE.Vector3(0, 1.55, 0)))
    spire.castShadow = true
    scene.add(base, spire)
  }

  for (const xFactor of [0.18, 0.5, 0.82]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.18, worldHeight - 2.6), trimMaterial)
    beam.position.copy(positionAt(xFactor, 0.5, worldCeiling - 0.55))
    beam.castShadow = true
    scene.add(beam)
  }

  const centralRing = new THREE.Mesh(
    new THREE.TorusGeometry(Math.min(worldWidth, worldHeight) * 0.2, 0.24, 12, 64),
    new THREE.MeshStandardMaterial({ color: '#3a2b2d', emissive: '#611f26', emissiveIntensity: 0.55, metalness: 0.2, roughness: 0.7 }),
  )
  centralRing.rotation.x = Math.PI / 2
  centralRing.position.set(centerX, worldCeiling - 0.9, centerZ)
  scene.add(centralRing)

  for (const point of [positionAt(0.08, 0.16, 2.4), positionAt(0.92, 0.16, 2.4), positionAt(0.08, 0.84, 2.4), positionAt(0.92, 0.84, 2.4), positionAt(0.5, 0.52, 2.9)]) {
    const lamp = new THREE.Group()
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.42, 8), trimMaterial)
    housing.position.copy(point)
    housing.castShadow = true
    const flame = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), emberMaterial)
    flame.position.copy(point.clone().add(new THREE.Vector3(0, 0.24, 0)))
    const light = new THREE.PointLight('#ffb46f', 14, 14, 2)
    light.position.copy(point.clone().add(new THREE.Vector3(0, 0.24, 0)))
    lamp.add(housing, flame, light)
    scene.add(lamp)
  }

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(Math.max(worldWidth, worldHeight) * 0.47, 0.15, 10, 72),
    new THREE.MeshBasicMaterial({ color: '#6d1e24', transparent: true, opacity: 0.18 }),
  )
  ring.rotation.x = Math.PI / 2
  ring.position.set(centerX, 0.02, centerZ)
  scene.add(ring)
}
