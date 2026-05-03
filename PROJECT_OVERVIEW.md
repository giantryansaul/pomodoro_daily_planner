# Pom Day Web App

## Purpose

Pom Day is a frontend-only web app for starting the day with a clear plan. It guides the user through a focused morning flow:

1. Use a paused-by-default 10-minute planning timer to choose the day intentionally.
2. Edit tasks, recurring items, and known calendar events on one planning page.
3. Save the day to generate a Pomodoro-based timeline around those constraints.
4. Execute the day with a chronological timeline and live active-task timer view.

The first release is single-user and runs entirely in the browser. All data lives in `localStorage`. Calendar and Obsidian integrations can be added later as adapter modules without rewriting the core planner.

## Read This First (Agent and Human Entry Point)

If you are making changes, start here and follow this order:

1. `PROJECT_OVERVIEW.md` (this file): high-level product scope and rules.
2. `docs/product-requirements.md`: detailed v1 behavior and acceptance expectations.
3. `docs/architecture.md`: module layout, storage shape, and planner boundary.
4. `docs/milestones.md`: delivery chunks and done criteria.

## Product Scope

### In scope for v1

- React 19 + TypeScript + Vite frontend.
- Browser-only app — no backend, no network calls, no server install.
- Persistence via `window.localStorage`, namespaced under `pomDay.*`.
- Same-page daily editing workspace with task, recurring, and event panels.
- Daily recurring checklist with per-day completion.
- Manual fixed-event input for schedule constraints.
- Pomodoro schedule generation with 25/5 defaults.
- Calendar timeline view with an active timer panel.
- Timeline edit/recalculate flow for revising the day after generation.

### Out of scope for v1

- Calendar provider integration.
- Obsidian integration.
- Multi-user accounts, cloud sync, and remote APIs.
- Calendar write-back and automatic meeting import.
- Customizations for user preferences beyond day boundaries.
- Cross-device sync. Data is per-browser only.

## App boundary

- The app is a single Vite-built static site. There is no server-side component.
- All durable writes go through `src/dayStore.ts`, which is the only module that touches `localStorage`.
- The planner (`src/planner.ts`) is pure and consumes/returns plain data. It has no I/O.
- React components read and write through `dayStore`; they do not touch storage directly.

## Data Durability Rules

- The source of truth is the user's browser `localStorage`. Clearing storage resets the app to first-run defaults.
- In-memory React state is permitted only for UX responsiveness and must be reconciled to localStorage on every save.
- First-run behavior is deterministic: read storage, seed defaults if absent (4 default recurring templates and `07:00`/`19:00` day boundaries), then render.

## Agent Collaboration Guidelines (Cursor and Claude Code)

### Where to log decisions

- Add architectural choices and rationale to `docs/architecture.md`.
- Add product behavior decisions to `docs/product-requirements.md`.
- Update delivery sequencing in `docs/milestones.md`.

### Change workflow expectations

1. Read related sections in all docs before implementing.
2. Keep changes scoped to the active milestone.
3. Update docs when behavior, contracts, or acceptance criteria change.
4. Validate changes with `npm run lint` and `npm run test` before handoff.

### Definition of done for feature changes

- Behavior implemented and aligned with documented requirements.
- Edge cases covered in logic-level tests where practical (planner unit tests, dayStore unit tests when added).
- Storage shape changes documented in `docs/architecture.md`.
- No silent scope expansion beyond the active milestone.

## Milestone Summary

See `docs/milestones.md` for full details. Current milestone sequence:

1. Foundation and documentation.
2. Data model and persistence (localStorage layer).
3. Daily editing workspace (pre-generation).
4. Pomodoro planning engine and generation wiring.
5. Timeline and active timer UI.
6. QA hardening and release readiness.
7. React-only refactor (done): backend and SQLite removed; storage moved to `localStorage`.
