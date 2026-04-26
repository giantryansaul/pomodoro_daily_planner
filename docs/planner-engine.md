# Planner Engine Specification (v1)

## Objective

Generate a deterministic daily timeline that places focus and break blocks around fixed events while preserving priority order and making overflow explicit.

## Inputs

- Ordered task list with optional `estimated_pomodoros`.
- Fixed events with start/end times.
- Planning window start/end for the day (interpreted in selected local day key).
- Pomodoro defaults: `focusMinutes=25`, `breakMinutes=5`.

## Outputs

- Ordered `schedule_blocks` list with `focus`, `break`, and `fixed_event` blocks.
- `unscheduled_tasks` payload with reasons when all tasks cannot be fitted.
- Summary totals (scheduled focus minutes, break minutes, unscheduled count).

## Deterministic algorithm

1. Normalize and validate inputs.
2. Build occupied timeline from fixed events (sorted by start time).
3. Compute free windows between planning start/end and fixed events.
4. Expand each task into required focus sessions:
   - If `estimated_pomodoros` exists, use that count.
   - If missing, default to one focus session.
5. Fill free windows in strict priority order:
   - Place a focus block if full duration fits.
   - Place a break block after each focus block unless:
     - next block is fixed event with no gap, or
     - focus block is the final scheduled block of the day.
6. Continue until sessions are exhausted or no valid window remains.
7. Emit overflow entries for remaining sessions/tasks.

No randomness is allowed in allocation. Equal-priority ties use stable task order from input.

Normalization requirements:

- Convert all event/window inputs to canonical timeline instants after local-day validation.
- Reject ambiguous or invalid local times before scheduling.
- Reject inputs whose normalized instants fall outside the selected day key.

## Scheduling rules

- Focus blocks cannot overlap fixed events.
- Break blocks cannot overlap fixed events.
- No focus block splitting in v1 (a focus block must fully fit a window).
- Minimum schedulable gap is full focus duration.
- Break block may be omitted when it does not fit before a fixed event.

## Edge-case handling

### Invalid event ranges

- Reject events where `start >= end`.
- Reject events outside the selected day.

### Event overlaps

- Prevent creation of overlapping fixed events.
- If overlap exists in legacy/corrupt data, planner returns validation error.

### Insufficient time

- Generate partial plan for what fits.
- Return unscheduled sessions with reason `insufficient_free_time`.
- UI must show a clear warning with unscheduled counts.

### Too-small free windows

- Ignore windows smaller than focus duration.
- Optionally expose this in diagnostics for user understanding.

### Day boundary exhaustion

- Do not carry remaining sessions to next day automatically in v1.
- Keep unscheduled output so user can manually move work.

## Timer coupling rules

- Planner output is immutable once execution starts unless user regenerates plan.
- Regeneration replaces only future `planned` blocks and must preserve completed history.
- The currently active/running block is never deleted during regeneration in v1.
- If regenerated timeline conflicts with current active block timing, return explicit conflict error and require user action (skip/complete/pause and retry).
- Timer reads active block from `timer_sessions` and timeline order from `schedule_blocks`.

## Pseudocode

```text
validate(inputs)
windows = computeFreeWindows(dayStart, dayEnd, fixedEvents)
sessions = expandTasksToSessions(tasks)
blocks = fixedEventsAsBlocks(fixedEvents)

for session in sessions (priority order):
  window = firstWindowThatFits(windows, focusMinutes)
  if no window:
    markUnscheduled(session, insufficient_free_time)
    continue
  focus = placeFocus(window, session, focusMinutes)
  add(blocks, focus)
  if breakCanFitAfterFocus(window, breakMinutes, nextFixedEvent):
    add(blocks, placeBreak(window, breakMinutes))
  updateWindows(windows, usedRange)

return ordered(blocks), unscheduled
```

