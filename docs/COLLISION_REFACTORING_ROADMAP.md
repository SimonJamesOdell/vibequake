# Collision Refactoring Roadmap

## Phase 1: ✅ COMPLETE – Utilities Extraction

**Status:** Done
- Extracted duplicated AABB logic into reusable functions
- Removed 100+ lines of duplication
- Created collision-geometry.ts module
- Build verified with zero errors

## Phase 2: Function Decomposition (Next)

**Objectives:**
- Split `resolvePlayerCollisions()` into 4-5 focused functions
- Split `renderBrush()` into separate render + collision paths
- Extract embedded helpers from large functions

**Key Tasks:**
1. Extract `attemptAutoStep()` function
2. Extract `pushPlayerAwayFromVolume()` function
3. Extract collision filtering into `shouldResolveCollision()`
4. Create brush rendering utilities (calculateFaceArea, triangulateFace, etc.)

**Estimated Impact:**
- Reduce resolvePlayerCollisions to 30 lines
- Reduce renderBrush to 150 lines
- Improve testability dramatically

## Phase 3: Data Structure Consolidation (Higher Risk)

**Objectives:**
- Unify 5 collision arrays into single CollisionWorld structure
- Create clear contract: What can collide with what?
- Reduce state management complexity

**Key Tasks:**
1. Create CollisionWorld class
2. Consolidate solidVolumes, ricochetSurfaces, hitables, brushMeshes
3. Add query interface: `getCollidingVolumes()`, `queryPoint()`, etc.
4. Update player collision to use new interface
5. Update projectile system to use new interface

**Estimated Impact:**
- 50% reduction in state variable complexity
- Single source of truth for what's collidable
- Easier to debug state desync issues

## Phase 4: Cross-Entity Collision (Advanced)

**Objectives:**
- Generalize collision to work for enemies, projectiles, pickups
- Create entity collision interface
- Support different collision profiles

**Key Tasks:**
1. Create CollisionProfile type (radius, height, vertical offset)
2. Replace hardcoded player dimensions with profile
3. Use same resolveCollisions() for all entities
4. Unify projectile systems (player + enemy into one)

---

## Why This Order?

**Phase 1** (✅ Done) – Low risk, immediate benefits
- No behavior changes
- Build succeeds immediately
- Sets up for next phases

**Phase 2** – Medium risk, high clarity
- Easier to test each piece independently
- No architectural changes
- Can stop here if desired

**Phase 3** – Higher risk, eliminates class of bugs
- Requires careful refactoring
- But fixes root cause of state desync
- Enables Phase 4

**Phase 4** – Highest risk, highest reward
- Unifies multiple systems
- Creates reusable collision framework
- Enables physics-based gameplay features

---

## Key Principles for Next Phases

1. **Test After Each Step** – Build must succeed after every change
2. **No Behavior Changes** – Refactoring ≠ features
3. **Incremental** – Don't do all of Phase 2 at once
4. **Document** – Each extracted function needs clear purpose
5. **Metrics** – Track lines of code, duplication, testability

---

## When to Stop Refactoring

- Player collision works correctly and consistently
- Code is readable enough that new bugs are rare
- Most logic is in utility functions (easily testable)
- No more silent divergence between code paths

**We don't need to do all 4 phases** – Phase 1-2 should be enough to eliminate the platform bugs caused by duplicated logic.
