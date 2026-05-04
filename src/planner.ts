import type { FixedEvent, PlannerResult, ScheduleBlock, Task, UnscheduledTask } from "./types";

const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;
/** One full pomodoro cycle (25 + 5 minutes); exported for recurring-task window math in dayStore. */
export const FOCUS_SESSION_MINUTES = FOCUS_MINUTES + BREAK_MINUTES;

interface Session {
  taskId: string;
  title: string;
}

interface Window {
  start: Date;
  end: Date;
}

interface PlannerWindow {
  dayStartTimeHhmm?: string;
  dayEndTimeHhmm?: string;
}

function addMinutes(start: Date, minutes: number): Date {
  return new Date(start.getTime() + minutes * 60_000);
}

function timeValue(iso: string): number {
  return new Date(iso).getTime();
}

function makeIsoAtDate(dateIso: string, timeHHMM: string): string {
  return `${dateIso}T${timeHHMM}:00`;
}

function buildWindows(dateIso: string, events: FixedEvent[], window: PlannerWindow): Window[] {
  const dayStart = new Date(makeIsoAtDate(dateIso, window.dayStartTimeHhmm ?? "07:00"));
  const dayEnd = new Date(makeIsoAtDate(dateIso, window.dayEndTimeHhmm ?? "22:00"));
  const sortedEvents = [...events].sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso));
  const windows: Window[] = [];
  let cursor = dayStart;

  for (const event of sortedEvents) {
    const eventStart = new Date(event.startTimeIso);
    const eventEnd = new Date(event.endTimeIso);
    if (eventStart > cursor) {
      windows.push({ start: cursor, end: eventStart });
    }
    if (eventEnd > cursor) {
      cursor = eventEnd;
    }
  }
  if (cursor < dayEnd) {
    windows.push({ start: cursor, end: dayEnd });
  }
  return windows;
}

function expandSessions(tasks: Task[]): Session[] {
  const ordered = [...tasks].sort((a, b) => a.priorityRank - b.priorityRank);
  const sessions: Session[] = [];
  for (const task of ordered) {
    const count = Math.max(1, task.estimatedPomodoros ?? 1);
    for (let i = 0; i < count; i += 1) {
      sessions.push({ taskId: task.id, title: task.title });
    }
  }
  return sessions;
}

function windowFits(window: Window, minutes: number): boolean {
  return window.end.getTime() - window.start.getTime() >= minutes * 60_000;
}

function addFixedEventBlocks(fixedEvents: FixedEvent[], dayPlanId: string, blocks: ScheduleBlock[]): void {
  fixedEvents
    .sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso))
    .forEach((event, idx) => {
      blocks.push({
        id: crypto.randomUUID(),
        dayPlanId,
        sourceTaskId: null,
        sourceDailyRecurringId: null,
        sourceEventId: event.id,
        blockType: "fixed_event",
        label: event.title,
        startTimeIso: event.startTimeIso,
        endTimeIso: event.endTimeIso,
        sequenceIndex: idx,
        status: "planned",
      });
    });
}

function addRecurringCalendarEventBlocks(events: FixedEvent[], dayPlanId: string, blocks: ScheduleBlock[]): void {
  events
    .sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso))
    .forEach((event) => {
      blocks.push({
        id: crypto.randomUUID(),
        dayPlanId,
        sourceTaskId: null,
        sourceDailyRecurringId: event.id,
        sourceEventId: null,
        blockType: "recurring_event",
        label: event.title,
        startTimeIso: event.startTimeIso,
        endTimeIso: event.endTimeIso,
        sequenceIndex: blocks.length + 1,
        status: "planned",
      });
    });
}

/** Full 25+5 pomodoro pairs inside each recurring window; remainder shorter than one session is omitted. */
function addRecurringFocusBreakSessions(recurring: FixedEvent[], dayPlanId: string, blocks: ScheduleBlock[]): void {
  recurring
    .sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso))
    .forEach((item) => {
      const dailyRecurringId = item.id;
      let cursor = new Date(item.startTimeIso);
      const slotEnd = new Date(item.endTimeIso);
      while (cursor.getTime() + FOCUS_SESSION_MINUTES * 60_000 <= slotEnd.getTime()) {
        const focusEnd = addMinutes(cursor, FOCUS_MINUTES);
        const breakEnd = addMinutes(focusEnd, BREAK_MINUTES);
        blocks.push({
          id: crypto.randomUUID(),
          dayPlanId,
          sourceTaskId: null,
          sourceDailyRecurringId: dailyRecurringId,
          sourceEventId: null,
          blockType: "focus",
          label: item.title,
          startTimeIso: cursor.toISOString(),
          endTimeIso: focusEnd.toISOString(),
          sequenceIndex: blocks.length + 1,
          status: "planned",
        });
        blocks.push({
          id: crypto.randomUUID(),
          dayPlanId,
          sourceTaskId: null,
          sourceDailyRecurringId: null,
          sourceEventId: null,
          blockType: "break",
          label: "Break",
          startTimeIso: focusEnd.toISOString(),
          endTimeIso: breakEnd.toISOString(),
          sequenceIndex: blocks.length + 1,
          status: "planned",
        });
        cursor = breakEnd;
      }
    });
}

function scheduleFocusAndBreak(
  session: Session,
  freeWindows: Window[],
  dayPlanId: string,
  blocks: ScheduleBlock[],
  unscheduledTasks: UnscheduledTask[],
): void {
  const availableWindow = freeWindows.find((candidateWindow) => windowFits(candidateWindow, FOCUS_SESSION_MINUTES));
  if (!availableWindow) {
    unscheduledTasks.push({
      taskId: session.taskId,
      title: session.title,
      reason: "insufficient_free_time",
    });
    return;
  }

  const focusStart = new Date(availableWindow.start);
  const focusEnd = addMinutes(focusStart, FOCUS_MINUTES);
  blocks.push({
    id: crypto.randomUUID(),
    dayPlanId,
    sourceTaskId: session.taskId,
    sourceDailyRecurringId: null,
    sourceEventId: null,
    blockType: "focus",
    label: session.title,
    startTimeIso: focusStart.toISOString(),
    endTimeIso: focusEnd.toISOString(),
    sequenceIndex: blocks.length + 1,
    status: "planned",
  });
  const breakStart = new Date(focusEnd);
  const breakEnd = addMinutes(breakStart, BREAK_MINUTES);
  blocks.push({
    id: crypto.randomUUID(),
    dayPlanId,
    sourceTaskId: null,
    sourceDailyRecurringId: null,
    sourceEventId: null,
    blockType: "break",
    label: "Break",
    startTimeIso: breakStart.toISOString(),
    endTimeIso: breakEnd.toISOString(),
    sequenceIndex: blocks.length + 1,
    status: "planned",
  });
  availableWindow.start = breakEnd;
}

function sortAndReindexBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const blocksSortedByStartTime = blocks.sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso));
  blocksSortedByStartTime.forEach((block, index) => {
    block.sequenceIndex = index;
  });
  return blocksSortedByStartTime;
}

export function generatePlan(
  dateIso: string,
  tasks: Task[],
  fixedEvents: FixedEvent[],
  dayPlanId: string,
  recurringTaskWindows: FixedEvent[] = [],
  recurringCalendarEvents: FixedEvent[] = [],
  window: PlannerWindow = {},
): PlannerResult {
  const plannedBlocks: ScheduleBlock[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const busyEvents = [...fixedEvents, ...recurringTaskWindows, ...recurringCalendarEvents];
  const freeWindows = buildWindows(dateIso, busyEvents, window);
  const taskSessions = expandSessions(tasks);

  addFixedEventBlocks(fixedEvents, dayPlanId, plannedBlocks);
  addRecurringCalendarEventBlocks(recurringCalendarEvents, dayPlanId, plannedBlocks);
  addRecurringFocusBreakSessions(recurringTaskWindows, dayPlanId, plannedBlocks);

  for (const session of taskSessions) {
    scheduleFocusAndBreak(session, freeWindows, dayPlanId, plannedBlocks, unscheduledTasks);
  }

  const orderedBlocks = sortAndReindexBlocks(plannedBlocks);
  return { blocks: orderedBlocks, unscheduledTasks };
}
