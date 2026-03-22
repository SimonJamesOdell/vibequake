/**
 * CollisionGeometry utility module
 * 
 * Extracts duplicated AABB and collision calculations into reusable functions.
 * This eliminates duplication and creates a single source of truth for collision tests.
 */

import type { BrushSolid } from './shared/contracts'

/**
 * Represents the vertical bounds of an entity.
 */
export interface VerticalBounds {
  minY: number
  maxY: number
}

/**
 * Represents a solid collision volume in 3D space.
 */
export interface SolidVolume {
  kind?: 'box' | 'slope-x' | 'slope-z' | 'pyramid'
  minY: number
  maxY: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  topHeightAt?: (x: number, z: number) => number | null
}

/**
 * Calculate the vertical bounds of a body given its position and height.
 * 
 * @param y - Body position (typically feet Y)
 * @param bodyHeight - Total height of body
 * @param floorLevel - Offset where feet are relative to Y position
 * @returns Object with minY (feet) and maxY (head)
 */
export function getBodyVerticalBounds(y: number, bodyHeight: number, floorLevel: number): VerticalBounds {
  const minY = y - floorLevel
  const maxY = minY + bodyHeight
  return { minY, maxY }
}

/**
 * Test if a point (x, z) with a radius is within the XZ bounds of a volume (with padding).
 * This is a loose AABB check used for broad-phase collision detection.
 * 
 * @param x - X coordinate of entity center
 * @param z - Z coordinate of entity center
 * @param radius - Collision radius around entity
 * @param volume - Collision volume to test against
 * @param padding - Additional padding around volume (optional, defaults to 0)
 * @returns true if entity circle could collide with volume's XZ bounds
 */
export function overlapsVolumeXZBounds(
  x: number,
  z: number,
  radius: number,
  volume: SolidVolume,
  padding: number = 0,
): boolean {
  return !(
    x < volume.minX - radius - padding ||
    x > volume.maxX + radius + padding ||
    z < volume.minZ - radius - padding ||
    z > volume.maxZ + radius + padding
  );
}

/**
 * Test if vertical bounds overlap with a volume's Y range.
 * 
 * @param bounds - Vertical bounds of entity (min to max Y)
 * @param volume - Collision volume to test
 * @returns true if Y ranges overlap
 */
export function overlapsVolumeYRange(bounds: VerticalBounds, volume: SolidVolume): boolean {
  return !(bounds.maxY < volume.minY || bounds.minY > volume.maxY);
}

/**
 * Get the surface height of a volume at a given (x, z) coordinate.
 * 
 * For simple boxes, returns maxY.
 * For shaped volumes (pyramid, slopes), uses the volume's topHeightAt function.
 * Returns null if the coordinate is outside the volume's XZ footprint.
 * 
 * @param volume - Collision volume
 * @param x - X coordinate to query
 * @param z - Z coordinate to query
 * @returns Surface height (Y) or null if outside volume
 */
export function getVolumeSurfaceHeight(volume: SolidVolume, x: number, z: number): number | null {
  // Quick XZ bounds check
  if (x < volume.minX || x > volume.maxX || z < volume.minZ || z > volume.maxZ) {
    return null;
  }

  // Use shape-specific height function if available, otherwise maximum Y
  if (volume.topHeightAt) {
    return volume.topHeightAt(x, z);
  }

  return volume.maxY;
}

/**
 * Test if a point is blocked by checking against a list of volumes.
 * Returns true if the entity at (x, z) with given padding would collide with any volume.
 * 
 * @param x - X coordinate to test
 * @param z - Z coordinate to test
 * @param volumes - List of collision volumes to test against
 * @param bounds - Vertical bounds of entity
 * @param padding - XZ padding for broad-phase (typically collision radius)
 * @returns true if position is blocked
 */
export function isPositionBlockedByVolumes(
  x: number,
  z: number,
  volumes: SolidVolume[],
  bounds: VerticalBounds,
  padding: number = 0,
): boolean {
  for (const volume of volumes) {
    // Stage 1: XZ broad-phase
    if (!overlapsVolumeXZBounds(x, z, 0, volume, padding)) {
      continue;
    }

    // Stage 2: Y range check
    if (!overlapsVolumeYRange(bounds, volume)) {
      continue;
    }

    // Blocked by this volume
    return true;
  }

  return false;
}

/**
 * Find the highest walkable surface height within a search radius around a point.
 * Scans all volumes and returns the maximum surface height at (x, z).
 * 
 * @param x - X coordinate to search
 * @param z - Z coordinate to search
 * @param volumes - List of collision volumes to search
 * @returns Maximum surface height found, or undefined if none found
 */
export function getMaxSurfaceHeightAt(x: number, z: number, volumes: SolidVolume[]): number | undefined {
  let maxHeight: number | undefined = undefined;

  for (const volume of volumes) {
    const height = getVolumeSurfaceHeight(volume, x, z);
    if (height !== null && (maxHeight === undefined || height > maxHeight)) {
      maxHeight = height;
    }
  }

  return maxHeight;
}

/**
 * Calculate the step height between two surface points.
 * 
 * @param topY - Y coordinate of the top surface
 * @param feetY - Y coordinate of the feet
 * @returns Height difference (topY - feetY), positive if stepping up
 */
export function calculateStepHeight(topY: number, feetY: number): number {
  return topY - feetY;
}

/**
 * Check if a step height is within the maximum auto-climb range.
 * 
 * @param stepHeight - Height of the step
 * @param maxAutoStepHeight - Maximum step height allowed (typically 0.5)
 * @returns true if step can be automatically climbed
 */
export function canAutoStep(stepHeight: number, maxAutoStepHeight: number): boolean {
  return stepHeight > 0.02 && stepHeight <= maxAutoStepHeight;
}

/**
 * Find the nearest point on a volume's XZ bounds to a given position.
 * Used to determine which edge of the volume to push the player against.
 * 
 * @param x - Entity X position
 * @param z - Entity Z position
 * @param volume - Collision volume
 * @returns Nearest (x, z) on the volume's perimeter
 */
export function getNearestPointOnVolume(
  x: number,
  z: number,
  volume: SolidVolume,
): { x: number; z: number } {
  return {
    x: Math.max(volume.minX, Math.min(x, volume.maxX)),
    z: Math.max(volume.minZ, Math.min(z, volume.maxZ)),
  };
}

/**
 * Calculate the distance from a point to the nearest edge of a volume's XZ bounds.
 * 
 * @param x - Entity X position
 * @param z - Entity Z position
 * @param volume - Collision volume
 * @returns Distance to nearest edge (always >= 0)
 */
export function getDistanceToVolumeEdge(x: number, z: number, volume: SolidVolume): number {
  const dx = Math.max(0, volume.minX - x, x - volume.maxX);
  const dz = Math.max(0, volume.minZ - z, z - volume.maxZ);
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Calculate a push vector to move an entity away from a volume's edge.
 * 
 * @param x - Entity X position
 * @param z - Entity Z position
 * @param radius - Entity collision radius
 * @param volume - Collision volume to push away from
 * @returns {x, z} push vector, or null if entity is not colliding
 */
export function calculatePushVector(
  x: number,
  z: number,
  radius: number,
  volume: SolidVolume,
): { x: number; z: number } | null {
  // Find nearest point on volume
  const nearX = Math.max(volume.minX, Math.min(x, volume.maxX));
  const nearZ = Math.max(volume.minZ, Math.min(z, volume.maxZ));

  // Calculate current distance
  const dx = x - nearX;
  const dz = z - nearZ;
  const distance = Math.sqrt(dx * dx + dz * dz);

  // If distance is already sufficient, no push needed
  if (distance >= radius) {
    return null;
  }

  // If entity is perfectly centered on point, push in arbitrary direction
  if (distance < 0.001) {
    return { x: radius - 0.01, z: 0 };
  }

  // Normalize direction away from nearest point and scale to push distance
  const pushDistance = radius - distance + 0.001; // Small epsilon to ensure clear
  const scale = pushDistance / distance;

  return {
    x: dx * scale,
    z: dz * scale,
  };
}

/**
 * Creates a typed collision volume for brushes with convex point geometry (pyramids, slopes).
 * Returns null for brushes without point data or with degenerate geometry.
 */
export function createPointBrushCollisionVolume(brush: BrushSolid): SolidVolume | null {
  if (!brush.points || brush.points.length < 4) {
    return null
  }

  const rise = brush.max.y - brush.min.y
  if (rise <= 0.001) {
    return null
  }

  const apexPoints = brush.points.filter((point) => Math.abs(point.y - brush.max.y) < 0.001)
  const centerX = (brush.min.x + brush.max.x) * 0.5
  const centerZ = (brush.min.z + brush.max.z) * 0.5
  const halfWidth = (brush.max.x - brush.min.x) * 0.5
  const halfDepth = (brush.max.z - brush.min.z) * 0.5

  if (apexPoints.length === 1 && halfWidth > 0.001 && halfDepth > 0.001) {
    const apex = apexPoints[0]
    return {
      kind: 'pyramid',
      minY: brush.min.y,
      maxY: brush.max.y,
      minX: brush.min.x,
      maxX: brush.max.x,
      minZ: brush.min.z,
      maxZ: brush.max.z,
      topHeightAt: (x, z) => {
        if (x < brush.min.x || x > brush.max.x || z < brush.min.z || z > brush.max.z) {
          return null
        }
        const nx = Math.abs(x - apex.x) / halfWidth
        const nz = Math.abs(z - apex.z) / halfDepth
        const t = Math.max(0, 1 - Math.max(nx, nz))
        return brush.min.y + rise * t
      },
    }
  }

  if (apexPoints.length === 2) {
    const [firstApex, secondApex] = apexPoints
    if (Math.abs(firstApex.z - secondApex.z) < 0.001 && halfDepth > 0.001) {
      return {
        kind: 'slope-x',
        minY: brush.min.y,
        maxY: brush.max.y,
        minX: brush.min.x,
        maxX: brush.max.x,
        minZ: brush.min.z,
        maxZ: brush.max.z,
        topHeightAt: (x, z) => {
          if (x < brush.min.x || x > brush.max.x || z < brush.min.z || z > brush.max.z) {
            return null
          }
          const nz = Math.abs(z - centerZ) / halfDepth
          const t = Math.max(0, 1 - nz)
          return brush.min.y + rise * t
        },
      }
    }

    if (Math.abs(firstApex.x - secondApex.x) < 0.001 && halfWidth > 0.001) {
      return {
        kind: 'slope-z',
        minY: brush.min.y,
        maxY: brush.max.y,
        minX: brush.min.x,
        maxX: brush.max.x,
        minZ: brush.min.z,
        maxZ: brush.max.z,
        topHeightAt: (x, z) => {
          if (x < brush.min.x || x > brush.max.x || z < brush.min.z || z > brush.max.z) {
            return null
          }
          const nx = Math.abs(x - centerX) / halfWidth
          const t = Math.max(0, 1 - nx)
          return brush.min.y + rise * t
        },
      }
    }
  }

  return null
}
