# VibeQuake Collision Detection Architecture Analysis

## Executive Summary

The VibeQuake codebase has **two fundamentally different collision detection systems** that operate independently:

1. **Projectile/Ricochet System** – Uses THREE.js raycaster to trace pre-computed bounce paths
2. **Player Movement System** – Uses AABB collision volumes with specialized resolution logic

Additionally, **enemy projectiles** use yet another approach with per-frame raycaster intersection. This architectural divergence creates duplicated logic, scattered collision data, and makes the codebase difficult to maintain.

---

## 1. How Projectile Collision Detection Works

### Location
[src/game.ts](src/game.ts#L4023-L4108) – `computeProjectileArc()` method

### Architecture
Projectiles use a **pre-computed path with bounce nodes**:

```typescript
// At projectile creation, compute the entire path including ricochets
computeProjectileArc(start, direction, maxRange) {
  // 1. Fire ray from camera
  const aimHits = raycaster.intersectObjects([...hitables, ...ricochetSurfaces])
  
  // 2. If hit, add to nodes
  nodes.push({ point: hitPoint, enemy?, impactColor, damageOnArrival })
  
  // 3. Bounce up to 3 + weaponUpgradeTier times
  while (bouncesLeft > 0) {
    // Cast ray from bounce point
    const bounceHits = raycaster.intersectObjects([...hitables, ...ricochetSurfaces])
    
    // Add bounce node to path
    nodes.push({ point: bounceHit.point, /** ... */ })
    
    // Calculate reflection using face normal
    bounceDirection = rayDirection.reflect(hitFace.normal)
  }
  
  return nodes
}
```

### Key Characteristics

| Aspect | Implementation |
|--------|-----------------|
| **Query Timing** | Pre-computed at creation time |
| **Collision Geometry** | THREE.js meshes in `ricochetSurfaces[]` array |
| **Movement Model** | Follows pre-computed node path at runtime |
| **Physics** | Vector reflection using face normals |
| **Damage Detection** | Checks `nodes[i].enemy` at each segment arrival |
| **Max Range** | `maxRange` parameter (~52 units) |
| **Bounces** | 3 + `weaponUpgradeTier` (max 5 total) |

### Bounce Calculation ✓
Lines [4045-4049](src/game.ts#L4045-L4049):
```typescript
if (aimHit.face) {
  bounceDirection = rayDirection.clone().reflect(
    aimHit.face.normal.clone().transformDirection(aimHit.object.matrixWorld).normalize()
  )
} else {
  bounceDirection = rayDirection.clone().reflect(new THREE.Vector3(0, 1, 0)).normalize()
}
bounceBounceOrigin.addScaledVector(bounceDirection, 0.18)  // Small offset to prevent re-hitting same surface
```

---

## 2. How Player Collision Detection Works

### Location
[src/game.ts](src/game.ts#L3741-L3810) – `resolvePlayerCollisions()` method

### Architecture
Uses **Axis-Aligned Bounding Box (AABB) collision volumes** with multi-stage resolution:

```typescript
private resolvePlayerCollisions(axis: 'x' | 'z') {
  const bodyMinY = this.player.y - this.floorLevel
  const bodyMaxY = bodyMinY + this.playerBodyHeight  // 1.7 units tall
  
  for (const volume of this.solidVolumes) {
    // Stage 1: Can volume affect horizontal movement?
    if (!this.blocksHorizontalMovement(volume)) continue
    
    // Stage 2: AABB Y-range check
    if (bodyMaxY < volume.minY || bodyMinY > volume.maxY) continue
    
    // Stage 3: Broad AABB XZ check (with player radius padding)
    if (player.x < volume.minX - playerRadius || ...) continue
    
    // Stage 4: Get volume's top surface height
    const topY = this.getVolumeTopAt(volume, nearestX, nearestZ)
    
    // Stage 5a: Can we walk over it? (auto-step)
    if (this.canAutoStep(topY, bodyMinY) && velocity.y <= 1.5) {
      // Attempt auto-step up
      if (!this.isPositionBlocked(x, z, playerRadius, clearedY)) {
        player.y = clearedY
        velocity.y = 0
        continue  // Success, skip collision resolution
      }
    }
    
    // Stage 5b: Radial collision resolution
    let deltaX = player.x - nearestX
    let deltaZ = player.z - nearestZ
    const distance = Math.sqrt(deltaX² + deltaZ²)
    
    if (distance < playerRadius) {
      // Push player away from nearest point
      const push = playerRadius - distance
      player.x += (deltaX / distance) * push
      velocity.x = 0  // Kill velocity in collision axis
    }
  }
}
```

### Key Characteristics

| Aspect | Value/Logic |
|--------|------------|
| **Player Radius** | 0.45 units |
| **Player Height** | 1.7 units (from `playerBodyHeight`) |
| **Floor Level** | 0.33 units (from `floorLevel`) |
| **Max Auto-Step** | 0.5 units (from `maxAutoStepHeight`) |
| **Auto-Step Velocity Cap** | velocity.y ≤ 1.5 |
| **Query Style** | Iterative (all volumes every frame) |
| **Resolution Type** | Radial push-out from nearest point |

### Ground Classification Logic
[src/game.ts](src/game.ts#L3802-L3816) – `isGroundSurface()`:
```typescript
private isGroundSurface(volume: SolidVolume) {
  if (volume.kind && volume.kind !== 'box') return true  // Slopes/pyramids are walkable
  
  const height = volume.maxY - volume.minY
  const width = volume.maxX - volume.minX
  const depth = volume.maxZ - volume.minZ
  
  // Near arena roof → ceiling, not floor
  if (volume.minY >= arenaMax.y - 1.6) return false
  
  // Only walkable if thin (≤ 1.0 units) and substantial (≥ 4×1.8 units footprint)
  return height <= 1.0 && Math.max(width, depth) >= 4 && Math.min(width, depth) >= 1.8
}
```

### Collision Volume Types Supported

#### 1. **Box** (default AABB)
```typescript
{ minX, maxX, minY, maxY, minZ, maxZ, kind: 'box' }
```

#### 2. **Pyramid** (single apex point at top)
Lines [412-438](src/game.ts#L412-L438):
```typescript
topHeightAt: (x, z) => {
  const nx = Math.abs(x - apex.x) / halfWidth
  const nz = Math.abs(z - apex.z) / halfDepth
  const t = Math.max(0, 1 - Math.max(nx, nz))  // Distance from center in normalized space
  return brush.min.y + rise * t
}
```

#### 3. **Slope-X** (two apex points, slopes along Z axis)
```typescript
topHeightAt: (x, z) => {
  const nz = Math.abs(z - centerZ) / halfDepth
  const t = Math.max(0, 1 - nz)
  return brush.min.y + rise * t
}
```

#### 4. **Slope-Z** (two apex points, slopes along X axis)
```typescript
topHeightAt: (x, z) => {
  const nx = Math.abs(x - centerX) / halfWidth
  const t = Math.max(0, 1 - nx)
  return brush.min.y + rise * t
}
```

---

## 3. Key Differences Between the Two Systems

### Comparison Table

| Aspect | Projectiles | Player Movement |
|--------|-------------|-----------------|
| **Collision Geometry** | THREE.js meshes (`ricochetSurfaces[]`) | AABB volumes (`solidVolumes[]`) |
| **Query Timing** | Pre-computed once at creation | Every frame per axis |
| **Query Method** | raycaster.intersect() | Iterative AABB tests |
| **Physics Model** | Vector reflection with face normals | Radial push-out from nearest point |
| **Multi-Hit Handling** | Traces bounces along path | Resolves one axis at a time |
| **Complexity Shapes** | Triangulated faces (automatic) | Pyramid/slope functions (explicit) |
| **Damage Detection** | Checks path nodes for enemies | N/A (direct raycaster hit) |
| **Update Frequency** | At creation + path traversal | Every physics tick (x-axis, then z-axis) |
| **Data Reuse** | None (separate path computed once) | Multiple queries of same volumes |

### Why This Divergence Exists

1. **Projectiles Need Physics** – Must reflect off surfaces with proper normal calculations
   - Requires face normal data (only available from raycaster hits)
   - Path tracing makes sense since projectile is "fired" once

2. **Player Movement is Continuous** – Runs every physics frame
   - AABB volumes are faster to test than raycasting
   - Simpler math (no normal calculations needed)
   - Can overlap volumes without artifacts (just push out)

3. **Historical Evolution** – System built incrementally
   - Player collision came first (simple AABB)
   - Projectile ricochet was added later (reused raycaster)
   - No refactor to unify them

---

## 4. How Solid Volumes Are Defined and Used

### Type Definition
[src/game.ts](src/game.ts#L147-L157):
```typescript
type SolidVolume = {
  kind?: 'box' | 'slope-x' | 'slope-z' | 'pyramid'
  minY: number
  maxY: number
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  topHeightAt?: (x: number, z: number) => number | null
}
```

### Creation Pipeline

#### Step 1: Brush Processing (in Brush Rendering)
[src/game.ts](src/game.ts#L2227), where `createPointBrushCollisionVolume()` is called:
```typescript
const pointBrushCollisionVolume = activeMap.sourceFormat === 'brush-map'
  ? createPointBrushCollisionVolume(brush)
  : null
```

#### Step 2: Shape Classification
[Lines 399-495](src/game.ts#L399-L495) in `createPointBrushCollisionVolume()`:
```typescript
// Analyze brush vertices to detect shape type
const apexPoints = brush.points.filter(p => Math.abs(p.y - brush.max.y) < 0.001)

if (apexPoints.length === 1) {
  // Single apex → PYRAMID
  return { kind: 'pyramid', topHeightAt: (x, z) => {...} }
}
if (apexPoints.length === 2) {
  if (Math.abs(apex1.z - apex2.z) < 0.001) {
    // Aligned along X → SLOPE-X
  } else if (Math.abs(apex1.x - apex2.x) < 0.001) {
    // Aligned along Z → SLOPE-Z
  }
}
// Fallback: BOX
```

#### Step 3: Addition to Arrays
Multiple locations add to `solidVolumes[]`:
- [Line 2202](src/game.ts#L2202): Quake .map brushes (convex geometry)
- [Line 2408](src/game.ts#L2408): BSP/brush-map faces with special shapes
- [Line 2436](src/game.ts#L2436): Default box fallback

### Usage Patterns

#### Pattern 1: Ground Height Query
[src/game.ts](src/game.ts#L3842):
```typescript
private getGroundHeightAt(x: number, z: number, maxY = Infinity) {
  let groundY = 0
  for (const volume of this.solidVolumes) {
    if (!this.isGroundSurface(volume)) continue
    const topY = this.getVolumeTopAt(volume, x, z)
    if (topY === null || topY > maxY) continue
    groundY = Math.max(groundY, topY)
  }
  return groundY
}
```
**Used for:** Finding landing surface after jumping

#### Pattern 2: Position Blocking Check
[src/game.ts](src/game.ts#L3858):
```typescript
private isPositionBlocked(x: number, z: number, padding = 0.45, probeY = this.floorLevel) {
  const bodyMinY = probeY - this.floorLevel
  const bodyMaxY = bodyMinY + this.playerBodyHeight
  return this.solidVolumes.some(volume => {
    // Detailed volume intersection check...
  })
}
```
**Used for:** Validating spawn positions, checking auto-step clearance

#### Pattern 3: Collision Resolution (Primary)
[src/game.ts](src/game.ts#L3741):
```typescript
private resolvePlayerCollisions(axis: 'x' | 'z') {
  for (const volume of this.solidVolumes) {
    // ... collision response logic
  }
}
```
**Used for:** Pushing player out of volumes each physics frame

### Helper Methods

```typescript
// Check if volume's top surface is accessible for this coordinates
private getVolumeTopAt(volume: SolidVolume, x: number, z: number) {
  if (x < volume.minX || x > volume.maxX || 
      z < volume.minZ || z > volume.maxZ) return null
  return volume.topHeightAt ? volume.topHeightAt(x, z) : volume.maxY
}

// Filter volumes by movement-blocking classification
private blocksHorizontalMovement(volume: SolidVolume) {
  if (volume.kind && volume.kind !== 'box') return true
  return !this.isGroundSurface(volume)
}

// Check if step height is within auto-climbing range
private canAutoStep(topY: number, feetY: number) {
  const stepHeight = topY - feetY
  return stepHeight > 0.02 && stepHeight <= this.maxAutoStepHeight  // 0.5
}
```

---

## 5. Duplicated and Redundant Collision Logic

### Duplication #1: AABB Boundary Tests

**Location 1** – [src/game.ts](src/game.ts#L3747-L3757):
```typescript
// In resolvePlayerCollisions()
if (
  this.player.x < volume.minX - this.playerRadius ||
  this.player.x > volume.maxX + this.playerRadius ||
  this.player.z < volume.minZ - this.playerRadius ||
  this.player.z > volume.maxZ + this.playerRadius
) {
  continue
}
```

**Location 2** – [src/game.ts](src/game.ts#L3864-L3870):
```typescript
// In isPositionBlocked()
if (
  x <= volume.minX - padding ||
  x >= volume.maxX + padding ||
  z <= volume.minZ - padding ||
  z >= volume.maxZ + padding ||
  bodyMaxY < volume.minY ||
  bodyMinY > volume.maxY
) {
  return false
}
```

**Problem:** Same test written twice with different operators (< vs <=). Where is the source of truth?

**Impact:** If one gets updated, the other must also be updated. Risk of divergence.

---

### Duplication #2: Player Body Height Calculation

**Location 1** – [src/game.ts](src/game.ts#L3743-L3745):
```typescript
const bodyMinY = this.player.y - this.floorLevel
const bodyMaxY = bodyMinY + this.playerBodyHeight
```

**Location 2** – [src/game.ts](src/game.ts#L3859-L3861):
```typescript
const bodyMinY = probeY - this.floorLevel
const bodyMaxY = bodyMinY + this.playerBodyHeight
```

**Problem:** Identical calculation repeated in 2+ places.

---

### Duplication #3: Nearest Point on Volume Finding

**Location 1** – [src/game.ts](src/game.ts#L3760-L3761):
```typescript
const nearestX = clamp(this.player.x, volume.minX, volume.maxX)
const nearestZ = clamp(this.player.z, volume.minZ, volume.maxZ)
```

**Location 2** – [src/game.ts](src/game.ts#L3873):
```typescript
const topY = this.getVolumeTopAt(volume, clamp(x, volume.minX, volume.maxX), clamp(z, volume.minZ, volume.maxZ))
```

**Problem:** Same projection logic repeated inline instead of extracted.

---

### Duplication #4: Enemy Projectile vs Player Projectile Collision

**Enemy Bolt Movement** – [src/game.ts](src/game.ts#L4497-L4540):
```typescript
private updateEnemyBolts(delta: number) {
  for (const bolt of this.enemyBolts) {
    const step = Math.min(bolt.remaining, bolt.speed * delta)
    const start = bolt.mesh.position.clone().addScaledVector(bolt.direction, ...)
    const end = start.clone().addScaledVector(bolt.direction, step)
    
    // Player collision check
    const playerHit = this.segmentHitsPlayer(start, end, 0.55)
    if (playerHit) { /* damage */ }
    
    // Wall collision check
    this.raycaster.set(start, bolt.direction)
    const wallHits = this.raycaster.intersectObjects(this.ricochetSurfaces, false)
    if (wallHits.length > 0) { /* impact */ }
    
    bolt.mesh.position.addScaledVector(bolt.direction, step)
  }
}
```

**Player Projectile Movement** – [src/game.ts](src/game.ts#L4346-L4430):
```typescript
private updateProjectiles(delta: number) {
  for (const projectile of this.projectiles) {
    let travel = Math.min(projectile.remaining, projectile.speed * delta)
    
    while (travel > 0 && projectile.segmentIndex < projectile.nodes.length) {
      // Follow pre-computed path nodes
      const from = projectile.segmentIndex === 0 ? projectile.start : projectile.nodes[...].point
      const to = projectile.nodes[projectile.segmentIndex].point
      const direction = to.clone().sub(from).normalize()
      
      const step = Math.min(remainingInSegment, travel)
      projectile.mesh.position.copy(from).addScaledVector(direction, projectile.segmentProgress - ...)
      
      // Check if we hit the enemy at this segment?
      const node = projectile.nodes[projectile.segmentIndex]
      if (node.enemy && node.damageOnArrival) {
        this.damageEnemy(node.enemy, node.point, ...)
        this.disposeProjectile(index)
      }
    }
  }
}
```

**Problem:** 
- Both move in discrete steps
- Both check collision (player vs walls)
- Different update mechanisms (path-following vs per-frame raycasting)
- No shared interface

---

### Duplication #5: Collision Filtering

**For Player:**
```typescript
if (!this.blocksHorizontalMovement(volume)) continue
```

**For Raycaster (implicit):**
```typescript
const bounceHits = this.raycaster.intersectObjects([...this.hitables, ...this.ricochetSurfaces], false)
```

**Problem:** Different objects tested against (solid volumes vs meshes). No unified filter.

---

## 6. Functions That Are Too Large or Do Multiple Things

### Function 1: `resolvePlayerCollisions()` – 70 lines
**[Lines 3741-3810](src/game.ts#L3741-L3810)**

**Responsibilities:**
1. ✗ Calculate current body bounds (lines 3743-3745)
2. ✗ Iterate over all volumes (line 3746)
3. ✗ Filter volumes by movement type (lines 3747-3749)
4. ✗ Perform AABB height range check (lines 3750-3752)
5. ✗ Perform AABB XZ boundary check (lines 3753-3758)
6. ✗ Get volume's top surface height (lines 3760-3762)
7. ✗ Check volume is walkable (line 3763)
8. ✗ Attempt auto-step (lines 3764-3773)
9. ✗ Calculate collision resolution (lines 3774-3808)
10. ✗ Apply velocity changes (lines 3791-3799)

**Suggested Decomposition:**
```typescript
// Could split into 4-5 focused functions:
resolvePlayerCollisions(axis: 'x' | 'z') {
  for (const volume of this.solidVolumes) {
    if (!this.shouldResolveCollision(volume, axis)) continue
    if (this.tryAutoStep(volume)) continue
    this.pushPlayerOut(volume, axis)
  }
}

shouldResolveCollision(volume, axis): boolean
tryAutoStep(volume): boolean
pushPlayerOut(volume, axis): void
```

---

### Function 2: `renderBrush()` – 279 lines
**[Lines 2160-2436](src/game.ts#L2160-L2436)**

**Responsibilities:**
1. ✗ Setup material and size (lines 2161-2169)
2. ✗ Define helper functions (isNonRenderableTexture, calculateFaceArea, triangulateFace, etc.)
3. ✗ Calculate display area threshold based on detail level (lines 2224-2229)
4. ✗ Create collision volume if it's a point-brush (line 2231)
5. ✗ Render Quake .map brushes (convex geometry path, lines 2234-2250)
6. ✗ Render BSP/brush-map faces (triangulated path, lines 2252-2425)
7. ✗ Render fallback geometry (lines 2427-2436)

**Nested Helper Functions (Embedded):**
- `isNonRenderableTexture()` – ~3 lines (used once)
- `calculateFaceArea()` – ~15 lines (factored out but stays embedded)
- `triangulateFace()` – ~50 lines (factored out but stays embedded)
- `getAreaThreshold()` – ~6 lines (single use)

**Suggested Decomposition:**
```typescript
renderBrush(brush) {
  const collisionVolume = this.createBrushCollisionVolume(brush)
  
  if (this.isBrushConvexShape(brush)) {
    this.renderConvexBrush(brush, collisionVolume)
  } else if (brush.faces?.length > 0) {
    this.renderFacedBrush(brush, collisionVolume)
  } else {
    this.renderFallbackBrush(brush, collisionVolume)
  }
}

// Extract ~50 lines
private isBrushConvexShape(brush): boolean
private renderConvexBrush(brush, volume): void
private renderFacedBrush(brush, volume): void
private renderFallbackBrush(brush, volume): void

// Extract to standalone utilities
triangulateFace(points, normal): number[][]
calculateFaceArea(points): number
calculateFaceNormal(points): Normal3D
getMaterialForFace(texture): Material
```

**Current Status:** Functions are embedded, making them hard to reuse or test.

---

### Function 3: `updateProjectiles()` – ~85 lines
**[Lines 4346-4430](src/game.ts#L4346-L4430)**

**Responsibilities:**
1. ✗ Calculate movement step size (line 4349)
2. ✗ Iterate through path segments (line 4351)
3. ✗ Calculate remaining distance in segment (lines 4357-4370)
4. ✗ Update position and orientation (lines 4371-4378)
5. ✗ Process node arrivals (damage, impacts) (lines 4381-4393)
6. ✗ Update opacity based on remaining distance (line 4400)
7. ✗ Cleanup when exhausted (line 4401)

**Could Extract:**
```typescript
// Separate concerns:
updateProjectiles(delta) {
  for (const projectile of this.projectiles) {
    if (this.moveProjectile(projectile, delta)) {
      this.processProjectileNode(projectile)
    }
    this.updateProjectileAppearance(projectile)
  }
}
```

---

### Function 4: `updateEnemyBolts()` – 32 lines
**[Lines 4497-4540](src/game.ts#L4497-L4540)**

**Responsibilities:**
1. ✗ Calculate movement step (line 4500)
2. ✗ Test player collision (line 4503)
3. ✗ Test wall collision (lines 4507-4512)
4. ✗ Update position (line 4514)
5. ✗ Update opacity (line 4515)

**Better structure:**
```typescript
updateEnemyBolts(delta) {
  for (const bolt of this.enemyBolts) {
    if (this.checkBoltCollisions(bolt)) {
      continue  // Disposed
    }
    this.moveBolt(bolt, delta)
  }
}

private checkBoltCollisions(bolt) {
  // Returns true if bolt was destroyed
}
```

---

## 7. Structural Problems Causing Divergence

### Problem 1: Collision Data Scattered Across 5 Arrays

**Current State:**
```typescript
private readonly solidVolumes: SolidVolume[] = []          // Player movement AABB volumes
private readonly ricochetSurfaces: THREE.Object3D[] = []   // Projectile raycaster targets
private readonly hitables: THREE.Object3D[] = []           // Enemy hit detection (raycaster)
private readonly brushMeshes: BrushMesh[] = []             // Rendering references
private readonly wallBoxes: THREE.Object3D[] = []          // Another rendering reference?
```

**Problem:**
- 5 arrays, 4 of them arguably overlapping
- No unified collision query interface
- Hard to add new query types (e.g., "get all solid walls")
- Raycaster objects managed separately from logical volumes

**Consequence:** Projectiles and player collisions can't share queries or data.

---

### Problem 2: Raycaster Used as Mutable Global State

```typescript
// Throughout codebase:
this.raycaster.set(bounceOrigin, bounceDirection)
this.raycaster.far = remaining
const bounceHits = this.raycaster.intersectObjects(...)

// Later:
this.raycaster.set(start, bolt.direction)
this.raycaster.far = step + 0.2
const wallHits = this.raycaster.intersectObjects(...)
```

**Problem:**
- Raycaster state mutated before each query
- If code path branches, raycaster might be in wrong state
- Could introduce subtle bugs if queries are reordered
- Not thread-safe (would matter for worker threads in future)

**Solution:** Create immutable query functions
```typescript
private raycastHit(origin: Vec3, direction: Vec3, maxDist: number, objects: Object3D[]) {
  const ray = new THREE.Raycaster()
  ray.set(origin, direction)
  ray.far = maxDist
  return ray.intersectObjects(objects, false)
}
```

---

### Problem 3: Brush Rendering Creates Collision Data

```typescript
// In renderBrush() around line 2200:
this.scene.add(mesh)
this.brushMeshes.push({ mesh, minY, maxY })
this.wallBoxes.push(mesh)
this.ricochetSurfaces.push(mesh)  // ← Now part of collision query
this.solidVolumes.push({          // ← And here
  minY, maxX..., topHeightAt
})
```

**Problem:**
- Rendering concerns (mesh creation) entangled with collision setup
- Can't change collision without changing render path
- Can't render geometry that isn't collidable
- `renderBrush()` has to know about collision details (topHeightAt functions)

**Consequence:** Impossible to have "render-only" obstacles or "collision-only" volumes.

---

### Problem 4: Player-Specific Logic Baked into Shared Shapes

```typescript
// createPointBrushCollisionVolume() creates shape with player-centric logic:
if (apexPoints.length === 1) {
  return {
    kind: 'pyramid',
    topHeightAt: (x, z) => {
      // This function knows about player-centric math
      const nx = Math.abs(x - apex.x) / halfWidth
      const nz = Math.abs(z - apex.z) / halfDepth
      const t = Math.max(0, 1 - Math.max(nx, nz))
      return brush.min.y + rise * t
    },
  }
}

// Later, getVolumeTopAt relies on this existing:
getVolumeTopAt(volume, x, z) {
  return volume.topHeightAt ? volume.topHeightAt(x, z) : volume.maxY
}
```

**Problem:**
- Slopes/pyramids only work for player (who calls `getVolumeTopAt`)
- Enemy movement would need own queries
- Hardcoded Chebyshev distance (`Math.max(nx, nz)`) won't generalize
- Can't query volume height without player-specific state

---

### Problem 5: Two Independent Path-Tracing Systems

**Player Projectiles** (Lines 4023-4151):
```typescript
// Pre-computed at creation with bounce logic
computeProjectileArc(start, direction, maxRange) {
  // Traces entire path including bounces
  // Returns array of node objects
  // Each node has { point, enemy?, damageOnArrival, ... }
}

spawnProjectile(start, nodes) {
  // Later, just follows nodes
}
```

**Enemy Bolts** (Lines 4245-4540):
```typescript
// Per-frame raycasting
fireEnemyBolt(enemy, direction) {
  // No path pre-computed
  bolt = { mesh, direction, remaining, speed }
}

updateEnemyBolts(delta) {
  // Each frame, test collision against ricochetSurfaces
  const wallHits = this.raycaster.intersectObjects(this.ricochetSurfaces)
}
```

**Problem:**
- Projective and reactive approaches can't share code
- Could generalize to a "movable object with collision" pattern
- Different damage models (pre-computed vs per-frame)
- Inefficient: enemy bolts recast every frame vs precomputed once

---

## 8. Summary of Issues

### Architectural Issues ⚠️

| Issue | Impact | Priority |
|-------|--------|----------|
| Two separate collision systems (raycaster vs AABB) | Code duplication, maintenance burden | **High** |
| Five collision arrays instead of one | Confusion, risk of desync | **High** |
| Raycaster mutated as global state | Fragility, hard to debug | **Medium** |
| Rendering entangled with collision | Can't decouple geometry concerns | **Medium** |
| Player-specific logic in shared shapes | Can't reuse for other entities | **Medium** |

### Code Quality Issues 📊

| Function | Lines | Concerns |
|----------|-------|----------|
| `resolvePlayerCollisions()` | 70 | 10 responsibilities |
| `renderBrush()` | 279 | 7+ responsibilities |
| `updateProjectiles()` | 85 | 7 responsibilities |
| `updateEnemyBolts()` | 32 | 5 responsibilities |
| Embedded helpers | 50-75 | Not extracted/testable |

### Redundancy Issues 🔄

| Type | Count | Locations |
|------|-------|-----------|
| AABB boundary tests | 2+ | resolvePlayerCollisions, isPositionBlocked |
| Body height calculation | 2+ | resolvePlayerCollisions, isPositionBlocked |
| Nearest point finding | 2+ | resolvePlayerCollisions, isPositionBlocked |
| Volume filtering | **N** (implicit) | Multiple (raycaster vs AABB) |

---

## Recommendations for Refactoring

### 1. **Unify Collision Query Interface** 🎯
Create a central `CollisionWorld` class:
```typescript
class CollisionWorld {
  // Unified queries
  raycast(ray, objects): Hit[]
  pointInVolume(x, y, z): Volume | null
  nearestPointOnVolume(point, volume): Point
  getVolumeHeight(volume, x, z): number
  
  // Filtering
  filterByMovementType(volumes, axis): Volume[]
  filterWalkable(volumes): Volume[]
}
```

**Benefit:** Both player and projectiles use same interface.

---

### 2. **Extract renderBrush() Into Focused Functions** 📦
```typescript
// Current: 279-line renderBrush()
// New structure:

renderBrush(brush) {
  const material = this.getMaterialForBrush(brush)
  const collisionVolume = this.createCollisionVolume(brush)
  
  if (this.isBrushConvexShape(brush)) {
    this.addConvexMesh(brush, material, collisionVolume)
  } else if (brush.faces) {
    this.addFaceMesh(brush, material, collisionVolume)
  } else {
    this.addFallbackMesh(brush, material, collisionVolume)
  }
  
  this.registerCollisionVolume(collisionVolume)
}

// Split extracted helpers:
triangulateFace(points, normal): Triangles  // Utility
calculateFaceArea(points): number           // Utility
calculateFaceNormal(p1, p2, p3): Normal    // Utility
```

**Benefit:** Each function ~30-50 lines, single responsibility.

---

### 3. **Separate Rendering from Collision** 🔀
Instead of:
```typescript
this.scene.add(mesh)
this.ricochetSurfaces.push(mesh)
this.solidVolumes.push({ ... })
```

Use:
```typescript
// Rendering layer
const mesh = createMesh(brush)
this.scene.add(mesh)

// Collision layer (separate)
const collisionVolume = createCollisionVolume(brush)
this.collisionWorld.register(collisionVolume)
```

**Benefit:** Can have render-only or collision-only objects.

---

### 4. **Consolidate Projectile Movement** 🚀
Create shared `Projectile` type for both player and enemy:
```typescript
type Projectile = {
  meshId: string
  position: Vec3
  velocity: Vec3
  lifetime: number
  radius: number
  owner: 'player' | 'enemy'
  onHitWall?: (point: Vec3) => void
  onHitPlayer?: (point: Vec3, damage: number) => void
}

// Shared update logic:
updateProjectile(proj, delta) {
  const step = proj.velocity.length() * delta
  const newPos = proj.position.clone().addScaledVector(proj.velocity, delta)
  
  const collision = world.raycast(proj.position, proj.velocity, proj.radius)
  if (collision) {
    proj.onHitWall?.(collision.point)
    return true  // Should remove
  }
  
  proj.position = newPos
  proj.lifetime -= delta
}
```

**Benefit:** One update loop, both projectile types.

---

### 5. **Extract Physics Constants** 📋
```typescript
// Create constants object:
const PLAYER_PHYSICS = {
  // Dimensions
  radius: 0.45,
  height: 1.7,
  floorLevel: 0.33,
  
  // Movement
  maxAutoStepHeight: 0.5,
  autoStepVelocityCap: 1.5,
  
  // Gravity
  gravity: 26,
  jumpForce: 9.1,
  
  // Damage from falling
  criticalFallVelocity: -7.5,
}

// Usage:
const bodyHeight = PLAYER_PHYSICS.height
const bodyMinY = player.y - PLAYER_PHYSICS.floorLevel
```

**Benefit:** Magic numbers visible in one place, easier to tune.

---

### 6. **Extract AABB Utility Functions** 🎲
```typescript
// Utility module:
function aabbYRangeCheck(
  bodyMinY: number,
  bodyMaxY: number,
  volume: SolidVolume
): boolean {
  return bodyMaxY >= volume.minY && bodyMinY <= volume.maxY
}

function aabbXZBoundaryCheck(
  x: number,
  z: number,
  volume: SolidVolume,
  padding: number
): boolean {
  return x > volume.minX - padding && x < volume.maxX + padding &&
         z > volume.minZ - padding && z < volume.maxZ + padding
}

function projectPointOntoVolume(
  x: number,
  z: number,
  volume: SolidVolume
): { x: number; z: number } {
  return {
    x: clamp(x, volume.minX, volume.maxX),
    z: clamp(z, volume.minZ, volume.maxZ),
  }
}

// Usage:
if (aabbYRangeCheck(bodyMinY, bodyMaxY, volume) &&
    aabbXZBoundaryCheck(player.x, player.z, volume, playerRadius)) {
  const nearest = projectPointOntoVolume(player.x, player.z, volume)
  // ...
}
```

**Benefit:** Single source of truth, testable, reusable in enemy collision.

---

### 7. **Reduce resolvePlayerCollisions() Complexity** 🎯
```typescript
// Current: ~70 lines doing 10 things

// Split into:
private resolvePlayerCollisions(axis: 'x' | 'z') {
  for (const volume of this.getRelevantVolumes(axis)) {
    if (this.tryAutoStep(volume)) continue
    this.pushPlayerOutOfVolume(volume)
  }
}

private getRelevantVolumes(axis: 'x' | 'z'): SolidVolume[] {
  const { minY, maxY } = this.getPlayerBodyBounds()
  return this.solidVolumes.filter(volume => 
    this.blocksHorizontalMovement(volume) &&
    aabbYRangeCheck(minY, maxY, volume) &&
    aabbXZBoundaryCheck(this.player.x, this.player.z, volume, this.playerRadius)
  )
}

private tryAutoStep(volume: SolidVolume): boolean {
  const topY = this.getVolumeTopAt(volume, ...)
  if (!this.canAutoStep(topY, ...)) return false
  
  if (this.isPositionBlocked(...)) return false
  
  // Apply step
  this.player.y = topY + this.floorLevel
  this.velocity.y = 0
  return true
}

private pushPlayerOutOfVolume(volume: SolidVolume) {
  const delta = this.getPlayerCenterToNearestPoint(volume)
  const distance = delta.length()
  
  if (distance >= this.playerRadius) return
  
  const direction = delta.normalize()
  const push = this.playerRadius - distance
  
  this.player.x += direction.x * push
  this.velocity.x = 0
  // (similar for z-axis)
}
```

**Benefit:** Each function handles one thing, ~20-30 lines each.

---

### 8. **Testing Recommendations** 🧪
With the refactored code, add unit tests:
```typescript
// Test AABB utils
test('aabbYRangeCheck overlaps correctly')
test('aabbXZBoundaryCheck includes padding')

// Test collision responses
test('resolvePlayerCollisions pushes player out')
test('resolvePlayerCollisions does auto-step when eligible')
test('resolvePlayerCollisions clears velocity on collision')

// Test shape detection
test('createPointBrushCollisionVolume detects pyramids')
test('createPointBrushCollisionVolume detects slopes')
```

---

## Priority Implementation Order

1. **Quick Wins** (Low risk, high value)
   - Extract AABB utilities → immediately reusable
   - Extract physics constants → clearer code
   - Extract render helpers → improves readability

2. **Medium Risk, High Value**
   - Split `resolvePlayerCollisions()` into smaller functions
   - Separate rendering from collision registration
   - Create immutable raycaster queries

3. **Major Refactor** (High risk, needs careful testing)
   - Create unified `CollisionWorld` class
   - Consolidate projectile systems
   - Eliminate redundant arrays

---

## Conclusion

The VibeQuake collision detection system has evolved with **two parallel approaches** (raycaster for projectiles, AABB for players) that create **significant code duplication** and **maintenance burden**. The current architecture leaves **9 major functions doing too many things** and scatters **collision data across 5 arrays**.

The recommended refactoring path prioritizes **separating concerns** (rendering vs collision), **extracting reusable utilities**, and **creating a unified query interface** so that projectiles and players can share collision logic in the future.
