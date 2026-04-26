# Morning Planner Web App

## Purpose

Morning Planner is a local-first web app for starting the day with a clear plan. It guides the user through a strict morning flow:

1. Spend 10 minutes selecting the most important tasks.
2. Review and check off recurring daily tasks.
3. Enter fixed events (meetings, appointments) for the day.
4. Generate a Pomodoro-based timeline around those constraints.
5. Execute the day with a live active-task timer view.

The first release is single-user and local-only. It is intentionally designed so calendar and Obsidian integrations can be added later without rewriting the core planner.

## Read This First (Agent and Human Entry Point)

If you are making changes, start here and follow this order:

1. `PROJECT_OVERVIEW.md` (this file): high-level product scope and rules.
2. `docs/product-requirements.md`: detailed v1 behavior and acceptance expectations.
3. `docs/architecture.md`: frontend/backend split, API boundaries, storage model.
4. `docs/milestones.md`: delivery chunks and done criteria.

## Product Scope

### In scope for v1

- React + TypeScript + Vite frontend.
- Thin local Node backend started together with the app.
- File-backed SQLite persistence via `better-sqlite3`.
- Strict guided daily planning sequence.
- Daily recurring checklist with per-day completion.
- Manual fixed-event input for schedule constraints.
- Pomodoro schedule generation with 25/5 defaults.
- Left timeline list and right active timer panel.

### Out of scope for v1

- Calendar provider integration.
- Obsidian integration.
- Multi-user accounts, cloud sync, and remote APIs.
- Calendar write-back and automatic meeting import.
- Customizations for user preferences.

## Frontend and Backend Contract

- Frontend is the primary UX surface and contains presentation/state orchestration.
- Backend owns durable storage and planning/timer domain operations.
- Frontend should not write directly to SQLite. All persistence goes through backend APIs.
- Backend must open a local SQLite file on startup, run migrations, and serve requests.

## Data Durability Rules

- The source of truth is a SQLite database file on disk.
- In-memory state is permitted only for caching/session convenience, never as the sole persisted store.
- Startup behavior must be deterministic: open DB file, apply migrations, then start API.

## Agent Collaboration Guidelines (Cursor and Claude Code)

### Where to log decisions

- Add architectural choices and rationale to `docs/architecture.md`.
- Add product behavior decisions to `docs/product-requirements.md`.
- Update delivery sequencing in `docs/milestones.md`.

### Change workflow expectations

1. Read related sections in all docs before implementing.
2. Keep changes scoped to the active milestone.
3. Update docs when behavior, contracts, or acceptance criteria change.
4. Validate changes with lint/tests before handoff when project tooling exists.

### Definition of done for feature changes

- Behavior implemented and aligned with documented requirements.
- Edge cases covered in logic-level tests where practical.
- API contract changes reflected in docs.
- No silent scope expansion beyond the active milestone.

## Milestone Summary

See `docs/milestones.md` for full details. Current milestone sequence:

1. Foundation and documentation.
2. Data model and persistence.
3. Strict daily setup flow (pre-generation).
4. Pomodoro planning engine + generation wiring.
5. Timeline and active timer UI.
6. QA hardening and release readiness.

