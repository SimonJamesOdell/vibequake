# PHOTONIC Safe Refactor Plan

Date: 2026-03-09
Status: Approved for phased execution
Scope: Preserve current gameplay feel and working multiplayer while improving maintainability and netcode safety.

## Why Refactor Now

- Core game loop feels good and multiplayer is validated with real two-player sessions.
- Current implementation is feature-productive but concentrated in large modules (especially `src/game.ts`).
- This is the best time to harden architecture before adding more complexity (animations, more weapons, higher player counts).

## Non-Negotiable Safety Rules

1. No big-bang rewrite. Only vertical slices with immediate rollback.
2. One behavior-changing subsystem at a time.
3. Every phase has explicit:
- Success criteria
- Kill switch / fallback
- Verification steps
4. Keep old path in code behind a flag until new path is proven.
5. Merge small PRs only (target < 500 LOC net change per PR unless isolated file split).

## Baseline (Do This Before Phase 1)

Objective: lock in current "known good" behavior.

### Baseline Checklist

- Record current controls and movement feel notes on one map:
- sprint speed feel
- jump timing/height feel
- air control feel
- hit registration feel
- Validate multiplayer flows:
- two players join same world
- one player disconnects/rejoins
- death/respawn sync
- god mode sync in dev
- Confirm LAN dev access works (`vite` host on `0.0.0.0`).

### Baseline Artifacts

Create and keep updated:

- `docs/refactor-session-log.md` (session notes)
- `docs/refactor-risk-log.md` (regressions + mitigations)

## Feature Flags Strategy

Use runtime flags so each refactor is reversible.

Suggested flags:

- `VITE_FEATURE_AVATAR_SYSTEM_V2`
- `VITE_FEATURE_INPUT_MAP_V2`
- `VITE_FEATURE_NET_SEQ_V2`
- `VITE_FEATURE_SERVER_RECON_V2`

Rules:

- Default all new flags to `false`.
- Flip one flag at a time in development.
- Never remove old path in same PR that introduces new path.

## Phased Plan

## Phase 1: Avatar System Extraction (Low Risk, High Clarity)

Goal: move remote-player avatar creation/update/disposal out of `Game` into a dedicated module without changing gameplay logic.

### Deliverables

- New module: `src/systems/avatar-system.ts`
- Encapsulate:
- avatar creation
- visual update from `PlayerState`
- cleanup/disposal
- Keep external API tiny:
- `upsertRemotePlayer(...)`
- `removeRemotePlayer(...)`
- `clearAll(...)`

### Safety Checks

- Remote players still spawn at correct height.
- Name labels still update and dispose correctly.
- No memory leak symptoms after repeated join/leave.

### Rollback

- Keep old inline avatar path behind `VITE_FEATURE_AVATAR_SYSTEM_V2=false`.

## Phase 2: Input Action Map + Dev Commands (Low Risk)

Goal: remove hardcoded key logic branching from one large handler and centralize keybinds.

### Deliverables

- New module: `src/input/actions.ts`
- Map action names to default keys:
- movement
- fire
- god mode
- dev toggles (`L`, `G`, `V`, `F10`, `Backquote`)
- New module: `src/input/dev-commands.ts`
- Keep behavior unchanged.

### Safety Checks

- Existing controls remain identical by default.
- `F10` and `Backquote` both toggle god mode in dev.
- Pointer lock transitions do not break input.

### Rollback

- Keep previous direct key checks behind `VITE_FEATURE_INPUT_MAP_V2=false`.

## Phase 3: Protocol Hardening (No Simulation Change Yet)

Goal: improve network safety before authority changes.

### Deliverables

- Extend shared contracts (`src/shared/multiplayer.ts`) with optional metadata:
- `inputSeq` on client input
- `serverTick` on server state updates
- `sentAt` timestamps where useful
- Server validates monotonic `inputSeq` per client.
- Client tracks latest acknowledged sequence.

### Safety Checks

- No gameplay change with flags off.
- Multiplayer remains compatible during transition (optional fields first).
- Logging confirms seq/tick data is flowing.

### Rollback

- Treat metadata as optional; ignore when absent.

## Phase 4: Client Prediction + Reconciliation Scaffold (Shadow Mode)

Goal: add reconciliation path without taking authority away from current path yet.

### Deliverables

- Client keeps local predicted movement history by `inputSeq`.
- On authoritative update, compute divergence metrics:
- positional error
- correction frequency
- Keep "shadow compare" only (do not snap player yet).

### Safety Checks

- Zero visible behavior change with shadow mode.
- Divergence telemetry collected in dev console.

### Rollback

- Shadow compare disabled via `VITE_FEATURE_SERVER_RECON_V2=false`.

## Phase 5: Server-Authoritative Movement Cutover (Highest Risk)

Goal: switch to authoritative movement with conservative reconciliation.

### Deliverables

- Server owns final player position and validity checks.
- Client predicts locally, reconciles to server with smoothing.
- Add safeguards:
- max correction per frame
- dead reckoning timeout handling

### Safety Checks

- Movement still feels responsive.
- No frequent rubber-banding under normal LAN latency.
- No obvious wall-clip exploits from client-side spoofing.

### Rollback

- One-flag fallback to legacy movement authority.

## Phase 6: Cleanup and Deletion of Legacy Paths

Goal: remove dead code only after stable burn-in.

### Exit Criteria

- At least 3 stable play sessions with no blocker regressions.
- Risk log has no open critical items.
- Flagged paths have been default-on for one full cycle.

### Deliverables

- Remove legacy code branches.
- Remove feature flags that are fully adopted.
- Update docs and architecture notes.

## Test and Verification Matrix

Run for every phase PR:

1. `npm run build`
2. Manual single-player smoke test (movement/combat)
3. Manual two-player smoke test:
- join same room
- remote avatar movement
- kill/respawn flow
- pickup sync
4. Dev cheats check (`F10` and `Backquote`)
5. Join/leave stress:
- join, leave to main menu, rejoin, repeat 5x

## PR Template (Use Per Refactor Slice)

- Objective:
- Flag introduced/used:
- Behavior changes expected:
- Rollback command/step:
- Verification completed:
- Known risks:

## Session-by-Session Execution Template

For each work session append to `docs/refactor-session-log.md`:

- Date:
- Phase:
- PR/commit refs:
- Flags state:
- What was changed:
- What was validated:
- Regressions found:
- Decision:
- proceed
- hold
- rollback
- Next session first task:

## Immediate Next Step

Start Phase 1 only:

1. Extract avatar code into `src/systems/avatar-system.ts` behind `VITE_FEATURE_AVATAR_SYSTEM_V2`.
2. Keep old code path intact.
3. Validate join/leave, height anchoring, and disposal.
4. Document results in `docs/refactor-session-log.md`.
