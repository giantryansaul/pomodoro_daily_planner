import type { FixedEvent, PlannerResult, ScheduleBlock, Task, UnscheduledTask } from "./types.js";

const FOCUS_MINUTES = 25;
const BREAK_MINUTES = 5;

interface Session {
  taskId: string;
  title: string;
}

interface Window {
  start: Date;
  end: Date;
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

function buildWindows(dateIso: string, events: FixedEvent[]): Window[] {
  const dayStart = new Date(makeIsoAtDate(dateIso, "07:00"));
  const dayEnd = new Date(makeIsoAtDate(dateIso, "22:00"));
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

function scheduleFocusAndBreak(
  session: Session,
  freeWindows: Window[],
  dayPlanId: string,
  blocks: ScheduleBlock[],
  unscheduledTasks: UnscheduledTask[],
): void {
  const availableWindow = freeWindows.find((candidateWindow) => windowFits(candidateWindow, FOCUS_MINUTES));
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
    sourceEventId: null,
    blockType: "focus",
    label: session.title,
    startTimeIso: focusStart.toISOString(),
    endTimeIso: focusEnd.toISOString(),
    sequenceIndex: blocks.length + 1,
    status: "planned",
  });
  availableWindow.start = focusEnd;

  if (windowFits(availableWindow, BREAK_MINUTES)) {
    const breakStart = new Date(availableWindow.start);
    const breakEnd = addMinutes(breakStart, BREAK_MINUTES);
    blocks.push({
      id: crypto.randomUUID(),
      dayPlanId,
      sourceTaskId: null,
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
}

function sortAndReindexBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  const blocksSortedByStartTime = blocks.sort((a, b) => timeValue(a.startTimeIso) - timeValue(b.startTimeIso));
  blocksSortedByStartTime.forEach((block, index) => {
    block.sequenceIndex = index;
  });
  return blocksSortedByStartTime;
}

export function generatePlan(dateIso: string, tasks: Task[], fixedEvents: FixedEvent[], dayPlanId: string): PlannerResult {
  const plannedBlocks: ScheduleBlock[] = [];
  const unscheduledTasks: UnscheduledTask[] = [];
  const freeWindows = buildWindows(dateIso, fixedEvents);
  const taskSessions = expandSessions(tasks);

  addFixedEventBlocks(fixedEvents, dayPlanId, plannedBlocks);

  for (const session of taskSessions) {
    scheduleFocusAndBreak(session, freeWindows, dayPlanId, plannedBlocks, unscheduledTasks);
  }

  const orderedBlocks = sortAndReindexBlocks(plannedBlocks);
  return { blocks: orderedBlocks, unscheduledTasks };
}
