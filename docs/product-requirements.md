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

## Required user flow (strict)

The UI enforces this sequence for plan creation:

1. **Daily setup**
   - Select or create today.
   - Preload recurring tasks for the day in unchecked state.
2. **Prioritize work (10-minute window)**
   - Add/edit/reorder tasks.
   - Mark top priorities.
   - Show a planning countdown timer defaulted to 10 minutes.
3. **Record fixed events**
   - Add meetings/events with start and end times.
   - Validate start < end and same-day bounds.
4. **Generate Pomodoro plan**
   - Convert prioritized tasks into focus/break blocks around fixed events.
   - Use default 25-minute focus, 5-minute break.
5. **Execute timeline**
   - Show timeline on left (start/end + label).
   - Show active timer panel on right (current block, remaining time, next block).

## Functional requirements

### Daily tasks

- User can create, edit, delete, reorder, and prioritize daily tasks.
- Task fields: title, estimated pomodoros (optional), notes (optional), priority rank.
- Tasks are tied to a specific day.

### Recurring checklist

- User can manage recurring templates (for example: inbox zero, reading, exercise, lunch).
- Templates appear automatically on each new day.
- User can check/uncheck or strike through recurring items for that day only.

### Fixed events

- User can add, edit, and remove fixed events for the selected day.
- Events are treated as non-negotiable schedule constraints.

### Plan generation

- Generated blocks include focus and break types with start/end times.
- The generator respects fixed events and day boundaries.
- If work cannot fit, system returns explicit overflow/unscheduled information.

### Timer execution

- Timer can start, pause, resume, skip to next block, and mark block complete.
- Active timer state survives refresh/restart through backend persistence.

## Non-functional requirements

- Local-first operation with no required network access.
- Durable persistence in local SQLite file.
- Deterministic scheduling output for identical inputs.
- Fast startup suitable for daily morning use.
- Accessible UI controls and clear text contrast.

## Non-goals (v1)

- Calendar API sync/import.
- Obsidian note ingestion.
- Shared workspaces or multi-user accounts.
- Cloud backup and remote sync.
- Mobile app support.

## Acceptance criteria (v1)

- A first-time user can complete the strict flow and run a generated timeline without docs.
- Data remains available after app restart.
- Overflow scenarios are visible and understandable.
- Active timer accurately reflects current block and elapsed/remaining time.

