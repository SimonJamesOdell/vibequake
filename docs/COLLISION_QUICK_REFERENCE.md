# Quick Reference: Collision Detection Functions

## Core Functions by Line Number

### Player Collision (src/game.ts)
| Function | Lines | Lines | Purpose |
|----------|-------|-------|---------|
| `resolvePlayerCollisions()` | [3741-3810](src/game.ts#L3741-L3810) | 70 | Resolve player-volume collisions** |
| `isGroundSurface()` | [3802-3816](src/game.ts#L3802-L3816) | 15 | Classify volume as walkable |
| `blocksHorizontalMovement()` | [3817-3825](src/game.ts#L3817-L3825) | 9 | Filter volumes by movement blocking |
| `getVolumeTopAt()` | [3827-3833](src/game.ts#L3827-L3833) | 7 | Query surface height at coordinates |
| `getGroundHeightAt()` | [3842-3852](src/game.ts#L3842-L3852) | 11 | Find max ground surface in area |
| `isPositionBlocked()` | [3858-3901](src/game.ts#L3858-L3901) | 44 | Test if position is blocked** |
| `randomOpenPosition()` | [3903-3920](src/game.ts#L3903-L3920) | 18 | Find random unblocked spawn |
| `getStepHeight()` | [3834-3837](src/game.ts#L3834-L3837) | 4 | Calculate step height (redundant?) |
| `canAutoStep()` | [3838-3841](src/game.ts#L3838-L3841) | 4 | Check if step is within auto-climb range |

### Projectile Collision (src/game.ts)
| Function | Lines | Count | Purpose |
|----------|-------|-------|---------|
| `computeProjectileArc()` | [4000-4108](src/game.ts#L4000-L4108) | 109 | Trace projectile path with bounces** |
| `spawnProjectile()` | [4115-4157](src/game.ts#L4115-L4157) | 43 | Create projectile mesh and add to pool |
| `updateProjectiles()` | [4346-4430](src/game.ts#L4346-L4430) | 85 | Update all projectiles each frame** |
| `disposeProjectile()` | [4229-4236](src/game.ts#L4229-L4236) | 8 | Remove projectile |

### Enemy Projectile Collision (src/game.ts)
| Function | Lines | Count | Purpose |
|----------|-------|-------|---------|
| `fireEnemyBolt()` | [4245-4260](src/game.ts#L4245-L4260) | 16 | Create enemy projectile |
| `updateEnemyBolts()` | [4497-4540](src/game.ts#L4497-L4540) | 44 | Update all enemy projectiles** |
| `disposeEnemyBolt()` | [4265-4272](src/game.ts#L4265-L4272) | 8 | Remove enemy projectile |
| `segmentHitsPlayer()` | [4263-4266](src/game.ts#L4263-L4266) | 4 | Test line segment collision with player |

### Shape Definition (src/game.ts)
| Function | Lines | Count | Purpose |
|----------|-------|-------|---------|
| `createPointBrushCollisionVolume()` | [399-495](src/game.ts#L399-L495) | 97 | Detect special shapes (pyramid, slopes) and create volume |
| `SolidVolume` type | [147-157](src/game.ts#L147-L157) | 11 | Type definition for collision volumes |

### Brush Rendering & Collision Setup (src/game.ts)
| Function | Lines | Count | Purpose |
|----------|-------|-------|---------|
| `renderBrush()` | [2160-2436](src/game.ts#L2160-L2436) | 279 | Render brush geometry AND create collision data** |
| *Embedded:* `calculateFaceArea()` | ~2175-2190 | 15 | Compute triangle area |
| *Embedded:* `triangulateFace()` | ~2193-2244 | 52 | Triangulate polygon |
| *Embedded:* `getAreaThreshold()` | ~2224-2230 | 6 | Compute detail-based threshold |

**= Functions with multiple responsibilities (marked with **)

---

## Data Structures

### Collections (src/game.ts)
```typescript
private readonly solidVolumes: SolidVolume[] = []          // Line 766 – Player collision AABB volumes
private readonly ricochetSurfaces: THREE.Object3D[] = []   // Line 765 – Projectile raycaster targets
private readonly hitables: THREE.Object3D[] = []           // Line 758 – Enemy hit detection
private readonly brushMeshes: BrushMesh[] = []             // Rendering references
private readonly wallBoxes: THREE.Object3D[] = []          // Another copy?
```

### Raycaster (Global Mutable State)
```typescript
private readonly raycaster = new THREE.Raycaster()         // Line 759 – SHARED for all raycasts
```

---

## Key Constants & Magic Numbers

### Player Physics
```typescript
playerRadius: number = 0.45              // Distance from center to collision edge
playerBodyHeight: number = 1.7            // Height of player collision cylinder
floorLevel: number = 0.33                 // Y-offset where player's feet are
maxAutoStepHeight: number = 0.5           // Max step up without jumping
```

### Gravity & Forces
```typescript
gravity constant: 26                      // Lines 3699 – downward acceleration
jump velocity: 9.1                        // Line 3695 – upward velocity on jump
jump velocity cap: 1.5                    // Line 3764 – velocity check for auto-step
critical fall velocity: -7.5              // Line 3734 – damage threshold
```

### Projectile Physics
```typescript
max bounces: 3 + weaponUpgradeTier        // Lines 4055, calculated – total ricochets
bounce offset: 0.18                       // Line 4062 – prevent re-hitting
initial projectile radius: 0.035 → 0.095  // Lines 4138-4139 – by upgrade tier
```

---

## Issue Hotspots by Category

### Duplicated Logic
- **AABB boundary tests:** [3747-3758](src/game.ts#L3747-L3758) vs [3864-3870](src/game.ts#L3864-L3870)
- **Body height calculation:** [3743-3745](src/game.ts#L3743-L3745) vs [3859-3861](src/game.ts#L3859-L3861)
- **Volume iteration:** [3746](src/game.ts#L3746), [3844](src/game.ts#L3844), [3867](src/game.ts#L3867), [4371](src/game.ts#L4371)

### Overly Complex Functions (>50 lines)
- **resolvePlayerCollisions():** 70 lines, [3741-3810](src/game.ts#L3741-L3810) ⚠️
- **renderBrush():** 279 lines, [2160-2436](src/game.ts#L2160-L2436) ⚠️⚠️
- **updateProjectiles():** 85 lines, [4346-4430](src/game.ts#L4346-L4430) ⚠️
- **createPointBrushCollisionVolume():** 97 lines, [399-495](src/game.ts#L399-L495) ✓ (Acceptable – single responsibility)

### Embedded Utility Functions (Should be extracted)
- `calculateFaceArea()` – Used only in renderBrush()
- `triangulateFace()` – Used only in renderBrush()
- `getAreaThreshold()` – Used only in renderBrush()

---

## Divergence Points

### Why Projectiles Use Pre-Computed Paths
- Must calculate bounce direction from face normals
- Face normals only available from raycaster returns
- Path is semi-static (depends only on weapon upgrade)
- Bounce limit is small (3-5 max)

### Why Player Uses AABB Volumes
- Player moves continuously, needs fast checks
- AABB overlaps don't glitch (can push out)
- Multiple volumes can affect same area
- Slopes/pyramids need height functions (not faces)

### Why Enemy Bolts Are Different
- Simpler projectiles, could reuse player projectile code
- Currently duplicates raycasting logic
- Could be consolidated with player projectiles

---

## Recommended Extraction Order

### Phase 1: Utilities (Low Risk)
1. Extract AABB boundary test → `aabbIntersect(bounds, volume)`
2. Extract body height calc → use `PLAYER_PHYSICS.height`
3. Extract `calculateFaceArea()` → standalone function
4. Extract `triangulateFace()` → standalone function

### Phase 2: Separation of Concerns (Medium Risk)
1. Move collision volume registration out of renderBrush()
2. Create immutable raycaster queries
3. Consolidate hitables/ricochetSurfaces query

### Phase 3: Function Decomposition (High Risk, Needs Testing)
1. Split `resolvePlayerCollisions()` into 4 functions
2. Split `renderBrush()` into 5-7 functions
3. Create unified projectile update loop

---

## Testing Checklist

- [ ] Player collision pushes correctly on all sides
- [ ] Auto-step works at boundary heights (0.02 to 0.5)
- [ ] Player doesn't get stuck in corners
- [ ] Projectile ricochets calculate correct bounce direction
- [ ] Enemy bolts hit walls and player correctly
- [ ] Spawn positions never block existing geometry
- [ ] Pyramid/slope shapes are walked correctly
- [ ] Y-collision doesn't interfere with XZ movement resolution
