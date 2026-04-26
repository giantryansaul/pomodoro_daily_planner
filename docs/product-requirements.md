# Product Requirements (v1)

## Product goal

Help a single user start each day with a concrete, time-boxed execution plan by combining prioritization, constraints, and Pomodoro scheduling in one guided flow.

## Primary user outcome

By the end of the morning planning session, the user has:

- A ranked list of high-priority tasks.
- A checked/unchecked recurring checklist for the day.
- Their known fixed events entered.
- A generated timeline with task and break blocks.
- A currently active timer with clear next action.

## Required user flow

The app uses two primary modes for a day: **editing** and **timeline**.

1. **Editing mode**
   - First load for a day without a generated timeline opens the editing workspace.
   - The user sees the planning timer on the right, paused by default.
   - The user can start, pause, and reset the 10-minute planning timer.
   - Three edit panels are visible at the same time:
     - add/edit/remove tasks
     - eliminate or restore recurring tasks for the day
     - add/edit/remove manual calendar events
   - The user chooses **Save Day** to persist edits and generate the timeline.
2. **Timeline mode**
   - After Save Day, the edit panels go away and the user sees the generated timeline.
   - The timeline is rendered chronologically and includes fixed events, focus blocks, and breaks.
   - The active timer panel remains available for execution controls.
3. **Edit Timeline for Day**
   - From timeline mode, the user can reopen the editing workspace.
   - Saving again recalculates the day from the latest tasks, recurring selections, and events.
   - Regeneration must not duplicate fixed events or leave stale planned blocks in the timeline.

## Functional requirements

### Daily tasks

- User can create, edit, delete, reorder, and prioritize daily tasks.
- Every visible task row has an Edit control for in-place title and estimated Pomodoro changes.
- Task fields: title, estimated pomodoros (optional), notes (optional), priority rank.
- Tasks are tied to a specific day.

### Recurring checklist

- User can manage recurring templates (for example: inbox zero, reading, exercise, lunch).
- Templates appear automatically on each new day.
- User can check/uncheck or strike through recurring items for that day only.

### Fixed events

- User can add, edit, and remove fixed events for the selected day.
- Events are treated as non-negotiable schedule constraints.
- Duplicate or invalid event entries are ignored/rejected before timeline generation.

### Plan generation

- Generated blocks include focus and break types with start/end times.
- The generator respects fixed events and day boundaries.
- If work cannot fit, system returns explicit overflow/unscheduled information.
- Repeated generation for the same day replaces prior planned blocks instead of appending duplicates.
- Timeline display order is chronological by timestamp, not insertion order.

### Timer execution

- Timer can start, pause, resume, skip to next block, and mark block complete.
- Active timer state survives refresh/restart through backend persistence.

## Non-functional requirements

- Develop Local-first operation with no required network access (other than local network).
- Durable persistence in local SQLite file.
- Deterministic scheduling output for identical inputs.
- Fast startup suitable for daily morning use.
- Accessible UI controls and clear text contrast.

## Non-goals (v1)

- Calendar API sync/import.
- Obsidian note ingestion.
- Evaluate with an AI agent to make a better plan or create new tasks.
- Shared workspaces or multi-user accounts.
- Cloud backup and remote sync.
- Mobile app support.
- Different times for pomodoros.
- Other user settings.

## Acceptance criteria (v1)

- A first-time user can use the editing workspace, save the day, and run a generated timeline without docs.
- Data remains available after app restart. State is persisted.
- Overflow scenarios are visible and understandable.
- Active timer accurately reflects current block and elapsed/remaining time.
- Refreshing and saving the day again does not duplicate fixed events in the generated timeline.
- Events and generated blocks display in chronological order, including early events before later events.

