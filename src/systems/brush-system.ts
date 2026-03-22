import * as THREE from 'three'
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js'
import type { ArenaMap } from '../shared/contracts'
import { createPointBrushCollisionVolume, type SolidVolume } from '../collision-geometry'
import type { TextureManager } from '../texture-manager'

type BrushSystemContext = {
  scene: THREE.Scene
  brushMeshes: Array<{ mesh: THREE.Object3D; minY: number; maxY: number }>
  wallBoxes: THREE.Mesh[]
  ricochetSurfaces: THREE.Object3D[]
  solidVolumes: SolidVolume[]
}

type AddSolidBrushOptions = {
  brush: ArenaMap['brushes'][number]
  material: THREE.Material | string
  textureManager: TextureManager
  detailLevel: 'full' | 'major' | 'structure'
  sourceFormat: ArenaMap['sourceFormat']
  context: BrushSystemContext
}

const isNonRenderableTexture = (textureName: string | undefined): boolean => {
  if (!textureName) return false
  const name = textureName.toLowerCase()
  return name.includes('common/caulk') || name.includes('common/skip') || name.includes('common/clip')
}

const calculateFaceArea = (points: Array<{ x: number; y: number; z: number }>): number => {
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
): number[][] => {
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

  return THREE.ShapeUtils.triangulateShape(projected, [])
}

/**
 * Constructs a THREE.js mesh for the given brush, registers it in the scene,
 * and pushes collision volumes, ricochet surfaces, and wall boxes into the
 * appropriate context arrays. Handles convex-hull, face-by-face BSP, and
 * fallback box geometry paths.
 */
export function addSolidBrush({
  brush,
  material,
  textureManager,
  detailLevel,
  sourceFormat,
  context,
}: AddSolidBrushOptions): void {
  const { scene, brushMeshes, wallBoxes, ricochetSurfaces, solidVolumes } = context
  const mat = typeof material === 'string' ? textureManager.getMaterial(material) : material
  const size = new THREE.Vector3(brush.max.x - brush.min.x, brush.max.y - brush.min.y, brush.max.z - brush.min.z)
  const position = new THREE.Vector3(
    (brush.min.x + brush.max.x) * 0.5,
    (brush.min.y + brush.max.y) * 0.5,
    (brush.min.z + brush.max.z) * 0.5,
  )

  const getAreaThreshold = (): number => {
    const isQuakeMap = sourceFormat === 'quake-map'
    if (detailLevel === 'structure') return isQuakeMap ? 2.0 : 1.0
    if (detailLevel === 'major') return isQuakeMap ? 0.35 : 0.1
    return 0
  }

  const pointBrushCollisionVolume = sourceFormat === 'brush-map'
    ? createPointBrushCollisionVolume(brush)
    : null

  // Quake .map brushes are convex solids; render as one convex mesh to avoid face-triangulation shards.
  // BSP "brushes" are actually pre-triangulated faces, so they use the standard face rendering path below.
  if (sourceFormat === 'quake-map' && brush.points && brush.points.length >= 4) {
    const points = brush.points.map((point) => new THREE.Vector3(point.x, point.y, point.z))
    const preferredTexture = brush.faces?.find((face) => !isNonRenderableTexture(face.texture))?.texture
    const brushMaterial = textureManager.getMaterial(preferredTexture || brush.texture || 'default/face')
    const mesh = new THREE.Mesh(new ConvexGeometry(points), brushMaterial)
    mesh.castShadow = true
    mesh.receiveShadow = true
    scene.add(mesh)
    brushMeshes.push({ mesh, minY: brush.min.y, maxY: brush.max.y })
    wallBoxes.push(mesh)
    ricochetSurfaces.push(mesh)
    solidVolumes.push({
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

      const faceMaterial = textureManager.getMaterial(face.texture || brush.texture || 'default/face')

      if (face.points.length < 3) continue

      const p0 = face.points[0]
      const p1 = face.points[1]
      const p2 = face.points[2]

      const v1 = { x: p1.x - p0.x, y: p1.y - p0.y, z: p1.z - p0.z }
      const v2 = { x: p2.x - p0.x, y: p2.y - p0.y, z: p2.z - p0.z }

      const normal = {
        x: v1.y * v2.z - v1.z * v2.y,
        y: v1.z * v2.x - v1.x * v2.z,
        z: v1.x * v2.y - v1.y * v2.x,
      }

      const normalMagnitude = Math.sqrt(normal.x ** 2 + normal.y ** 2 + normal.z ** 2)
      if (normalMagnitude < 0.0001) {
        continue
      }

      const brushCenter = {
        x: (brush.min.x + brush.max.x) * 0.5,
        y: (brush.min.y + brush.max.y) * 0.5,
        z: (brush.min.z + brush.max.z) * 0.5,
      }

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
      ricochetSurfaces.push(faceMesh)
    }

    if (group.children.length > 0) {
      scene.add(group)
      brushMeshes.push({ mesh: group, minY: brush.min.y, maxY: brush.max.y })
      if (pointBrushCollisionVolume) {
        solidVolumes.push(pointBrushCollisionVolume)
      } else {
        solidVolumes.push({
          minY: brush.min.y,
          maxY: brush.max.y,
          minX: brush.min.x,
          maxX: brush.max.x,
          minZ: brush.min.z,
          maxZ: brush.max.z,
        })
      }
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
  scene.add(mesh)
  brushMeshes.push({ mesh, minY: brush.min.y, maxY: brush.max.y })
  wallBoxes.push(mesh)
  ricochetSurfaces.push(mesh)
  if (pointBrushCollisionVolume) {
    solidVolumes.push(pointBrushCollisionVolume)
    return
  }
  solidVolumes.push({
    kind: 'box',
    minY: brush.min.y,
    maxY: brush.max.y,
    minX: brush.min.x,
    maxX: brush.max.x,
    minZ: brush.min.z,
    maxZ: brush.max.z,
  })
}
