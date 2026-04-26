# Architecture (v1)

## System overview

v1 uses a frontend-first web app with a thin local backend:

- **Frontend**: React + TypeScript + Vite.
- **Backend**: Node sidecar (Express or Fastify) with `better-sqlite3`.
- **Storage**: single SQLite file on disk.

Frontend communicates with backend over localhost API endpoints. Backend is the only layer that reads/writes the database.

## Runtime and startup lifecycle

1. Launch command starts frontend and backend together.
2. Backend resolves database file path.
3. Backend opens SQLite file (create if missing).
4. Backend applies migrations in order.
5. Backend starts HTTP API server.
6. Frontend loads daily state through API.

## Database file location

- **Development default**: `<project directory>/productivity_app/data/morning-planner.db`
- **Production default**: user data directory path to be finalized during packaging.

The path must be configurable through environment variable so deployment environments can choose storage location.

## Time and date contract (canonical)

To keep validation and scheduling deterministic, frontend and backend share these rules:

- **Day identity**: a day is represented as `YYYY-MM-DD` in the user's local timezone.
- **API route date** (`/api/day/:date`) uses that local-day key format.
- **Stored timestamps** are ISO-8601 UTC (`...Z`) for persisted event/block/session instants.
- **Validation comparisons** for "same day" and planning windows are performed using the local timezone day key, not naive string compare on UTC dates.
- **Planner ordering** uses normalized epoch timestamps derived from validated local-day inputs.
- **DST handling**:
  - Non-existent local times (spring-forward gaps) are rejected with validation errors.
  - Ambiguous local times (fall-back overlap) are interpreted by explicit offset when provided; otherwise reject as ambiguous input.

## Domain model

### Core entities

- **DayPlan**: per-date aggregate root for all day-bound records.
- **Task**: user-defined daily work item.
- **RecurringTemplate**: reusable checklist template not tied to a specific day.
- **DailyRecurringItem**: day-specific recurring checklist status materialized from a template.
- **FixedEvent**: immutable day constraint (for example meeting/appointment), not a task.
- **PlanRun**: one deterministic generation output for a day.
- **PlanBlock**: generated focus or break block for a specific plan run.
- **ExecutionSession**: live execution cursor/state for a day.
- **BlockExecution**: per-block runtime progress and completion record.

## SQLite schema (v2 simplified)

```sql
CREATE TABLE IF NOT EXISTS day_plans (
  id TEXT PRIMARY KEY,
  date_iso TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT,
  priority_rank INTEGER NOT NULL,
  estimated_pomodoros INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (estimated_pomodoros IS NULL OR estimated_pomodoros > 0),
  UNIQUE (day_plan_id, priority_rank)
);

CREATE TABLE IF NOT EXISTS recurring_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_recurring_items (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  recurring_template_id TEXT NOT NULL REFERENCES recurring_templates(id),
  title_snapshot TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (day_plan_id, recurring_template_id)
);

CREATE TABLE IF NOT EXISTS fixed_events (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  start_time_iso TEXT NOT NULL,
  end_time_iso TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_time_iso < end_time_iso)
);

CREATE TABLE IF NOT EXISTS plan_runs (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  generation_version INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (day_plan_id, generation_version)
);

CREATE TABLE IF NOT EXISTS plan_blocks (
  id TEXT PRIMARY KEY,
  plan_run_id TEXT NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  source_task_id TEXT REFERENCES tasks(id),
  block_type TEXT NOT NULL, -- focus | break
  label TEXT NOT NULL,
  start_time_iso TEXT NOT NULL,
  end_time_iso TEXT NOT NULL,
  sequence_index INTEGER NOT NULL,
  planned_minutes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (start_time_iso < end_time_iso),
  UNIQUE (plan_run_id, sequence_index)
);

CREATE TABLE IF NOT EXISTS execution_sessions (
  id TEXT PRIMARY KEY,
  day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
  active_plan_run_id TEXT REFERENCES plan_runs(id),
  active_block_id TEXT REFERENCES plan_blocks(id),
  state TEXT NOT NULL, -- idle | running | paused | completed
  started_at TEXT,
  paused_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (day_plan_id)
);

CREATE TABLE IF NOT EXISTS block_executions (
  id TEXT PRIMARY KEY,
  plan_block_id TEXT NOT NULL REFERENCES plan_blocks(id) ON DELETE CASCADE,
  state TEXT NOT NULL, -- pending | running | paused | completed | skipped
  started_at TEXT,
  completed_at TEXT,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  UNIQUE (plan_block_id)
);
```

## Repository boundaries

Backend repositories should be separated by responsibility:

- `DayPlanRepository`: day lookup/create and aggregate root methods.
- `TaskRepository`: CRUD + ranking operations for tasks.
- `RecurringRepository`: template management + day materialization.
- `FixedEventRepository`: CRUD and overlap checks for fixed events.
- `PlanRepository`: create plan runs, save/replace generated plan blocks.
- `ExecutionRepository`: persist/recover active execution session and per-block progress.

Planner engine and API handlers depend on repository interfaces, not raw SQL calls.

## API boundary (v1)

Frontend talks only to these backend domains:

- `GET/PUT /api/day/:date/tasks`
- `GET/PUT /api/day/:date/recurring`
- `GET/PUT /api/day/:date/events`
- `POST /api/day/:date/generate-plan`
- `GET /api/day/:date/timeline`
- `GET/PUT /api/day/:date/execution-session`

Endpoint shape can evolve, but domain separation should remain stable.

## Modeling decisions to avoid foot-guns

- Keep recurring templates globally managed; only daily recurring item instances are day-bound.
- Keep fixed events as distinct constraints, not as synthetic task rows.
- Keep generated plan data (`plan_runs`, `plan_blocks`) separate from runtime execution data (`execution_sessions`, `block_executions`).
- Build timeline responses by composing fixed events and generated plan blocks at query time.
- Treat `day_plans.date_iso` as the canonical day key for all day-level lookup and idempotent upsert flows.

## API contract source of truth

- Define request/response/error schemas for all v1 endpoints before frontend/backend parallel implementation.
- Keep contracts in shared TypeScript schema definitions (or generated types from OpenAPI) consumed by both client and server.
- Every endpoint must define:
  - success payload shape
  - validation error shape
  - not-found/conflict error shape (when applicable)
  - stable field naming and nullability policy

## Strict-flow state model

Wizard progress is persisted in backend-owned state so refresh/restart is recoverable:

- selected day key
- current step id
- per-step completion flags
- step validation status and blocking reasons
- last successful "preflight ready for generation" timestamp

Frontend may cache for UX responsiveness, but backend persisted state is authoritative.

## Definition of done evidence

For architecture-affecting changes, PR/review notes must include:

- updated contract docs for changed endpoints
- migration impact statement (if schema changed)
- restart/recovery verification notes
- explicit out-of-scope confirmation for v1 non-goals

## Integration-ready design points

- Keep provider adapters (calendar, Obsidian) outside core planner and repositories.
- Introduce adapter interfaces early, implement adapters later.
- Never mix external provider payloads directly into core tables; map to internal model first.

