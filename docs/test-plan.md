# Test Plan and Guidelines

## Quality goals

- Planning output is deterministic and constraint-safe.
- Timer behavior is reliable across refresh.
- Daily editing flow reliably saves inputs before timeline generation.
- Core user journey remains stable as features expand.

## Document boundary

- This document defines cross-cutting testing strategy, layers, and handoff tactics.
- Milestone-specific "what must be tested before sign-off" lives in `docs/milestones.md`.
- When milestone requirements change, update `docs/milestones.md` first, then adjust tactics here only if the testing approach changes.

## Test layers

### 1) Unit tests (planner engine)

Run via `npm run test` (Vitest). Lives in [`src/planner.test.ts`](../src/planner.test.ts).

- Schedules focus blocks in priority order.
- Inserts breaks according to 25/5 rules.
- Never overlaps fixed events or timed recurring events.
- Produces overflow results when time is insufficient.
- Handles boundary conditions (small windows, end-of-day, empty task list).
- Custom day planning windows are honored.
- Repeated generation does not duplicate fixed events.

### 2) Storage and dayStore behavior (planned)

`src/dayStore.ts` is the only module that mutates `localStorage`. It currently has no automated test suite; future tests should cover:

- First-run seeding of day boundary defaults and the 4 recurring templates.
- `replaceTasks` clears `sourceTaskId` from existing timeline blocks.
- `replaceEvents` deduplicates by `title|start|end`.
- `generatePlan` preserves `completed` blocks and only replaces `planned` ones.
- `resetAndGenerate` clears task statuses, recurring completions, and timer state.
- `clearDay` re-materializes recurring from active templates.
- `markBlockCompleted` flips both the block and its source task.

Use a thin localStorage stub (e.g. `vitest-localstorage-mock` or a hand-rolled in-memory `Storage`) when this layer is added.

### 3) Frontend component tests (deferred)

There is currently no component-test runner configured. When component tests are added, they should cover:

- Editing workspace shows task, recurring, and event panels together for day setup.
- Planning timer starts paused and supports start, pause, and reset.
- Each task row exposes in-place editing for title and estimated Pomodoros.
- Edit Timeline for Day returns from timeline mode to the editing workspace.
- Timeline list renders ordered blocks with readable labels/times.
- Active timer panel reflects running and paused states.
- Overflow warnings appear when unscheduled tasks exist.

### 4) End-to-end smoke (manual)

- New day opens editing mode with paused planning timer, saves the day, then shows the generated timeline.
- Timeline edit flow reopens edit panels and recalculates the day after Save Day.
- Repeated refresh/save/regenerate does not duplicate fixed events or stale planned blocks.
- Timeline ordering places earlier events and blocks before later ones.
- Refresh during active timer keeps expected active block.
- User can complete recurring checklist and see persisted state after refresh.
- `localStorage` clear returns the app to first-run defaults.

## Acceptance checklist before feature handoff

- [ ] Requirements updated if behavior changed.
- [ ] Unit tests added for new planner or dayStore logic.
- [ ] `npm run lint` and `npm run test` are green.
- [ ] Manual verification notes captured for UI behavior.
- [ ] No data-loss regressions in refresh scenarios.
- [ ] Storage shape changes documented in `docs/architecture.md` and bump `pomDay.schemaVersion` if breaking.
- [ ] Non-goal scope check completed (no unplanned integrations/customizations).
