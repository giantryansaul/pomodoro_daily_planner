# Milestones and Delivery Plan

## Guiding principle

Deliver in small, reviewable chunks where each milestone produces visible value and has explicit acceptance criteria.

## Start gate (required before Milestone 2 coding)

Before substantial implementation begins, lock these decisions in docs:

- Milestone sequencing for plan generation vs planner engine.
- Canonical time/date contract (timezone, day identity, DST behavior, comparisons).
- Typed `dayStore` surface and shared validation rules.
- Persistence and recovery behavior for `localStorage`-backed day bundles.
- Plan regeneration behavior after execution has started.

If any item is unresolved, treat execution work as blocked and continue specification only.

## Milestone 1: Foundation and docs

### Scope

- Scaffold React + TypeScript + Vite frontend.
- Create project docs:
  - `PROJECT_OVERVIEW.md`
  - `docs/product-requirements.md`
  - `docs/architecture.md`
  - `docs/planner-engine.md`
  - `docs/milestones.md`
  - `docs/test-plan.md`

### Exit criteria

- App starts locally with `npm run dev`.
- Documentation is coherent and cross-linked.

### Testing required for milestone sign-off

- `npm run lint` is clean.

## Milestone 2: Data model and persistence

### Scope

- Define shared TypeScript types for tasks, recurring items, fixed events, schedule blocks, and timer session in `src/types.ts`.
- Implement `src/dayStore.ts` and `src/storage/local.ts` as the only modules that touch `localStorage`.
- Seed first-run defaults (day boundaries, 4 recurring templates) and materialize recurring items per day.

### Exit criteria

- CRUD operations persist and survive a page refresh.
- `dayStore` exposes a stable, fully-typed surface to `App.tsx`.

### Testing required for milestone sign-off

- Manual refresh test: edits persist after reload.
- Future automated coverage tracked in `docs/test-plan.md` section "Storage and dayStore behavior".

## Milestone 3: Daily editing workspace (pre-generation)

### Scope

- Build same-page editing workspace with three visible edit panels:
  - tasks
  - recurring daily items
  - manual calendar events
- Add paused-by-default 10-minute planning timer with start/pause/reset controls.
- Add Save Day flow that persists inputs through `dayStore` and triggers plan generation.
- Default to editing mode when no generated timeline exists for the day.
- Freeze the `dayStore` Save Day surface for tasks, recurring, events, and validation errors.

### Exit criteria

- User can complete setup in one workspace and generate a timeline.
- Planning timer does not start until the user starts it.
- Required input validation failures are user-visible and deterministic.

### Testing required for milestone sign-off

- Editing workspace covers all three panels and Save Day behavior.
- Manual refresh test validates persisted day inputs and generated timeline recovery.
- Validation rejections in `dayStore` are exercised in unit tests when added.

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
- `dayStore.generatePlan` regeneration behavior covered by unit tests when added.

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
- Active timer always reflects persisted state from `dayStore`.
- Completed blocks are reflected in timeline status.
- Timeline entries are rendered chronologically after generation and regeneration.

### Testing required for milestone sign-off

- UI tests verify timeline and timer synchronization.
- Timer control tests cover start/pause/resume/skip transitions.
- Regeneration tests cover duplicate prevention and chronological ordering.
- Accessibility checks validate keyboard navigation and visible focus.

## Milestone 6: QA hardening and release readiness

### Scope

- Complete unit coverage for core planner behavior.
- Add baseline manual smoke test for the daily planning journey.
- Validate reliability on page refresh and date changes.

### Exit criteria

- Lint/tests pass consistently.
- Known edge cases documented and either fixed or explicitly deferred.
- First internal release candidate is stable for daily usage.

### Testing required for milestone sign-off

- `npm run lint` and `npm run test` are green.
- Manual smoke test passes for the full daily planning journey (see `docs/test-plan.md`).
- No unresolved P0/P1 defects.

## Milestone 7: React-only refactor (done)

### Scope

- Remove the Node + better-sqlite3 sidecar entirely; the app is now a single Vite static site.
- Port the planner into the frontend (`src/planner.ts`) and keep its 7 unit tests under Vitest.
- Replace every REST call in `App.tsx` with `dayStore` calls backed by `localStorage`.
- Flatten the repo: `frontend/` contents moved to the root; npm workspaces dropped.
- Update all docs to reflect the frontend-only architecture; delete the prior "rebuild elsewhere" reference docs.

### Exit criteria

- No `fetch` or `/api` references remain in `src/`.
- `npm install`, `npm run lint`, `npm run test`, and `npm run build` all succeed at the root.
- Existing SQLite data file is gone and the app runs with empty `localStorage` by seeding defaults.

### Testing required for milestone sign-off

- 7 ported planner tests pass.
- Manual smoke: clear `localStorage`, reload, see seeded recurring templates and `07:00`/`19:00` defaults; complete an editing → timeline → timer cycle; refresh and confirm state persisted.

### Superseded gates

- Earlier milestones referenced "API contract tests", "DB migration bootstrap", and "restart persistence test confirms durability against the SQLite file". Those gates are obsolete with the backend removed; the equivalent guarantee is now provided by manual refresh tests against `localStorage`.

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
- sample `dayStore` inputs/outputs for changed contracts
- explicit non-goal confirmation (what was intentionally not implemented)

