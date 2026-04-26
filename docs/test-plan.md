# Test Plan and Guidelines

## Quality goals

- Planning output is deterministic and constraint-safe.
- Timer behavior is reliable across refresh and restart.
- Daily editing flow reliably saves inputs before timeline generation.
- Core user journey remains stable as features expand.

## Document boundary

- This document defines cross-cutting testing strategy, layers, and handoff tactics.
- Milestone-specific "what must be tested before sign-off" lives in `docs/milestones.md`.
- When milestone requirements change, update `docs/milestones.md` first, then adjust tactics here only if the testing approach changes.

## Test layers

## 1) Unit tests (backend domain logic)

### Planner engine

- Schedules focus blocks in priority order.
- Inserts breaks according to 25/5 rules.
- Never overlaps fixed events.
- Produces overflow results when time is insufficient.
- Handles boundary conditions (small windows, end-of-day, empty task list).
- Enforces canonical local-day validation (invalid/ambiguous times rejected).
- Regeneration preserves completed blocks and protects active running block.

### Repository behavior

- CRUD functions return expected shapes.
- Ordering operations maintain stable rank.
- Cascading deletions behave correctly by day context.

### Timer session logic

- Start/pause/resume updates elapsed values correctly.
- Skip transitions to next block and updates status.
- Recovery reconstructs active state from persisted data.

## 2) Integration tests (API + DB)

- Startup migration creates required tables.
- Daily flow endpoints work together for one date:
  - create tasks
  - save recurring daily state
  - add fixed events
  - generate plan
  - read timeline
  - persist timer session
- Data survives process restart.
- Endpoint contracts (success + error shapes) match shared schema definitions.

## 3) Frontend component tests

- Editing workspace shows task, recurring, and event panels together for day setup.
- Planning timer starts paused and supports start, pause, and reset.
- Each task row exposes in-place editing for title and estimated Pomodoros.
- Edit Timeline for Day returns from timeline mode to the editing workspace.
- Timeline list renders ordered blocks with readable labels/times.
- Active timer panel reflects running and paused states.
- Overflow warnings appear when unscheduled tasks exist.

## 4) End-to-end smoke tests

- New day opens editing mode with paused planning timer, saves the day, then shows the generated timeline.
- Timeline edit flow reopens edit panels and recalculates the day after Save Day.
- Repeated refresh/save/regenerate does not duplicate fixed events or stale planned blocks.
- Timeline ordering places earlier events and blocks before later ones.
- Refresh during active timer keeps expected active block.
- User can complete recurring checklist and see persisted state.

## Acceptance checklist before feature handoff

- [ ] Requirements updated if behavior changed.
- [ ] Unit/integration tests added for new logic.
- [ ] Manual verification notes captured for UI behavior.
- [ ] No data-loss regressions in restart scenarios.
- [ ] Contract changes include sample request/response/error payloads.
- [ ] Non-goal scope check completed (no unplanned integrations/customizations).

