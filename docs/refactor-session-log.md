# Refactor Session Log

Use this log for every refactor session so work can resume safely across conversations.

## Entry Template

- Date:
- Phase:
- PR/commit refs:
- Flags state:
- What changed:
- Validation run:
- Regressions found:
- Decision (`proceed` | `hold` | `rollback`):
- Next session first task:

---

## 2026-03-09

- Date: 2026-03-09
- Phase: Planning/Baseline
- PR/commit refs: N/A
- Flags state: N/A
- What changed: Created safe phased refactor plan and tracking logs.
- Validation run: N/A
- Regressions found: None
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Start Phase 1 avatar extraction behind `VITE_FEATURE_AVATAR_SYSTEM_V2`.

## 2026-03-09 (Phase 1 In Progress)

- Date: 2026-03-09
- Phase: Phase 1 - Avatar System Extraction
- PR/commit refs: Working tree (not yet committed)
- Flags state: `VITE_FEATURE_AVATAR_SYSTEM_V2` introduced, default off unless explicitly set to `true`
- What changed: Created `src/systems/avatar-system.ts` with `upsertRemotePlayer`, `updateRemotePlayer`, `removeRemotePlayer`, `clearAll`; wired `src/game.ts` to route avatar operations through the new system when the flag is enabled; kept existing inline avatar path as fallback.
- Validation run: `npm run build` passed; no TypeScript errors in `src/game.ts` and `src/systems/avatar-system.ts`.
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Run manual two-player join/leave and avatar height checks with `VITE_FEATURE_AVATAR_SYSTEM_V2=true`, then document results and decide whether to keep advancing Phase 1.

## 2026-03-09 (Phase 1 Validation)

- Date: 2026-03-09
- Phase: Phase 1 - Avatar System Extraction
- PR/commit refs: Working tree (not yet committed)
- Flags state: `VITE_FEATURE_AVATAR_SYSTEM_V2=true` tested manually; fallback path remains available.
- What changed: No additional code changes; executed manual verification pass on top of extracted avatar system integration.
- Validation run: Manual confirmation from active testing that gameplay and multiplayer avatar behavior are working as expected.
- Regressions found: None reported.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Phase 1 cleanup pass (reduce duplicate fallback logic surface if desired) or start Phase 2 input action map scaffolding behind `VITE_FEATURE_INPUT_MAP_V2`.

## 2026-03-09 (Phase 2 Scaffolding)

- Date: 2026-03-09
- Phase: Phase 2 - Input Action Map + Dev Commands
- PR/commit refs: Working tree (not yet committed)
- Flags state: Added `VITE_FEATURE_INPUT_MAP_V2` (default off unless explicitly set to `true`)
- What changed: Added `src/input/actions.ts` and `src/input/dev-commands.ts`; wired `src/game.ts` to use mapped actions/commands when the flag is enabled while preserving legacy key-path fallback behavior.
- Validation run: `npm run build` passed; no TypeScript errors in `src/game.ts`, `src/input/actions.ts`, and `src/input/dev-commands.ts`.
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Run manual controls parity check with `VITE_FEATURE_INPUT_MAP_V2=true` (movement, jump/fly toggle, `L/G/V`, `F10/~`) and then evaluate trimming duplicated legacy branches.

## 2026-03-09 (Phase 3 Protocol Hardening)

- Date: 2026-03-09
- Phase: Phase 3 - Protocol Hardening
- PR/commit refs: Working tree (not yet committed)
- Flags state: No new flag required for optional metadata path; existing behavior remains compatible.
- What changed: Added optional protocol metadata in shared contracts (`inputSeq`, `serverTick`, `sentAt`, `latestInputSeqByPlayer`); client now tags input with monotonic sequence and tracks latest server-acknowledged input sequence; server now validates monotonic `inputSeq` per client and emits `serverTick` + sequence acknowledgements on `state-sync`.
- Validation run: `npm run build` passed (client + server).
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Add lightweight dev telemetry for divergence/ack lag and begin Phase 4 shadow reconciliation metrics without changing movement authority.

## 2026-03-09 (Phase 4 Shadow Metrics Scaffold)

- Date: 2026-03-09
- Phase: Phase 4 - Client Prediction/Reconciliation Scaffold (Shadow Mode)
- PR/commit refs: Working tree (not yet committed)
- Flags state: `VITE_FEATURE_SERVER_RECON_V2` now gates client-side telemetry logging only; no authority/correction behavior change.
- What changed: `NetworkClient` now forwards optional state-sync metadata to game callbacks; `VibeQuake` now computes and logs shadow reconciliation metrics in dev (`avg/max positional divergence`, `avg/max yaw divergence`, `input ack gap`, `one-way sync timing estimate`) and resets these metrics on leave-to-menu.
- Validation run: `npm run build` passed (client + server).
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Add bounded client-side history buffer keyed by `inputSeq` to support targeted correction experiments while preserving shadow-only mode.

## 2026-03-09 (Phase 4 Input History + Shadow Correction Deltas)

- Date: 2026-03-09
- Phase: Phase 4 - Client Prediction/Reconciliation Scaffold (Shadow Mode)
- PR/commit refs: Working tree (not yet committed)
- Flags state: `VITE_FEATURE_SERVER_RECON_V2` still telemetry-only; no authority/correction application.
- What changed: Added a bounded client input history buffer keyed by `inputSeq`; on state-sync ack metadata, the client now looks up the acknowledged sample and computes shadow correction deltas (position/yaw) against authoritative player state; telemetry logging now includes these ack-indexed divergence metrics in addition to live divergence and ack gap.
- Validation run: `npm run build` passed (client + server).
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Add opt-in visual debug overlay or HUD line for recon telemetry and define thresholds that would trigger future correction clamping in Phase 5.

## 2026-03-09 (Latency-Aware Server Foundations)

- Date: 2026-03-09
- Phase: Phase 4/5 Bridge - Latency Awareness Primitives
- PR/commit refs: Working tree (not yet committed)
- Flags state: No new runtime flag; behavior remains authoritative and conservative.
- What changed: Added app-level `net-ping`/`net-pong` protocol messages; client now auto-responds to pings; server tracks per-client RTT/jitter and now buffers sequenced inputs with bounded reordering grace before applying updates, including gap-skipping fallback when a missing sequence ages out.
- Validation run: `npm run build` passed (client + server).
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Surface latency/reorder stats in developer telemetry and tune reorder grace clamps based on live LAN/WAN sessions.

## 2026-03-09 (Latency Stats Surfaced in Telemetry)

- Date: 2026-03-09
- Phase: Phase 4/5 Bridge - Observability
- PR/commit refs: Working tree (not yet committed)
- Flags state: Uses existing `VITE_FEATURE_SERVER_RECON_V2` telemetry path.
- What changed: Added optional `latencyByPlayer` snapshot to `state-sync` metadata from server (`rttMs`, `jitterMs`, `outOfOrderInputs`, `droppedInputGaps`) and surfaced these values in the client reconciliation debug log for the local player.
- Validation run: `npm run build` passed (client + server).
- Regressions found: None observed in compile/build validation.
- Decision (`proceed` | `hold` | `rollback`): proceed
- Next session first task: Run LAN+simulated-latency sessions and tune `INPUT_REORDER_BASE_MS`/`INPUT_REORDER_MAX_MS` with observed metrics.
