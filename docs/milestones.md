# Milestones and Delivery Plan

## Guiding principle

Deliver in small, reviewable chunks where each milestone produces visible value and has explicit acceptance criteria.

## Start gate (required before Milestone 2 coding)

Before substantial implementation begins, lock these decisions in docs:

- Milestone sequencing for plan generation vs planner engine.
- Canonical time/date contract (timezone, day identity, DST behavior, comparisons).
- Typed API contracts and shared error model.
- Strict-flow persistence and recovery behavior.
- Plan regeneration behavior after execution has started.

If any item is unresolved, treat execution work as blocked and continue specification only.

## Milestone 1: Foundation and docs

### Scope

- Scaffold React + TypeScript + Vite frontend.
- Scaffold Node sidecar API with `better-sqlite3`.
- Provide one command to run frontend and backend in development.
- Create project docs:
  - `PROJECT_OVERVIEW.md`
  - `docs/product-requirements.md`
  - `docs/architecture.md`
  - `docs/planner-engine.md`
  - `docs/milestones.md`
  - `docs/test-plan.md`

### Exit criteria

- App and API both start locally.
- DB file created and migration bootstrap works.
- Documentation is coherent and cross-linked.

### Testing required for milestone sign-off

- One command verifies frontend/backend dev startup behavior.
- Migration bootstrap is validated against a clean database file.

## Milestone 2: Data model and persistence

### Scope

- Implement schema and migration runner.
- Implement repository layer for tasks, recurring items, fixed events, plan runs/blocks, and execution state.
- Implement day-based data loading/saving API endpoints.

### Exit criteria

- CRUD operations persist and reload after restart.
- API contracts are typed and stable for frontend integration.

### Testing required for milestone sign-off

- Migration and repository unit/integration tests pass.
- Restart persistence test confirms data durability.
- API contract tests verify success and error payload shapes.

## Milestone 3: Daily editing workspace (pre-generation)

### Scope

- Build same-page editing workspace with three visible edit panels:
  - tasks
  - recurring daily items
  - manual calendar events
- Add paused-by-default 10-minute planning timer with start/pause/reset controls.
- Add Save Day flow that persists inputs and hands off to generation endpoint.
- Default to editing mode when no generated timeline exists for the day.
- Freeze API/UI contract for Save Day payloads and validation errors.

### Exit criteria

- User can complete setup in one workspace and generate a timeline.
- Planning timer does not start until the user starts it.
- Required input validation failures are user-visible and deterministic.

### Testing required for milestone sign-off

- Editing workspace tests cover all three panels and Save Day behavior.
- Refresh/restart tests validate persisted day inputs and generated timeline recovery.
- Validation error UX is covered by component/integration tests.

## Milestone 4: Planner engine

### Scope

- Implement deterministic scheduling behavior from `docs/planner-engine.md`.
- Wire Save Day generation action to real engine output.
- Add overflow reporting and user-facing warnings.
- Persist generated schedule blocks.
- Define and implement regeneration rules when execution already started.

### Exit criteria

- Engine output respects fixed events and priority ordering.
- Overflow cases are explicit and test-covered.
- End-to-end setup flow now produces persisted timeline blocks.
- Regeneration preserves completed history and replaces only allowed future blocks.

### Testing required for milestone sign-off

- Planner unit suite covers deterministic ordering and edge conditions.
- Overflow assertions include unscheduled reason coverage.
- Generation endpoint integration tests cover regeneration conflict/error behavior.

## Milestone 5: Timeline and active timer UI

### Scope

This milestone is split into UI-focused sub-chunks:

1. **Timeline list foundation**
   - Left panel layout for ordered blocks.
   - Display block start/end, type, and label.
2. **Active timer panel foundation**
   - Right panel showing active block, remaining time, and next block.
3. **Execution controls**
   - Start/pause/resume/skip actions.
   - Visual state transitions for running/paused/completed blocks.
4. **Recovery and continuity**
   - Rehydrate active session on refresh/restart.
   - Keep timeline and timer synchronized.
5. **Timeline editing**
   - Edit Timeline for Day reopens the editing workspace.
   - Save Day recalculates the timeline without duplicate events or stale blocks.
6. **Polish and accessibility**
   - Keyboard-safe controls, focus states, readable contrast.

### Exit criteria

- Two-panel layout works across normal desktop widths.
- Active timer always reflects backend state.
- Completed blocks are reflected in timeline status.
- Timeline entries are rendered chronologically after generation and regeneration.

### Testing required for milestone sign-off

- UI tests verify timeline and timer synchronization.
- Timer control tests cover start/pause/resume/skip transitions.
- Regeneration tests cover duplicate prevention and chronological ordering.
- Accessibility checks validate keyboard navigation and visible focus.

## Milestone 6: QA hardening and release readiness

### Scope

- Complete unit and integration coverage for core planner/timer behavior.
- Add baseline E2E flow test for daily planning journey.
- Validate reliability on app restart and date changes.

### Exit criteria

- Lint/tests pass consistently.
- Known edge cases documented and either fixed or explicitly deferred.
- First internal release candidate is stable for daily usage.

### Testing required for milestone sign-off

- Full suite passes in local and CI-equivalent commands.
- End-to-end smoke tests pass for the full daily planning journey.
- Launch gate confirms no unresolved P0/P1 defects.

## Check-in cadence

- Checkpoint after each milestone with:
  - completed scope
  - acceptance evidence
  - open risks
  - proposed next milestone adjustments

## Milestone evidence requirements

Each milestone check-in must include concrete artifacts:

- test evidence (test names/commands and pass results)
- manual verification notes for user-visible behavior
- sample API payloads/responses for changed contracts
- explicit non-goal confirmation (what was intentionally not implemented)

