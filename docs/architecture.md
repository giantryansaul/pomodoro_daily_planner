# Architecture (v1, frontend-only)

## System overview

Pom Day is a single static React app:

- **Frontend**: React 19 + TypeScript + Vite.
- **Storage**: the browser's `window.localStorage`.
- **Backend**: none. There is no server, no API, and no network call.

The app is built with `vite build` into a static `dist/` bundle and can be served by any static host or opened from disk.

## Module boundaries

```
src/
  main.tsx          # React bootstrap
  App.tsx           # All UI; calls dayStore for every read/write
  dayStore.ts       # The only module that touches localStorage; mirrors the old REST surface
  planner.ts        # Pure scheduling function; returns ordered blocks + unscheduled list
  storage/local.ts  # Typed JSON wrapper over window.localStorage
  types.ts          # Shared domain types
  planner.test.ts   # Vitest unit tests for planner
```

- `App.tsx` never reads or writes `localStorage` directly. It calls `dayStore.*` (async functions returning resolved Promises so call sites can `await` naturally).
- `dayStore.ts` orchestrates day bundle reads, applies validation, calls `planner.generatePlan` when needed, and writes results back to storage.
- `planner.ts` has zero I/O. It can be unit-tested without DOM or storage stubs.

## Time and date contract (canonical)

To keep validation and scheduling deterministic:

- **Day identity**: `YYYY-MM-DD` in the user's local timezone. Computed once at app load: `new Date().toISOString().slice(0, 10)`.
- **Day-bundle storage key**: `pomDay.day.<YYYY-MM-DD>`.
- **Stored timestamps** are ISO-8601 strings for persisted block/event instants.
- **Validation comparisons** for "same day" and planning windows use the local-timezone day key.
- **Planner ordering** uses normalized epoch timestamps derived from those ISO strings.

DST behavior is inherited from the platform `Date`: non-existent local times produce invalid `Date` instances which validators reject; ambiguous local times use the platform's default offset.

## Storage layout

All keys are namespaced under `pomDay.*` in `window.localStorage`.

| Key | Shape | Purpose |
|---|---|---|
| `pomDay.schemaVersion` | `"1"` | Bump on breaking changes; future migrations branch on this. |
| `pomDay.dayBoundaryDefaults` | `{ dayStartTimeHhmm, dayEndTimeHhmm }` | Default planning window. Seeded with `07:00`/`19:00` on first read. |
| `pomDay.recurringTemplates` | `RecurringTemplate[]` | Global recurring list. Seeded once with 4 defaults: Inbox zero, Read technical post, Exercise, Lunch. |
| `pomDay.day.<YYYY-MM-DD>` | `DayBundle` | Per-day aggregate (see below). |

### DayBundle

```ts
type DayBundle = {
  id: string;                      // stable per-day uuid
  dateIso: string;                 // matches the storage key suffix
  tasks: Task[];                   // user-defined work for the day
  fixedEvents: FixedEvent[];       // manual calendar constraints
  dailyRecurring: DailyRecurringItem[]; // materialized from templates on first touch
  timeline: ScheduleBlock[];       // generator output + completion status
  timerSession: TimerSession;      // execution timer state for the day
  createdAt: string;
  updatedAt: string;
};
```

The bundle is the unit of write — every `dayStore` mutation rewrites the whole bundle for its date. Bundle size is small (typical: a few KB) and well within `localStorage`'s ~5MB budget.

## Domain model

- **DayBundle**: per-date aggregate root for all day-bound records.
- **Task**: user-defined daily work item.
- **RecurringTemplate**: reusable global checklist template (lives outside any day bundle).
- **DailyRecurringItem**: day-specific recurring instance materialized from a template.
- **FixedEvent**: immutable day constraint (for example a meeting), not a task.
- **ScheduleBlock**: focus, break, fixed_event, or recurring_event entry produced by the planner; carries a `status` (`planned`/`completed`/`skipped`).
- **TimerSession**: live execution cursor and elapsed-seconds counter for the day.

## dayStore surface

`dayStore` mirrors the old REST contract one-for-one so call sites in `App.tsx` keep their shape. Each function is `async` and returns a resolved Promise.

| Function | Purpose |
|---|---|
| `getDayBoundaryDefaults` / `setDayBoundaryDefaults` | Read or persist the default planning window. |
| `getTasks` / `replaceTasks` | Bulk replace the day's task list. |
| `getRecurring` / `updateRecurring` | Read materialized recurring items; apply per-day completion or timed/template edits. |
| `createRecurringTemplateForDay` | Append to global templates and re-materialize the day. |
| `getEvents` / `replaceEvents` | Bulk replace fixed events with HH:MM and overlap dedupe. |
| `generatePlan` | Run `planner.generatePlan` and replace `planned` blocks (preserving completed history). |
| `resetAndGenerate` | Reset task statuses, recurring completions, and timer state, then regenerate. |
| `clearDay` | Wipe tasks, events, recurring, timeline, and timer; reseed recurring from active templates. |
| `getTimeline` | Return the day's `timeline` slice. |
| `markBlockCompleted` | Mark a timeline block (and any source task) completed. |
| `updateFocusSession` / `updateTimelineEvent` | Inline-edit a focus block + adjacent break, or a fixed event. |
| `getTimerSession` / `upsertTimerSession` | Read or upsert the per-day execution timer. |

Validation rules carried over from the previous backend:

- HH:MM strings match `^([01]\d|2[0-3]):[0-5]\d$`.
- `start < end` for any time range.
- Fixed events deduped by `title|startTimeIso|endTimeIso`.
- Recurring template input requires non-empty title plus a valid start/end pair.

## Daily editing and timeline state model

The frontend presents a day in one of two UI modes:

- **Editing mode**: task edits, recurring eliminations, manual events, and the paused-by-default planning timer.
- **Timeline mode**: generated chronological timeline plus execution timer controls.

The mode is derived from persisted state on load:

- If `dayBundle.timeline` is empty, open editing mode.
- If timeline blocks exist, open timeline mode.
- `Edit Timeline for Day` switches the UI back to editing mode without changing storage until Save Day.

Save Day performs one idempotent regeneration flow:

1. Replace day tasks from the submitted task list.
2. Update day-specific recurring item completion/elimination states.
3. Replace fixed events from the submitted event list.
4. Generate a new plan from the latest persisted inputs.
5. Replace prior `planned` timeline blocks for the day; preserve completed history.
6. Return the timeline sorted by normalized timestamp.

This flow does not append duplicate fixed events or leave stale planned blocks after refresh/re-save.

## Modeling decisions to avoid foot-guns

- Recurring templates are global; only daily recurring item instances are day-bound.
- Fixed events are distinct constraints, not synthetic task rows.
- Generated planned blocks live in the same `timeline` array as completed history; `replacePlanned` only touches blocks whose `status === "planned"`.
- Timeline rendering composes fixed events, recurring events, and generated focus/break blocks; sort key is `startTimeIso`.

## Integration-ready design points

- A future calendar/Obsidian adapter slots in as a new module that reads and produces the existing types — `dayStore` then accepts adapter outputs through new functions rather than coupling them to `App.tsx`.
- Provider payloads are never persisted directly; map to internal model first.

## Definition of done evidence

For architecture-affecting changes, change notes must include:

- updated storage shape documentation if `dayStore` keys or bundle fields change
- migration impact statement (how is existing localStorage handled? bump `schemaVersion`?)
- explicit out-of-scope confirmation for v1 non-goals
