import { Check, Coffee, Minus, Pause, Pencil, Play, Plus, RotateCcw, Save, SkipForward, Trash2, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { dayStore } from "./dayStore";
import type { DayBoundaryDefaults, ScheduleBlock as Block, TaskStatus, TimerSession } from "./types";

type AppMode = "editing" | "timeline";
type TaskInput = {
  clientId: string;
  serverId?: string;
  title: string;
  estimatedPomodoros?: number;
  status?: TaskStatus;
};
type RecurringItemTimed = {
  id: string;
  recurringTemplateId: string;
  titleSnapshot: string;
  startTimeSnapshotHhmm: string | null;
  endTimeSnapshotHhmm: string | null;
  isCompleted: boolean;
  editScope: "today" | "template";
};
type EventInput = { clientId: string; title: string; startTime: string; endTime: string };
type RecurringDraft = { title: string; startTime: string; endTime: string };
type CalendarItem = {
  id: string;
  block: Block;
  breakBlock?: Block;
  kind: "focus-session" | "break" | "fixed_event";
  laneIndex: number;
  laneCount: number;
};
type TimelineEditDraft = {
  label: string;
  startTime: string;
  endTime: string;
};
type TimerCardVariant = "planning" | Block["blockType"] | "empty" | "recurring_focus";
type TimerCardProps = {
  title: string;
  variant: TimerCardVariant;
  timeText: string;
  labelText?: string;
  stateText?: string;
  helperText?: string;
  progressPercent?: number;
  progressDanger?: boolean;
  actions: ReactNode;
};

const today = new Date().toISOString().slice(0, 10);
const PLANNING_TIMER_SECONDS = 10 * 60;
const DEFAULT_DAY_START_TIME = "07:00";
const DEFAULT_DAY_END_TIME = "19:00";
const DEFAULT_RECURRING_START_TIME = "07:00";
const DEFAULT_RECURRING_END_TIME = "07:30";
const HOUR_HEIGHT_PX = 96;
/** Vertical breathing room between stacked calendar blocks (px), converted using grid height. */
const CALENDAR_VERTICAL_GAP_PX = 5;
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
});
const POMODORO_OPTIONS = [1, 2, 3, 4, 5, 6];

function newClientId(): string {
  return crypto.randomUUID();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatSelectTime(time: string): string {
  return new Date(`${today}T${time}:00`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function parseHhmmToMinutes(time: string): number {
  const [hoursText, minutesText] = time.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;
  return hours * 60 + minutes;
}

function formatMinutesToHhmm(totalMinutes: number): string {
  const wrappedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrappedMinutes / 60);
  const minutes = wrappedMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function durationMinutesFromRange(startTime: string, endTime: string): number {
  const startMinutes = parseHhmmToMinutes(startTime);
  const endMinutes = parseHhmmToMinutes(endTime);
  return endMinutes > startMinutes ? endMinutes - startMinutes : endMinutes + 1440 - startMinutes;
}

function formatDurationHoursLabel(durationMinutes: number): string {
  if (durationMinutes <= 0) return "invalid range";
  const durationHours = durationMinutes / 60;
  const durationText = Number.isInteger(durationHours) ? `${durationHours}` : `${durationHours.toFixed(1)}`;
  const hourWord = durationHours === 1 ? "hour" : "hours";
  return `${durationText} ${hourWord}`;
}

function formatEndOptionLabel(startTime: string, optionTime: string): string {
  const durationMinutes = durationMinutesFromRange(startTime, optionTime);
  return `${formatSelectTime(optionTime)} (+${formatDurationHoursLabel(durationMinutes)})`;
}

function formatDateParts(dateIso: string): { weekday: string; dateText: string } {
  const date = new Date(`${dateIso}T12:00:00`);
  return {
    weekday: date.toLocaleDateString([], { weekday: "long" }),
    dateText: date.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" }),
  };
}

function formatTimer(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function sortByStartTime<T extends { startTimeIso: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.startTimeIso).getTime() - new Date(b.startTimeIso).getTime());
}

function durationInSeconds(block?: Block): number {
  if (!block) return 0;
  return Math.max(0, Math.floor((new Date(block.endTimeIso).getTime() - new Date(block.startTimeIso).getTime()) / 1000));
}

function minutesFromDayStart(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

function formatHourLabel(hour: number): string {
  return new Date(`${today}T${String(hour).padStart(2, "0")}:00:00`).toLocaleTimeString([], { hour: "numeric" });
}

function timeInputFromIso(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function isoAtTodayTime(time: string): string {
  return new Date(`${today}T${time}:00`).toISOString();
}

function addMinutesIso(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function blockClass(block: Block): string {
  let blockTypeClass: string;
  if (block.blockType === "fixed_event") {
    blockTypeClass = "calendar-block-event";
  } else if (block.blockType === "recurring_event") {
    blockTypeClass = "calendar-block-recurring";
  } else if (block.blockType === "focus" && block.sourceDailyRecurringId) {
    blockTypeClass = "calendar-block-recurring-focus";
  } else {
    blockTypeClass = `calendar-block-${block.blockType}`;
  }
  return `calendar-block ${blockTypeClass}${block.status === "completed" ? " completed" : ""}`;
}

function blockStartMs(block: Block): number {
  return new Date(block.startTimeIso).getTime();
}

function blockEndMs(block: Block): number {
  return new Date(block.endTimeIso).getTime();
}

function blocksAreAdjacent(left: Block, right: Block): boolean {
  return blockEndMs(left) === blockStartMs(right);
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function assignMeetingLanes(events: Block[]): Map<string, { laneIndex: number; laneCount: number }> {
  const laneMap = new Map<string, { laneIndex: number; laneCount: number }>();
  const sortedEvents = sortByStartTime(events);
  let group: Block[] = [];
  let groupEnd = 0;

  function flushGroup(): void {
    if (group.length === 0) return;
    const laneEnds: number[] = [];
    const assignments = new Map<string, number>();
    for (const eventBlock of group) {
      const reusableLane = laneEnds.findIndex((laneEnd) => laneEnd <= blockStartMs(eventBlock));
      const laneIndex = reusableLane === -1 ? laneEnds.length : reusableLane;
      laneEnds[laneIndex] = blockEndMs(eventBlock);
      assignments.set(eventBlock.id, laneIndex);
    }
    const laneCount = Math.max(1, laneEnds.length);
    for (const eventBlock of group) {
      laneMap.set(eventBlock.id, { laneIndex: assignments.get(eventBlock.id) ?? 0, laneCount });
    }
    group = [];
    groupEnd = 0;
  }

  for (const eventBlock of sortedEvents) {
    if (group.length > 0 && blockStartMs(eventBlock) >= groupEnd) {
      flushGroup();
    }
    group.push(eventBlock);
    groupEnd = Math.max(groupEnd, blockEndMs(eventBlock));
  }
  flushGroup();

  return laneMap;
}

function buildCalendarItems(blocks: Block[]): CalendarItem[] {
  const consumedBreakIds = new Set<string>();
  const eventLaneMap = assignMeetingLanes(blocks.filter((block) => block.blockType === "fixed_event" || block.blockType === "recurring_event"));
  const calendarItems: CalendarItem[] = [];

  blocks.forEach((block, index) => {
    if (consumedBreakIds.has(block.id)) return;
    if (block.blockType === "focus") {
      const nextBlock = blocks[index + 1];
      const breakBlock =
        nextBlock?.blockType === "break" && blocksAreAdjacent(block, nextBlock) ? nextBlock : undefined;
      if (breakBlock) {
        consumedBreakIds.add(breakBlock.id);
      }
      calendarItems.push({ id: block.id, block, breakBlock, kind: "focus-session", laneIndex: 0, laneCount: 1 });
      return;
    }
    if (block.blockType === "fixed_event" || block.blockType === "recurring_event") {
      const lane = eventLaneMap.get(block.id) ?? { laneIndex: 0, laneCount: 1 };
      calendarItems.push({ id: block.id, block, kind: "fixed_event", ...lane });
      return;
    }
  });

  return calendarItems;
}

function calendarItemEndMs(item: CalendarItem): number {
  return item.breakBlock ? blockEndMs(item.breakBlock) : blockEndMs(item.block);
}

function countTimelineConflicts(items: CalendarItem[]): number {
  let conflictCount = 0;
  const focusSessions = items.filter((item) => item.kind === "focus-session");
  const meetings = items.filter((item) => item.kind === "fixed_event");

  for (const item of items) {
    if (blockStartMs(item.block) >= calendarItemEndMs(item)) {
      conflictCount += 1;
    }
  }

  focusSessions.forEach((session, index) => {
    const sessionStart = blockStartMs(session.block);
    const sessionEnd = calendarItemEndMs(session);
    for (const meeting of meetings) {
      if (rangesOverlap(sessionStart, sessionEnd, blockStartMs(meeting.block), blockEndMs(meeting.block))) {
        conflictCount += 1;
      }
    }
    for (const otherSession of focusSessions.slice(index + 1)) {
      if (rangesOverlap(sessionStart, sessionEnd, blockStartMs(otherSession.block), calendarItemEndMs(otherSession))) {
        conflictCount += 1;
      }
    }
  });

  return conflictCount;
}

function TimerCard({
  title,
  variant,
  timeText,
  labelText,
  stateText,
  helperText,
  progressPercent,
  progressDanger = false,
  actions,
}: TimerCardProps) {
  const hasProgress = typeof progressPercent === "number";

  return (
    <div className={`panel timer-card timer-card-${variant}`}>
      <h3>{title}</h3>
      {labelText && <p className="timer-card-label"><strong>{labelText}</strong></p>}
      <p className="timer-card-time">{timeText}</p>
      {hasProgress && (
        <div className="progress-track" aria-label="Timer progress">
          <div
            className={`progress-fill${progressDanger ? " danger" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}
      {stateText && <p className="muted">{stateText}</p>}
      <div className="row">{actions}</div>
      {helperText && <p className="muted">{helperText}</p>}
    </div>
  );
}

function normalizeRecurring(items: Array<{
  id: string;
  recurringTemplateId: string;
  titleSnapshot: string;
  startTimeSnapshotHhmm: string | null;
  endTimeSnapshotHhmm: string | null;
  isCompleted: boolean;
}>): RecurringItemTimed[] {
  return items.map((item) => ({
    ...item,
    editScope: "today" as const,
  }));
}

function App() {
  const [mode, setMode] = useState<AppMode>("editing");
  const [planningSecondsLeft, setPlanningSecondsLeft] = useState(PLANNING_TIMER_SECONDS);
  const [planningTimerRunning, setPlanningTimerRunning] = useState(false);
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [recurring, setRecurring] = useState<RecurringItemTimed[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [eventDraft, setEventDraft] = useState<EventInput>({
    clientId: newClientId(),
    title: "",
    startTime: "09:00",
    endTime: "09:30",
  });
  const [recurringDraft, setRecurringDraft] = useState<RecurringDraft>({
    title: "",
    startTime: DEFAULT_RECURRING_START_TIME,
    endTime: DEFAULT_RECURRING_END_TIME,
  });
  const [timeline, setTimeline] = useState<Block[]>([]);
  const [timer, setTimer] = useState<TimerSession | null>(null);
  const [dayStartTime, setDayStartTime] = useState(DEFAULT_DAY_START_TIME);
  const [dayEndTime, setDayEndTime] = useState(DEFAULT_DAY_END_TIME);
  const [editingTimelineBlockId, setEditingTimelineBlockId] = useState<string | null>(null);
  const [timelineEditDraft, setTimelineEditDraft] = useState<TimelineEditDraft>({ label: "", startTime: "", endTime: "" });
  const [unscheduledCount, setUnscheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const orderedTimeline = useMemo(() => sortByStartTime(timeline), [timeline]);
  const firstRunnableBlock = useMemo(
    () => orderedTimeline.find((block) => block.blockType !== "fixed_event" && block.status !== "completed"),
    [orderedTimeline],
  );
  const activeBlock = useMemo(
    () => orderedTimeline.find((block) => block.id === timer?.activeBlockId),
    [orderedTimeline, timer?.activeBlockId],
  );
  const displayedBlock = activeBlock ?? firstRunnableBlock;
  const pomodoroTimerVariant = useMemo((): TimerCardVariant => {
    if (!displayedBlock) return "empty";
    if (displayedBlock.blockType === "focus" && displayedBlock.sourceDailyRecurringId) return "recurring_focus";
    return displayedBlock.blockType;
  }, [displayedBlock]);
  const displayedBlockDurationSeconds = durationInSeconds(displayedBlock);
  const displayedElapsedSeconds = activeBlock ? (timer?.elapsedSeconds ?? 0) : 0;
  const remainingSeconds = Math.max(displayedBlockDurationSeconds - displayedElapsedSeconds, 0);
  const planningProgressPercent = Math.min(((PLANNING_TIMER_SECONDS - planningSecondsLeft) / PLANNING_TIMER_SECONDS) * 100, 100);
  const planningState =
    planningSecondsLeft === 0 ? "completed"
      : planningTimerRunning ? "running"
        : planningSecondsLeft === PLANNING_TIMER_SECONDS ? "idle"
          : "paused";
  const timerProgressPercent =
    displayedBlockDurationSeconds > 0 ? Math.min((displayedElapsedSeconds / displayedBlockDurationSeconds) * 100, 100) : 0;
  const timerAlmostDone = displayedBlockDurationSeconds > 0 && remainingSeconds <= displayedBlockDurationSeconds * 0.2;
  const dateParts = useMemo(() => formatDateParts(today), []);
  const dayEndOptions = useMemo(
    () => TIME_OPTIONS.filter((time) => parseHhmmToMinutes(time) > parseHhmmToMinutes(dayStartTime)),
    [dayStartTime],
  );
  const recurringEndOptions = useMemo(
    () => TIME_OPTIONS.filter((time) => parseHhmmToMinutes(time) > parseHhmmToMinutes(recurringDraft.startTime)),
    [recurringDraft.startTime],
  );

  useEffect(() => {
    if (parseHhmmToMinutes(dayEndTime) > parseHhmmToMinutes(dayStartTime)) return;
    if (dayEndOptions.length > 0) {
      setDayEndTime(dayEndOptions[0]);
    }
  }, [dayEndOptions, dayEndTime, dayStartTime]);

  useEffect(() => {
    if (parseHhmmToMinutes(recurringDraft.endTime) > parseHhmmToMinutes(recurringDraft.startTime)) return;
    if (recurringEndOptions.length > 0) {
      setRecurringDraft((current) => ({ ...current, endTime: recurringEndOptions[0] }));
    }
  }, [recurringDraft.endTime, recurringDraft.startTime, recurringEndOptions]);

  const calendarBounds = useMemo(() => {
    const blockStarts = orderedTimeline.map((block) => minutesFromDayStart(block.startTimeIso));
    const blockEnds = orderedTimeline.map((block) => minutesFromDayStart(block.endTimeIso));
    const selectedStartMinutes = parseHhmmToMinutes(dayStartTime);
    const selectedEndMinutes = parseHhmmToMinutes(dayEndTime);
    const startHour = Math.min(Math.floor(selectedStartMinutes / 60), Math.floor(Math.min(...blockStarts, selectedStartMinutes) / 60));
    const endHour = Math.max(Math.ceil(selectedEndMinutes / 60), Math.ceil(Math.max(...blockEnds, selectedEndMinutes) / 60));
    const clampedEndHour = Math.max(startHour + 1, endHour);
    return { startHour, endHour: clampedEndHour, totalMinutes: (clampedEndHour - startHour) * 60 };
  }, [dayEndTime, dayStartTime, orderedTimeline]);
  const calendarHours = useMemo(
    () => Array.from({ length: calendarBounds.endHour - calendarBounds.startHour + 1 }, (_, index) => calendarBounds.startHour + index),
    [calendarBounds.endHour, calendarBounds.startHour],
  );
  const calendarItems = useMemo(() => buildCalendarItems(orderedTimeline), [orderedTimeline]);
  const timelineConflictCount = useMemo(() => countTimelineConflicts(calendarItems), [calendarItems]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPlanningSecondsLeft((current) => {
        if (!planningTimerRunning) return current;
        return current > 0 ? current - 1 : 0;
      });
      setTimer((current) => {
        if (!current || current.state !== "running" || !current.activeBlockId) return current;
        return { ...current, elapsedSeconds: current.elapsedSeconds + 1 };
      });
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [planningTimerRunning]);

  const loadDay = useCallback(async (): Promise<void> => {
    const [tasksData, recurringData, eventsData, timelineData, timerData, defaultsData] = await Promise.all([
      dayStore.getTasks(today),
      dayStore.getRecurring(today),
      dayStore.getEvents(today),
      dayStore.getTimeline(today),
      dayStore.getTimerSession(today),
      dayStore.getDayBoundaryDefaults(),
    ]);

    setTasks(
      tasksData.tasks.map((task) => ({
        clientId: newClientId(),
        serverId: task.id,
        title: task.title,
        estimatedPomodoros: task.estimatedPomodoros ?? undefined,
        status: task.status,
      })),
    );
    setRecurring(normalizeRecurring(recurringData.recurring));
    setEvents(
      eventsData.events.map((event) => ({
        clientId: newClientId(),
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
      })),
    );
    const loadedTimeline = sortByStartTime(timelineData.blocks);
    setTimeline(loadedTimeline);
    setTimer(timerData.session);
    setDayStartTime(defaultsData.dayStartTimeHhmm ?? DEFAULT_DAY_START_TIME);
    setDayEndTime(defaultsData.dayEndTimeHhmm ?? DEFAULT_DAY_END_TIME);
    setMode(loadedTimeline.length > 0 ? "timeline" : "editing");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const refreshTasksFromStore = useCallback(async (): Promise<void> => {
    const tasksData = await dayStore.getTasks(today);
    setTasks((prev) => {
      const clientIdByServerId = new Map(
        prev.filter((task) => task.serverId).map((task) => [task.serverId as string, task.clientId]),
      );
      return tasksData.tasks.map((task) => ({
        clientId: clientIdByServerId.get(task.id) ?? newClientId(),
        serverId: task.id,
        title: task.title,
        estimatedPomodoros: task.estimatedPomodoros ?? undefined,
        status: task.status,
      }));
    });
  }, []);

  const calendarNowLineStyle = useMemo((): CSSProperties | null => {
    const now = new Date(nowTick);
    const minutesFromMidnight = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const rangeStartMin = calendarBounds.startHour * 60;
    const rangeEndMin = calendarBounds.endHour * 60;
    if (minutesFromMidnight < rangeStartMin || minutesFromMidnight > rangeEndMin) return null;
    const offsetMin = minutesFromMidnight - rangeStartMin;
    const topPct = (offsetMin / calendarBounds.totalMinutes) * 100;
    return { top: `${topPct}%` };
  }, [calendarBounds.endHour, calendarBounds.startHour, calendarBounds.totalMinutes, nowTick]);

  async function persistDayBoundaryDefaults(next: DayBoundaryDefaults): Promise<void> {
    await dayStore.setDayBoundaryDefaults(next);
  }

  function handleDayStartTimeChange(nextStartTime: string): void {
    const nextEndTime = parseHhmmToMinutes(dayEndTime) > parseHhmmToMinutes(nextStartTime)
      ? dayEndTime
      : TIME_OPTIONS.find((time) => parseHhmmToMinutes(time) > parseHhmmToMinutes(nextStartTime)) ?? DEFAULT_DAY_END_TIME;
    setDayStartTime(nextStartTime);
    setDayEndTime(nextEndTime);
    void persistDayBoundaryDefaults({ dayStartTimeHhmm: nextStartTime, dayEndTimeHhmm: nextEndTime });
  }

  function handleDayEndTimeChange(nextEndTime: string): void {
    setDayEndTime(nextEndTime);
    void persistDayBoundaryDefaults({ dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: nextEndTime });
  }

  async function saveDay(): Promise<void> {
    await dayStore.replaceTasks(today, tasks.map(({ title, estimatedPomodoros }) => ({ title, estimatedPomodoros })));

    await dayStore.updateRecurring(
      today,
      recurring.map((item) => ({
        id: item.id,
        isCompleted: item.isCompleted,
        titleSnapshot: item.titleSnapshot,
        startTimeHhmm: item.startTimeSnapshotHhmm ?? undefined,
        endTimeHhmm: item.endTimeSnapshotHhmm ?? undefined,
        editScope: item.editScope,
      })),
    );

    await dayStore.replaceEvents(
      today,
      events.map((event) => ({
        title: event.title,
        startTimeIso: `${today}T${event.startTime}:00`,
        endTimeIso: `${today}T${event.endTime}:00`,
      })),
    );

    const planData = await dayStore.generatePlan(today, { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime });
    setUnscheduledCount(planData.unscheduledTasks.length);
    const [timelineData, tasksAfterSave] = await Promise.all([dayStore.getTimeline(today), dayStore.getTasks(today)]);
    const regeneratedTimeline = sortByStartTime(timelineData.blocks);
    setTimeline(regeneratedTimeline);
    setTasks(
      tasksAfterSave.tasks.map((task) => ({
        clientId: newClientId(),
        serverId: task.id,
        title: task.title,
        estimatedPomodoros: task.estimatedPomodoros ?? undefined,
        status: task.status,
      })),
    );
    setMode("timeline");
  }

  async function runDayRebuild(endpoint: "generate-plan" | "reset-and-generate"): Promise<void> {
    const plannerWindow = { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime };
    const planData =
      endpoint === "reset-and-generate"
        ? await dayStore.resetAndGenerate(today, plannerWindow)
        : await dayStore.generatePlan(today, plannerWindow);
    setUnscheduledCount(planData.unscheduledTasks.length);
    const [timelineData, recurringData, timerData] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getRecurring(today),
      dayStore.getTimerSession(today),
    ]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setRecurring(normalizeRecurring(recurringData.recurring));
    setTimer(timerData.session);
    await refreshTasksFromStore();
    setEditingTimelineBlockId(null);
    setMode("timeline");
  }

  async function regenerateTimeline(): Promise<void> {
    await runDayRebuild("reset-and-generate");
  }

  async function resetDay(): Promise<void> {
    const confirmed = window.confirm("Reset this day and regenerate the timeline from scratch?");
    if (!confirmed) return;
    await runDayRebuild("reset-and-generate");
  }

  async function clearDay(): Promise<void> {
    const confirmed = window.confirm("Clear today's tasks and events, and reset recurring tasks to defaults?");
    if (!confirmed) return;
    const clearData = await dayStore.clearDay(today);
    setTasks([]);
    setEvents([]);
    setTimeline([]);
    setRecurring(normalizeRecurring(clearData.recurring));
    setTimer(clearData.session);
    setUnscheduledCount(0);
    setEditingTimelineBlockId(null);
    setMode("editing");
  }

  async function persistTimer(next: TimerSession): Promise<void> {
    await dayStore.upsertTimerSession(today, next);
  }

  async function startTimer(): Promise<void> {
    if (!timer) return;
    if (timer.state === "paused" && timer.activeBlockId) {
      const next = { ...timer, state: "running" as const };
      setTimer(next);
      await persistTimer(next);
      return;
    }
    if (timer.state === "running") return;

    const fromCalendar = timer.activeBlockId
      ? orderedTimeline.find(
          (block) =>
            block.id === timer.activeBlockId
            && block.blockType !== "fixed_event"
            && block.status !== "completed",
        )
      : undefined;
    const targetBlock =
      fromCalendar
      ?? orderedTimeline.find((block) => block.blockType !== "fixed_event" && block.status !== "completed");
    if (!targetBlock) return;

    const keepElapsed =
      timer.state === "idle" && timer.activeBlockId === targetBlock.id && timer.elapsedSeconds > 0;
    const next = {
      ...timer,
      activeBlockId: targetBlock.id,
      state: "running" as const,
      elapsedSeconds: keepElapsed ? timer.elapsedSeconds : 0,
    };
    setTimer(next);
    await persistTimer(next);
  }

  async function playBlock(blockId: string): Promise<void> {
    if (!timer) return;
    const next = { ...timer, activeBlockId: blockId, state: "running" as const, elapsedSeconds: 0 };
    setTimer(next);
    await persistTimer(next);
  }

  async function togglePause(): Promise<void> {
    if (!timer || timer.state !== "running") return;
    const next: TimerSession = { ...timer, state: "paused" };
    setTimer(next);
    await persistTimer(next);
  }

  async function skipBlock(): Promise<void> {
    if (!timer || !timer.activeBlockId) return;
    const currentIndex = orderedTimeline.findIndex((block) => block.id === timer.activeBlockId);
    const nextBlock = orderedTimeline
      .slice(currentIndex + 1)
      .find((block) => block.blockType !== "fixed_event" && block.status !== "completed");
    const next = {
      ...timer,
      activeBlockId: nextBlock?.id ?? null,
      elapsedSeconds: 0,
      state: nextBlock ? ("running" as const) : ("completed" as const),
    };
    setTimer(next);
    await persistTimer(next);
  }

  async function completeBlock(blockId: string): Promise<void> {
    const targetBlock = orderedTimeline.find((block) => block.id === blockId);
    if (!targetBlock || targetBlock.status === "completed") return;
    await dayStore.markBlockCompleted(today, blockId);
    setTimeline((current) => current.map((block) => (block.id === blockId ? { ...block, status: "completed" } : block)));
    await refreshTasksFromStore();
    if (!timer || timer.activeBlockId !== blockId) return;
    const currentIndex = orderedTimeline.findIndex((block) => block.id === blockId);
    const nextBlock = orderedTimeline
      .slice(currentIndex + 1)
      .find((block) => block.blockType !== "fixed_event" && block.status !== "completed");
    const next: TimerSession = {
      ...timer,
      activeBlockId: nextBlock?.id ?? null,
      elapsedSeconds: 0,
      state: nextBlock ? "running" : "completed",
    };
    setTimer(next);
    await persistTimer(next);
  }

  function beginTimelineEdit(block: Block): void {
    setEditingTimelineBlockId(block.id);
    setTimelineEditDraft({
      label: block.label,
      startTime: timeInputFromIso(block.startTimeIso),
      endTime: timeInputFromIso(block.endTimeIso),
    });
  }

  async function saveTimelineEdit(block: Block): Promise<void> {
    const nextLabel = timelineEditDraft.label.trim();
    if (!nextLabel) return;
    if (block.blockType === "focus" && (block.sourceTaskId || block.sourceDailyRecurringId)) {
      const startTimeIso = isoAtTodayTime(timelineEditDraft.startTime);
      const focusEndTimeIso = addMinutesIso(startTimeIso, 25);
      const breakEndTimeIso = addMinutesIso(startTimeIso, 30);
      await dayStore.updateFocusSession(today, block.id, {
        label: nextLabel,
        startTimeIso,
        focusEndTimeIso,
        breakEndTimeIso,
      });
      setTimeline((current) =>
        sortByStartTime(
          current.map((entry) => {
            if (entry.id === block.id) {
              return { ...entry, label: nextLabel, startTimeIso, endTimeIso: focusEndTimeIso };
            }
            if (entry.blockType === "break" && blocksAreAdjacent(block, entry)) {
              return { ...entry, startTimeIso: focusEndTimeIso, endTimeIso: breakEndTimeIso };
            }
            if (block.sourceTaskId && entry.sourceTaskId === block.sourceTaskId) {
              return { ...entry, label: nextLabel };
            }
            if (
              block.sourceDailyRecurringId
              && entry.sourceDailyRecurringId === block.sourceDailyRecurringId
              && entry.blockType === "focus"
            ) {
              return { ...entry, label: nextLabel };
            }
            return entry;
          }),
        ),
      );
    } else if (block.blockType === "fixed_event") {
      const startTimeIso = isoAtTodayTime(timelineEditDraft.startTime);
      const endTimeIso = isoAtTodayTime(timelineEditDraft.endTime);
      if (new Date(startTimeIso).getTime() >= new Date(endTimeIso).getTime()) return;
      await dayStore.updateTimelineEvent(today, block.id, { label: nextLabel, startTimeIso, endTimeIso });
      setTimeline((current) =>
        sortByStartTime(
          current.map((entry) => (entry.id === block.id ? { ...entry, label: nextLabel, startTimeIso, endTimeIso } : entry)),
        ),
      );
    }
    setEditingTimelineBlockId(null);
    setTimelineEditDraft({ label: "", startTime: "", endTime: "" });
  }

  function addTask(): void {
    const title = taskDraft.trim();
    if (!title) return;
    setTasks((current) => [...current, { clientId: newClientId(), title }]);
    setTaskDraft("");
  }

  function updateTask(clientId: string, updates: Partial<TaskInput>): void {
    setTasks((current) => current.map((task) => (task.clientId === clientId ? { ...task, ...updates } : task)));
  }

  function deleteTask(clientId: string): void {
    setTasks((current) => current.filter((task) => task.clientId !== clientId));
  }

  function addEvent(): void {
    if (!eventDraft.title.trim()) return;
    setEvents((current) => [...current, eventDraft]);
    setEventDraft({ clientId: newClientId(), title: "", startTime: "09:00", endTime: "09:30" });
  }

  async function addRecurringTemplate(): Promise<void> {
    const title = recurringDraft.title.trim();
    if (!title) return;
    const response = await dayStore.createRecurringTemplateForDay(today, {
      title,
      startTimeHhmm: recurringDraft.startTime,
      endTimeHhmm: recurringDraft.endTime,
    });
    if (!response.ok || !response.recurring) return;
    setRecurring(normalizeRecurring(response.recurring));
    setRecurringDraft({
      title: "",
      startTime: recurringDraft.startTime,
      endTime: recurringDraft.endTime,
    });
  }

  async function setTimelineTaskCompletion(serverId: string, completed: boolean): Promise<void> {
    const { ok } = await dayStore.setTaskCompletion(today, serverId, completed);
    if (!ok) return;
    await refreshTasksFromStore();
    const [timelineData, timerData] = await Promise.all([dayStore.getTimeline(today), dayStore.getTimerSession(today)]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setTimer(timerData.session);
  }

  async function deleteRecurringTemplateForItem(templateId: string, title: string): Promise<void> {
    const confirmed = window.confirm(
      `Delete recurring template "${title}"? It is removed for future days and the timeline is regenerated when one exists.`,
    );
    if (!confirmed) return;
    await dayStore.deleteRecurringTemplate(today, templateId);
    const [recurringData, timelineData, timerData] = await Promise.all([
      dayStore.getRecurring(today),
      dayStore.getTimeline(today),
      dayStore.getTimerSession(today),
    ]);
    setRecurring(normalizeRecurring(recurringData.recurring));
    setTimeline(sortByStartTime(timelineData.blocks));
    setTimer(timerData.session);
    await refreshTasksFromStore();
  }

  function updateEvent(clientId: string, updates: Partial<EventInput>): void {
    setEvents((current) => current.map((event) => (event.clientId === clientId ? { ...event, ...updates } : event)));
  }

  function handleEventDraftStartChange(nextStartTime: string): void {
    setEventDraft((current) => {
      const durationMinutes = durationMinutesFromRange(current.startTime, current.endTime);
      return {
        ...current,
        startTime: nextStartTime,
        endTime: formatMinutesToHhmm(parseHhmmToMinutes(nextStartTime) + durationMinutes),
      };
    });
  }

  function handleEventStartChange(clientId: string, nextStartTime: string): void {
    setEvents((current) =>
      current.map((event) => {
        if (event.clientId !== clientId) return event;
        const durationMinutes = durationMinutesFromRange(event.startTime, event.endTime);
        return {
          ...event,
          startTime: nextStartTime,
          endTime: formatMinutesToHhmm(parseHhmmToMinutes(nextStartTime) + durationMinutes),
        };
      }),
    );
  }

  function handleRecurringStartChange(itemId: string, nextStartTime: string): void {
    setRecurring((current) =>
      current.map((entry) => {
        if (entry.id !== itemId) return entry;
        const currentStart = entry.startTimeSnapshotHhmm ?? "07:00";
        const currentEnd = entry.endTimeSnapshotHhmm ?? "07:30";
        const durationMinutes = durationMinutesFromRange(currentStart, currentEnd);
        return {
          ...entry,
          startTimeSnapshotHhmm: nextStartTime,
          endTimeSnapshotHhmm: formatMinutesToHhmm(parseHhmmToMinutes(nextStartTime) + durationMinutes),
        };
      }),
    );
  }

  function deleteEvent(clientId: string): void {
    setEvents((current) => current.filter((event) => event.clientId !== clientId));
  }

  function togglePlanningTimer(): void {
    setPlanningTimerRunning((current) => !current);
  }

  function resetPlanningTimer(): void {
    setPlanningTimerRunning(false);
    setPlanningSecondsLeft(PLANNING_TIMER_SECONDS);
  }

  function calendarItemStyle(item: CalendarItem): CSSProperties {
    const gridHeightPx = (calendarBounds.totalMinutes / 60) * HOUR_HEIGHT_PX;
    const itemEndIso = item.breakBlock?.endTimeIso ?? item.block.endTimeIso;
    const startMinute = minutesFromDayStart(item.block.startTimeIso) - calendarBounds.startHour * 60;
    const durationMinutes = Math.max(5, (new Date(itemEndIso).getTime() - new Date(item.block.startTimeIso).getTime()) / 60_000);
    const y0 = (startMinute / calendarBounds.totalMinutes) * gridHeightPx;
    const y1 = ((startMinute + durationMinutes) / calendarBounds.totalMinutes) * gridHeightPx;
    const gap = CALENDAR_VERTICAL_GAP_PX;
    const topPx = y0 + gap / 2;
    const heightPx = Math.max(y1 - y0 - gap, 10);
    const baseStyle: CSSProperties = {
      top: `${(topPx / gridHeightPx) * 100}%`,
      height: `${(heightPx / gridHeightPx) * 100}%`,
    };
    if (item.kind !== "fixed_event" || item.laneCount === 1) return baseStyle;

    const gapPercent = 1;
    const availableWidth = 100 - gapPercent * (item.laneCount - 1);
    const laneWidth = availableWidth / item.laneCount;
    return {
      ...baseStyle,
      left: `calc(0.75rem + ${item.laneIndex * (laneWidth + gapPercent)}%)`,
      width: `calc(${laneWidth}% - 0.75rem)`,
      right: "auto",
    };
  }

  if (loading) {
    return <main className="app"><p>Loading today&apos;s plan...</p></main>;
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Day Planner</p>
          <h1>{dateParts.dateText}</h1>
        </div>
        <div className="weekday-badge">{dateParts.weekday}</div>
      </header>

      {mode === "editing" && (
        <section className="editing-layout">
          <div>
            <div className="section-heading">
              <div className="planning-heading">
                <h2>Plan the Day</h2>
                <p>Add work, eliminate recurring items, and block calendar events before saving the timeline.</p>
              </div>
              <div className="section-actions">
                <button onClick={() => void clearDay()}>
                  <RotateCcw size={18} aria-hidden="true" />
                  <span>Clear Day</span>
                </button>
                <button disabled={tasks.length === 0} onClick={() => void saveDay()}>
                  <Save size={18} aria-hidden="true" />
                  <span>Save Day</span>
                </button>
              </div>
            </div>
            <section className="day-boundary-controls panel">
              <div className="day-boundary-fields">
                <label>
                  <span>Day Start</span>
                  <select value={dayStartTime} onChange={(event) => handleDayStartTimeChange(event.target.value)} aria-label="Day start time">
                    {TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>{formatSelectTime(time)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Day End</span>
                  <select value={dayEndTime} onChange={(event) => handleDayEndTimeChange(event.target.value)} aria-label="Day end time">
                    {dayEndOptions.map((time) => (
                      <option key={time} value={time}>{formatSelectTime(time)}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <div className="edit-panels">
              <div className="panel">
                <h3>Add Tasks</h3>
                <div className="add-card">
                  <input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="Important task" />
                  <button onClick={addTask} aria-label="Add task" title="Add task">
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </div>
                <ol className="editable-list">
                  {tasks.map((task) => (
                    <li key={task.clientId}>
                      <div className="item-row task-entry">
                        <input
                          value={task.title}
                          onChange={(event) => updateTask(task.clientId, { title: event.target.value })}
                          aria-label="Task title"
                        />
                        <div className="pomodoro-picker" aria-label="Estimated Pomodoros">
                          {POMODORO_OPTIONS.map((count) => (
                            <label key={count}>
                              <input
                                type="radio"
                                name={`pomodoros-${task.clientId}`}
                                checked={(task.estimatedPomodoros ?? 1) === count}
                                onChange={() => updateTask(task.clientId, { estimatedPomodoros: count })}
                              />
                              <span>{count}</span>
                            </label>
                          ))}
                        </div>
                        <button onClick={() => deleteTask(task.clientId)} aria-label="Remove task" title="Remove task">
                          <Minus size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="panel">
                <h3>Recurring Tasks</h3>
                <div className="add-card recurring-add-card">
                  <input
                    value={recurringDraft.title}
                    onChange={(event) => setRecurringDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="New recurring task"
                    aria-label="New recurring task title"
                  />
                  <select
                    value={recurringDraft.startTime}
                    onChange={(event) => setRecurringDraft((current) => ({ ...current, startTime: event.target.value }))}
                    aria-label="New recurring start time"
                  >
                    {TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>{formatSelectTime(time)}</option>
                    ))}
                  </select>
                  <select
                    value={recurringDraft.endTime}
                    onChange={(event) => setRecurringDraft((current) => ({ ...current, endTime: event.target.value }))}
                    aria-label="New recurring end time"
                  >
                    {recurringEndOptions.map((time) => (
                      <option key={time} value={time}>{formatEndOptionLabel(recurringDraft.startTime, time)}</option>
                    ))}
                  </select>
                  <button onClick={() => void addRecurringTemplate()} aria-label="Add recurring task default" title="Add recurring task default">
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </div>
                <ul className="editable-list">
                  {recurring.map((item) => (
                    <li key={item.id}>
                      <div className="edit-row recurring-entry">
                        <input
                          value={item.titleSnapshot}
                          onChange={(event) =>
                            setRecurring((current) =>
                              current.map((entry) => (entry.id === item.id ? { ...entry, titleSnapshot: event.target.value } : entry)),
                            )
                          }
                          aria-label="Recurring task title"
                        />
                        <select
                          value={item.startTimeSnapshotHhmm ?? "07:00"}
                          onChange={(event) => handleRecurringStartChange(item.id, event.target.value)}
                          aria-label="Recurring start time"
                        >
                          {TIME_OPTIONS.map((time) => (
                            <option key={time} value={time}>{formatSelectTime(time)}</option>
                          ))}
                        </select>
                        <select
                          value={item.endTimeSnapshotHhmm ?? "07:30"}
                          onChange={(event) =>
                            setRecurring((current) =>
                              current.map((entry) => (entry.id === item.id ? { ...entry, endTimeSnapshotHhmm: event.target.value } : entry)),
                            )
                          }
                          aria-label="Recurring end time"
                        >
                          {TIME_OPTIONS.map((time) => (
                            <option key={time} value={time}>{formatEndOptionLabel(item.startTimeSnapshotHhmm ?? "07:00", time)}</option>
                          ))}
                        </select>
                        <select
                          value={item.editScope}
                          onChange={(event) =>
                            setRecurring((current) =>
                              current.map((entry) => (entry.id === item.id ? { ...entry, editScope: event.target.value as "today" | "template" } : entry)),
                            )
                          }
                          aria-label="Edit scope"
                        >
                          <option value="today">Today only</option>
                          <option value="template">Every day</option>
                        </select>
                        <button
                          type="button"
                          onClick={() =>
                            setRecurring((current) =>
                              current.map((entry) =>
                                entry.id === item.id ? { ...entry, isCompleted: !entry.isCompleted } : entry,
                              ),
                            )
                          }
                          aria-label={item.isCompleted ? "Mark recurring as not completed" : "Mark recurring as completed"}
                          title={
                            item.isCompleted
                              ? "Mark this recurring row as not completed for today (reset completion)"
                              : "Mark this recurring row as completed for today"
                          }
                        >
                          {item.isCompleted ? <RotateCcw size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteRecurringTemplateForItem(item.recurringTemplateId, item.titleSnapshot)}
                          aria-label={`Delete recurring template ${item.titleSnapshot}`}
                          title="Delete this recurring template from all future days"
                        >
                          <Trash2 size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel">
                <h3>Add Calendar Events</h3>
                <div className="add-card">
                  <input
                    value={eventDraft.title}
                    onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Meeting title"
                  />
                  <select
                    value={eventDraft.startTime}
                    onChange={(event) => handleEventDraftStartChange(event.target.value)}
                    aria-label="Event start"
                  >
                    {TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>{formatSelectTime(time)}</option>
                    ))}
                  </select>
                  <select
                    value={eventDraft.endTime}
                    onChange={(event) => setEventDraft((current) => ({ ...current, endTime: event.target.value }))}
                    aria-label="Event end"
                  >
                    {TIME_OPTIONS.map((time) => (
                      <option key={time} value={time}>{formatEndOptionLabel(eventDraft.startTime, time)}</option>
                    ))}
                  </select>
                  <button onClick={addEvent} aria-label="Add event" title="Add event">
                    <Plus size={18} aria-hidden="true" />
                  </button>
                </div>
                <ul className="editable-list">
                  {events.map((eventItem) => (
                    <li key={eventItem.clientId}>
                      <div className="edit-row event-entry">
                        <input
                          value={eventItem.title}
                          onChange={(event) => updateEvent(eventItem.clientId, { title: event.target.value })}
                          aria-label="Event title"
                        />
                        <select
                          value={eventItem.startTime}
                          onChange={(event) => handleEventStartChange(eventItem.clientId, event.target.value)}
                          aria-label="Event start"
                        >
                          {TIME_OPTIONS.map((time) => (
                            <option key={time} value={time}>{formatSelectTime(time)}</option>
                          ))}
                        </select>
                        <select
                          value={eventItem.endTime}
                          onChange={(event) => updateEvent(eventItem.clientId, { endTime: event.target.value })}
                          aria-label="Event end"
                        >
                          {TIME_OPTIONS.map((time) => (
                            <option key={time} value={time}>{formatEndOptionLabel(eventItem.startTime, time)}</option>
                          ))}
                        </select>
                        <button onClick={() => deleteEvent(eventItem.clientId)} aria-label="Remove event" title="Remove event">
                          <Minus size={18} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <TimerCard
            title="Planning Timer"
            variant="planning"
            labelText="Planning session"
            timeText={`${Math.floor(planningSecondsLeft / 60)}:${String(planningSecondsLeft % 60).padStart(2, "0")}`}
            progressPercent={planningProgressPercent}
            stateText={`State: ${planningState}`}
            helperText="Use this 10-minute timer to time box your planning session."
            actions={(
              <>
                <button onClick={togglePlanningTimer} aria-label={planningTimerRunning ? "Pause planning timer" : "Start planning timer"}>
                  {planningTimerRunning ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                </button>
                <button onClick={resetPlanningTimer} aria-label="Reset planning timer">
                  <RotateCcw size={18} aria-hidden="true" />
                </button>
              </>
            )}
          />
        </section>
      )}

      {mode === "timeline" && (
        <section className="execution">
          <div className="timeline panel">
            <div className="section-heading">
              <h2>Timeline</h2>
              <div className="row">
                <button onClick={() => void resetDay()}>
                  <RotateCcw size={18} aria-hidden="true" />
                  <span>Reset Day</span>
                </button>
                <button onClick={() => setMode("editing")}>
                  <Pencil size={18} aria-hidden="true" />
                  <span>Edit Timeline</span>
                </button>
              </div>
            </div>
            {unscheduledCount > 0 && <p className="warning">{unscheduledCount} tasks could not be fully scheduled.</p>}
            {timelineConflictCount > 0 && (
              <div className="conflict-banner">
                <span>{timelineConflictCount} timeline conflict{timelineConflictCount === 1 ? "" : "s"} detected.</span>
                <button onClick={() => void regenerateTimeline()}>
                  <RotateCcw size={18} aria-hidden="true" />
                  <span>Regenerate Timeline</span>
                </button>
              </div>
            )}
            <div
              className="calendar-shell"
              style={{ height: `${(calendarBounds.totalMinutes / 60) * HOUR_HEIGHT_PX}px` }}
            >
              <div className="calendar-axis">
                {calendarHours.map((hour) => (
                  <div key={hour} className="calendar-hour" style={{ top: `${((hour - calendarBounds.startHour) * 60 / calendarBounds.totalMinutes) * 100}%` }}>
                    {formatHourLabel(hour)}
                  </div>
                ))}
              </div>
              <div className="calendar-grid">
                {calendarHours.map((hour) => (
                  <div
                    key={hour}
                    className="calendar-line"
                    style={{ top: `${((hour - calendarBounds.startHour) * 60 / calendarBounds.totalMinutes) * 100}%` }}
                  />
                ))}
                {calendarNowLineStyle && (
                  <div className="calendar-now-line" style={calendarNowLineStyle} aria-hidden="true" />
                )}
                {calendarItems.map((item) => {
                  const block = item.block;
                  const isActive = timer?.activeBlockId === block.id || timer?.activeBlockId === item.breakBlock?.id;
                  const itemClassName = `${blockClass(block)}${item.kind === "focus-session" ? " calendar-block-session" : ""}${
                    isActive ? " active" : ""
                  }${editingTimelineBlockId === block.id ? " editing" : ""}`;

                  return (
                    <div key={item.id} className={itemClassName} style={calendarItemStyle(item)}>
                      <div className="calendar-block-main">
                        <div className="calendar-block-header">
                          <div className="calendar-title-row">
                            <strong>{formatTime(block.startTimeIso)} - {formatTime(block.endTimeIso)}</strong>
                            {editingTimelineBlockId !== block.id && <span>{block.label}</span>}
                          </div>
                          <div className="calendar-actions">
                            {item.breakBlock && (
                              <div className="calendar-break-segment calendar-break-segment-inline">
                                <span>{formatTime(item.breakBlock.startTimeIso)}</span>
                                <button
                                  onClick={() => void playBlock(item.breakBlock.id)}
                                  disabled={item.breakBlock.status === "completed"}
                                  aria-label="Play break"
                                  title="Play break"
                                >
                                  <Coffee size={16} aria-hidden="true" />
                                </button>
                              </div>
                            )}
                            {block.blockType !== "fixed_event" && (
                              <>
                                <button
                                  onClick={() => void playBlock(block.id)}
                                  disabled={block.status === "completed"}
                                  aria-label={`Play ${block.label}`}
                                  title="Play"
                                >
                                  <Play size={16} aria-hidden="true" />
                                </button>
                                <button
                                  onClick={() => void completeBlock(block.id)}
                                  disabled={block.status === "completed"}
                                  aria-label={`Complete ${block.label}`}
                                  title="Completed"
                                >
                                  <Check size={16} aria-hidden="true" />
                                </button>
                              </>
                            )}
                            {block.blockType !== "break" && editingTimelineBlockId !== block.id && (
                              <button onClick={() => beginTimelineEdit(block)} aria-label={`Edit ${block.label}`} title="Edit">
                                <Pencil size={16} aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                        {block.blockType !== "break" && editingTimelineBlockId === block.id && (
                          <div className="calendar-edit-row">
                            <input
                              value={timelineEditDraft.label}
                              onChange={(event) => setTimelineEditDraft((current) => ({ ...current, label: event.target.value }))}
                              aria-label="Timeline label"
                            />
                            <input
                              type="time"
                              value={timelineEditDraft.startTime}
                              onChange={(event) => setTimelineEditDraft((current) => ({ ...current, startTime: event.target.value }))}
                              aria-label="Timeline start time"
                            />
                            {block.blockType === "fixed_event" && (
                              <input
                                type="time"
                                value={timelineEditDraft.endTime}
                                onChange={(event) => setTimelineEditDraft((current) => ({ ...current, endTime: event.target.value }))}
                                aria-label="Timeline end time"
                              />
                            )}
                            <button onClick={() => void saveTimelineEdit(block)} aria-label="Save timeline label">
                              <Check size={16} aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => {
                                setEditingTimelineBlockId(null);
                                setTimelineEditDraft({ label: "", startTime: "", endTime: "" });
                              }}
                              aria-label="Cancel timeline edit"
                            >
                              <X size={16} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="timeline-timer-column">
            <TimerCard
              title="Pomodoro Timer 🍎"
              variant={pomodoroTimerVariant}
              labelText={displayedBlock?.label ?? "No task ready"}
              timeText={formatTimer(remainingSeconds)}
              progressPercent={timerProgressPercent}
              progressDanger={timerAlmostDone}
              stateText={`State: ${timer?.state ?? "idle"}`}
              helperText="Stay on this block until complete, then move to the next one."
              actions={(
                <>
                  <button
                    type="button"
                    onClick={() => void startTimer()}
                    disabled={!timer || timer.state === "running"}
                    aria-label="Start timer"
                  >
                    <Play size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void togglePause()}
                    disabled={!timer || timer.state !== "running"}
                    aria-label="Pause timer"
                  >
                    <Pause size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void skipBlock()}
                    disabled={!timer || !timer.activeBlockId}
                    aria-label="Skip block"
                  >
                    <SkipForward size={18} aria-hidden="true" />
                  </button>
                </>
              )}
            />
            <div className="panel timeline-task-list">
              <h4>Today&apos;s tasks</h4>
              <ul className="timeline-task-list-items">
                {tasks
                  .filter((task) => task.serverId)
                  .map((task) => (
                    <li key={task.serverId} className="timeline-task-list-row">
                      <span className={task.status === "completed" ? "timeline-task-title is-completed" : "timeline-task-title"}>
                        {task.title}
                      </span>
                      <div className="timeline-task-actions">
                        {task.status !== "completed" ? (
                          <button
                            type="button"
                            className="timeline-task-complete"
                            onClick={() => void setTimelineTaskCompletion(task.serverId as string, true)}
                          >
                            Complete
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="timeline-task-undo"
                            onClick={() => void setTimelineTaskCompletion(task.serverId as string, false)}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
