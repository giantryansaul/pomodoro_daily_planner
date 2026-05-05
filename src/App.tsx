import { Apple, Check, Coffee, Minus, Pause, Pencil, Play, Plus, Repeat, RotateCcw, SkipForward, Trash2, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FOCUS_SESSION_MINUTES } from "./planner";
import { dayStore } from "./dayStore";
import type { DayBoundaryDefaults, RecurringTemplateKind, ScheduleBlock as Block, TaskStatus, TimerSession } from "./types";

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
  estimatedPomodoros: number | null;
  isCompleted: boolean;
  sortOrder: number;
  kind: RecurringTemplateKind;
};
type EventInput = { clientId: string; serverId?: string; title: string; startTime: string; endTime: string };
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
type TimerCardVariant = Block["blockType"] | "empty" | "recurring_focus";
type TimerCardProps = {
  title: ReactNode;
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
const DEFAULT_DAY_START_TIME = "07:00";
const DEFAULT_DAY_END_TIME = "19:00";
const DEFAULT_RECURRING_START_TIME = "07:00";
const DEFAULT_RECURRING_CALENDAR_START_TIME = "12:00";
const DEFAULT_RECURRING_CALENDAR_END_TIME = "12:30";
const HOUR_HEIGHT_PX = 96;
/** Vertical breathing room between stacked calendar blocks (px), converted using grid height. */
const CALENDAR_VERTICAL_GAP_PX = 5;
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  return `${String(hours).padStart(2, "0")}:${minutes}`;
});
const POMODORO_OPTIONS = [1, 2, 3, 4, 5];
const MIN_POMODORO = Math.min(...POMODORO_OPTIONS);
const MAX_POMODORO = Math.max(...POMODORO_OPTIONS);
const MIN_EVENT_DURATION_MIN = 30;
const MAX_EVENT_DURATION_MIN = 600;

function eventEndTimeOptions(startTime: string): string[] {
  const startM = parseHhmmToMinutes(startTime);
  return TIME_OPTIONS.filter((endTime) => {
    const endM = parseHhmmToMinutes(endTime);
    if (endM <= startM) return false;
    const dur = endM - startM;
    return dur >= MIN_EVENT_DURATION_MIN && dur <= MAX_EVENT_DURATION_MIN;
  });
}

function clampEventEndTime(startTime: string, preferredEnd: string): string {
  const valid = eventEndTimeOptions(startTime);
  if (valid.length === 0) return preferredEnd;
  if (valid.includes(preferredEnd)) return preferredEnd;
  return valid[0]!;
}

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

function clampRecurringPomosForUi(n: number | null | undefined): number {
  if (n == null || Number.isNaN(n)) return 1;
  return Math.min(5, Math.max(1, Math.round(n)));
}

function deriveTaskPomosFromSnapshots(start: string | null, end: string | null): number {
  if (!start || !end) return 1;
  const span = durationMinutesFromRange(start, end);
  const n = Math.floor(span / FOCUS_SESSION_MINUTES);
  return n >= 1 ? clampRecurringPomosForUi(n) : 1;
}

function recurringTaskEndFromStart(startHhmm: string, pomodoros: number): string {
  return formatMinutesToHhmm(parseHhmmToMinutes(startHhmm) + pomodoros * FOCUS_SESSION_MINUTES);
}

/** Calendar-style blocks that are not driven by the pomodoro timer. */
function isNonPomodoroTimelineBlock(block: Block): boolean {
  return block.blockType === "fixed_event" || block.blockType === "recurring_event";
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

function pomodoroSessionContext(
  ordered: Block[],
  anchor: Block | undefined,
): { title: string; current: number; total: number } | null {
  if (!anchor) return null;
  let focusBlock: Block | undefined;
  if (anchor.blockType === "break") {
    const breakIndex = ordered.findIndex((block) => block.id === anchor.id);
    if (breakIndex === -1) return null;
    for (let i = breakIndex - 1; i >= 0; i -= 1) {
      const candidate = ordered[i];
      if (candidate.blockType === "focus" && candidate.endTimeIso === anchor.startTimeIso) {
        focusBlock = candidate;
        break;
      }
    }
  } else if (anchor.blockType === "focus") {
    focusBlock = anchor;
  } else {
    return null;
  }
  if (!focusBlock) return null;
  const { sourceTaskId, sourceDailyRecurringId } = focusBlock;
  if (!sourceTaskId && !sourceDailyRecurringId) return null;
  const focuses = ordered.filter(
    (block) =>
      block.blockType === "focus"
      && (sourceTaskId ? block.sourceTaskId === sourceTaskId : block.sourceDailyRecurringId === sourceDailyRecurringId),
  );
  if (focuses.length === 0) return null;
  const current = focuses.findIndex((block) => block.id === focusBlock!.id) + 1;
  return { title: focusBlock.label, current, total: focuses.length };
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

type CalendarBoundsRect = { startHour: number; endHour: number; totalMinutes: number };

function snapMinutesToNearestSlot(minutesFromMidnight: number): string {
  const wrapped = ((minutesFromMidnight % 1440) + 1440) % 1440;
  let best = TIME_OPTIONS[0]!;
  let bestDiff = Infinity;
  for (const t of TIME_OPTIONS) {
    const m = parseHhmmToMinutes(t);
    const d = Math.abs(m - wrapped);
    if (d < bestDiff) {
      bestDiff = d;
      best = t;
    }
  }
  return best;
}

function minutesOfDayFromGridY(yWithinGrid: number, gridHeight: number, bounds: CalendarBoundsRect): number {
  const frac = gridHeight <= 0 ? 0 : Math.max(0, Math.min(1, yWithinGrid / gridHeight));
  return bounds.startHour * 60 + frac * bounds.totalMinutes;
}

function minuteDeltaFromDragDy(deltaY: number, gridHeight: number, bounds: CalendarBoundsRect): number {
  if (gridHeight <= 0) return 0;
  return (deltaY / gridHeight) * bounds.totalMinutes;
}

/** Start of the half-hour window (minutes from midnight) that contains `minutesFromMidnight`. */
function halfHourSliceStartMin(minutesFromMidnight: number): number {
  const wrapped = ((minutesFromMidnight % 1440) + 1440) % 1440;
  return Math.floor(wrapped / 30) * 30;
}

function calendarItemOverlapsSlice(item: CalendarItem, sliceStartMin: number, sliceEndMin: number): boolean {
  const itemStartMin = minutesFromDayStart(item.block.startTimeIso);
  const endIso = item.breakBlock?.endTimeIso ?? item.block.endTimeIso;
  const itemEndMin = minutesFromDayStart(endIso);
  return itemStartMin < sliceEndMin && itemEndMin > sliceStartMin;
}

function isSliceFreeOfItems(sliceStartMin: number, items: CalendarItem[]): boolean {
  const sliceEndMin = sliceStartMin + 30;
  return !items.some((item) => calendarItemOverlapsSlice(item, sliceStartMin, sliceEndMin));
}

/** Clamps the 30m clock slice to the visible grid window; used for band positioning. */
function emptySlotBandLayout(
  sliceStartMin: number,
  bounds: CalendarBoundsRect,
): { topPct: number; heightPct: number } {
  const visStartMin = bounds.startHour * 60;
  const visEndMin = bounds.startHour * 60 + bounds.totalMinutes;
  const sliceEndMin = sliceStartMin + 30;
  const clampedStart = Math.max(sliceStartMin, visStartMin);
  const clampedEnd = Math.min(sliceEndMin, visEndMin);
  const topRel = clampedStart - visStartMin;
  const heightRel = Math.max(0, clampedEnd - clampedStart);
  return {
    topPct: (topRel / bounds.totalMinutes) * 100,
    heightPct: (heightRel / bounds.totalMinutes) * 100,
  };
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
  sortOrder: number;
  kind?: RecurringTemplateKind;
  estimatedPomodoros?: number | null;
}>): RecurringItemTimed[] {
  return items.map((item) => {
    const kind = item.kind === "calendar_event" ? "calendar_event" : "task";
    if (kind === "calendar_event") {
      return { ...item, kind, estimatedPomodoros: null };
    }
    const ep =
      item.estimatedPomodoros != null && item.estimatedPomodoros >= 1
        ? clampRecurringPomosForUi(item.estimatedPomodoros)
        : deriveTaskPomosFromSnapshots(item.startTimeSnapshotHhmm, item.endTimeSnapshotHhmm);
    return { ...item, kind, estimatedPomodoros: ep };
  });
}

function App() {
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [recurring, setRecurring] = useState<RecurringItemTimed[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [timeline, setTimeline] = useState<Block[]>([]);
  const [timer, setTimer] = useState<TimerSession | null>(null);
  const [dayStartTime, setDayStartTime] = useState(DEFAULT_DAY_START_TIME);
  const [dayEndTime, setDayEndTime] = useState(DEFAULT_DAY_END_TIME);
  const [editingTimelineBlockId, setEditingTimelineBlockId] = useState<string | null>(null);
  const [timelineEditDraft, setTimelineEditDraft] = useState<TimelineEditDraft>({ label: "", startTime: "", endTime: "" });
  const [unscheduledCount, setUnscheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const calendarGridRef = useRef<HTMLDivElement | null>(null);
  const emptySlotHoverTimerRef = useRef<number | null>(null);
  const pendingEmptySlotRef = useRef<{ sliceStartMin: number; startHhmm: string } | null>(null);
  const [emptySlotPopover, setEmptySlotPopover] = useState<{ sliceStartMin: number; startHhmm: string } | null>(null);
  const [calendarMoveDrag, setCalendarMoveDrag] = useState<{
    pointerId: number;
    itemId: string;
    startClientY: number;
    previewDeltaMinutes: number;
  } | null>(null);
  const [calendarResize, setCalendarResize] = useState<{
    pointerId: number;
    blockId: string;
    startClientY: number;
    previewEndIso: string;
  } | null>(null);
  const [slotAddEventOpen, setSlotAddEventOpen] = useState<{ startHhmm: string; endHhmm: string; title: string } | null>(null);
  const [slotAddTaskOpen, setSlotAddTaskOpen] = useState<{
    startHhmm: string;
    title: string;
    estimatedPomodoros: number;
  } | null>(null);
  const orderedTimeline = useMemo(() => sortByStartTime(timeline), [timeline]);
  const firstRunnableBlock = useMemo(
    () => orderedTimeline.find((block) => !isNonPomodoroTimelineBlock(block) && block.status !== "completed"),
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
  const pomodoroTimerLabel = useMemo(() => {
    const ctx = pomodoroSessionContext(orderedTimeline, displayedBlock);
    if (ctx) return `${ctx.title} ${ctx.current} of ${ctx.total}`;
    return displayedBlock?.label ?? "No task ready";
  }, [orderedTimeline, displayedBlock]);
  const recurringTaskRows = useMemo(() => {
    return [...recurring]
      .filter((item) => item.kind !== "calendar_event")
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [recurring]);
  const recurringCalendarRows = useMemo(() => {
    return [...recurring]
      .filter((item) => item.kind === "calendar_event")
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [recurring]);
  const displayedBlockDurationSeconds = durationInSeconds(displayedBlock);
  const displayedElapsedSeconds = activeBlock ? (timer?.elapsedSeconds ?? 0) : 0;
  const remainingSeconds = Math.max(displayedBlockDurationSeconds - displayedElapsedSeconds, 0);
  const timerProgressPercent =
    displayedBlockDurationSeconds > 0 ? Math.min((displayedElapsedSeconds / displayedBlockDurationSeconds) * 100, 100) : 0;
  const timerAlmostDone = displayedBlockDurationSeconds > 0 && remainingSeconds <= displayedBlockDurationSeconds * 0.2;
  const dateParts = useMemo(() => formatDateParts(today), []);
  const dayEndOptions = useMemo(
    () => TIME_OPTIONS.filter((time) => parseHhmmToMinutes(time) > parseHhmmToMinutes(dayStartTime)),
    [dayStartTime],
  );

  useEffect(() => {
    if (parseHhmmToMinutes(dayEndTime) > parseHhmmToMinutes(dayStartTime)) return;
    if (dayEndOptions.length > 0) {
      setDayEndTime(dayEndOptions[0]);
    }
  }, [dayEndOptions, dayEndTime, dayStartTime]);

  const calendarBounds = useMemo(() => {
    const blockStarts = orderedTimeline.map((block) => minutesFromDayStart(block.startTimeIso));
    const blockEnds = orderedTimeline.map((block) => minutesFromDayStart(block.endTimeIso));
    const selectedStartMinutes = parseHhmmToMinutes(dayStartTime);
    const selectedEndMinutes = parseHhmmToMinutes(dayEndTime);
    const minBlockStart = blockStarts.length > 0 ? Math.min(...blockStarts) : selectedStartMinutes;
    const maxBlockEnd = blockEnds.length > 0 ? Math.max(...blockEnds) : selectedEndMinutes;
    const startHour = Math.min(Math.floor(selectedStartMinutes / 60), Math.floor(Math.min(minBlockStart, selectedStartMinutes) / 60));
    const endHour = Math.max(Math.ceil(selectedEndMinutes / 60), Math.ceil(Math.max(maxBlockEnd, selectedEndMinutes) / 60));
    const clampedEndHour = Math.max(startHour + 1, endHour);
    return { startHour, endHour: clampedEndHour, totalMinutes: (clampedEndHour - startHour) * 60 };
  }, [dayEndTime, dayStartTime, orderedTimeline]);
  const calendarHours = useMemo(
    () => Array.from({ length: calendarBounds.endHour - calendarBounds.startHour + 1 }, (_, index) => calendarBounds.startHour + index),
    [calendarBounds.endHour, calendarBounds.startHour],
  );
  const calendarItems = useMemo(() => buildCalendarItems(orderedTimeline), [orderedTimeline]);
  const timelineConflictCount = useMemo(() => countTimelineConflicts(calendarItems), [calendarItems]);
  const emptySlotBandMetrics = useMemo(() => {
    if (!emptySlotPopover) return null;
    return emptySlotBandLayout(emptySlotPopover.sliceStartMin, calendarBounds);
  }, [emptySlotPopover, calendarBounds]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setTimer((current) => {
        if (!current || current.state !== "running" || !current.activeBlockId) return current;
        return { ...current, elapsedSeconds: current.elapsedSeconds + 1 };
      });
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

  const loadDay = useCallback(async (): Promise<void> => {
    const [tasksData, recurringData, eventsData, timelineData, timerData, defaultsData] = await Promise.all([
      dayStore.getTasks(today),
      dayStore.getRecurring(today),
      dayStore.getEvents(today),
      dayStore.getTimeline(today),
      dayStore.getTimerSession(today),
      dayStore.getDayBoundaryDefaults(),
    ]);

    const dayStart = defaultsData.dayStartTimeHhmm ?? DEFAULT_DAY_START_TIME;
    const dayEnd = defaultsData.dayEndTimeHhmm ?? DEFAULT_DAY_END_TIME;
    setDayStartTime(dayStart);
    setDayEndTime(dayEnd);

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
        serverId: event.id,
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
      })),
    );

    let nextTimeline = sortByStartTime(timelineData.blocks);
    let nextTimerSession = timerData.session;
    if (nextTimeline.length === 0) {
      const planData = await dayStore.generatePlan(today, { dayStartTimeHhmm: dayStart, dayEndTimeHhmm: dayEnd });
      setUnscheduledCount(planData.unscheduledTasks.length);
      const [timelineReload, tasksReload, recurringReload, eventsReload, timerReload] = await Promise.all([
        dayStore.getTimeline(today),
        dayStore.getTasks(today),
        dayStore.getRecurring(today),
        dayStore.getEvents(today),
        dayStore.getTimerSession(today),
      ]);
      nextTimeline = sortByStartTime(timelineReload.blocks);
      setTasks(
        tasksReload.tasks.map((task) => ({
          clientId: newClientId(),
          serverId: task.id,
          title: task.title,
          estimatedPomodoros: task.estimatedPomodoros ?? undefined,
          status: task.status,
        })),
      );
      setRecurring(normalizeRecurring(recurringReload.recurring));
      setEvents(
        eventsReload.events.map((event) => ({
          clientId: newClientId(),
          serverId: event.id,
          title: event.title,
          startTime: event.startTimeIso.slice(11, 16),
          endTime: event.endTimeIso.slice(11, 16),
        })),
      );
      nextTimerSession = timerReload.session;
    }

    setTimeline(nextTimeline);
    setTimer(nextTimerSession);
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

  const refreshEventsFromStore = useCallback(async (): Promise<void> => {
    const ev = await dayStore.getEvents(today);
    setEvents((prev) => {
      const clientIdByServerId = new Map(
        prev.filter((e) => e.serverId).map((e) => [e.serverId as string, e.clientId]),
      );
      return ev.events.map((event) => ({
        clientId: clientIdByServerId.get(event.id) ?? newClientId(),
        serverId: event.id,
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
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
    await refreshEventsFromStore();
    setEditingTimelineBlockId(null);
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
    const planData = await dayStore.generatePlan(today, { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime });
    setUnscheduledCount(planData.unscheduledTasks.length);
    const [timelineData, tasksReload, recurringReload, eventsReload, timerReload] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getTasks(today),
      dayStore.getRecurring(today),
      dayStore.getEvents(today),
      dayStore.getTimerSession(today),
    ]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setTasks(
      tasksReload.tasks.map((task) => ({
        clientId: newClientId(),
        serverId: task.id,
        title: task.title,
        estimatedPomodoros: task.estimatedPomodoros ?? undefined,
        status: task.status,
      })),
    );
    setRecurring(normalizeRecurring(recurringReload.recurring));
    setEvents(
      eventsReload.events.map((event) => ({
        clientId: newClientId(),
        serverId: event.id,
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
      })),
    );
    setTimer(timerReload.session);
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
            && !isNonPomodoroTimelineBlock(block)
            && block.status !== "completed",
        )
      : undefined;
    const targetBlock =
      fromCalendar
      ?? orderedTimeline.find((block) => !isNonPomodoroTimelineBlock(block) && block.status !== "completed");
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

  /** Skip to the next focus session (task work), not the paired break. */
  async function skipToNextFocus(): Promise<void> {
    if (!timer || !timer.activeBlockId) return;
    const currentIndex = orderedTimeline.findIndex((block) => block.id === timer.activeBlockId);
    const nextFocus = orderedTimeline
      .slice(currentIndex + 1)
      .find((block) => block.blockType === "focus" && block.status !== "completed");
    const next = {
      ...timer,
      activeBlockId: nextFocus?.id ?? null,
      elapsedSeconds: 0,
      state: nextFocus ? ("running" as const) : ("completed" as const),
    };
    setTimer(next);
    await persistTimer(next);
  }

  /** Jump timer to the next break block in timeline order (forward from current block). */
  async function goToNextBreak(): Promise<void> {
    if (!timer) return;
    const idx = orderedTimeline.findIndex((block) => block.id === timer.activeBlockId);
    const startSearch = idx === -1 ? 0 : idx + 1;
    const nextBreak = orderedTimeline
      .slice(startSearch)
      .find((block) => block.blockType === "break" && block.status !== "completed");
    if (!nextBreak) return;
    await playBlock(nextBreak.id);
  }

  async function resetPomodoroTimer(): Promise<void> {
    if (!timer || !timer.activeBlockId) return;
    const next: TimerSession = { ...timer, elapsedSeconds: 0, state: "paused" };
    setTimer(next);
    await persistTimer(next);
  }

  async function completeBlock(blockId: string): Promise<void> {
    const targetBlock = orderedTimeline.find((block) => block.id === blockId);
    if (!targetBlock || targetBlock.status === "completed") return;
    await dayStore.markBlockCompleted(today, blockId);
    await refreshTasksFromStore();
    const [timelineData, recurringData, timerData] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getRecurring(today),
      dayStore.getTimerSession(today),
    ]);
    const refreshed = sortByStartTime(timelineData.blocks);
    setTimeline(refreshed);
    setRecurring(normalizeRecurring(recurringData.recurring));

    let session = timerData.session;
    if (timer && timer.activeBlockId === blockId) {
      const currentIndex = refreshed.findIndex((block) => block.id === blockId);
      const nextBlock = refreshed
        .slice(currentIndex + 1)
        .find((block) => !isNonPomodoroTimelineBlock(block) && block.status !== "completed");
      session = {
        ...timerData.session,
        activeBlockId: nextBlock?.id ?? null,
        elapsedSeconds: 0,
        state: nextBlock ? "running" : "completed",
      };
      await persistTimer(session);
    }
    setTimer(session);
  }

  async function revertBlockFromCalendar(blockId: string): Promise<void> {
    const { ok } = await dayStore.revertBlockCompletion(today, blockId);
    if (!ok) return;
    await refreshTasksFromStore();
    const [timelineData, recurringData, timerData] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getRecurring(today),
      dayStore.getTimerSession(today),
    ]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setRecurring(normalizeRecurring(recurringData.recurring));
    setTimer(timerData.session);
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
    } else if (block.blockType === "fixed_event" || block.blockType === "recurring_event") {
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

  async function promoteAdhocTaskToRecurring(serverId: string): Promise<void> {
    const res = await dayStore.promoteTaskToRecurringTemplate(today, serverId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshTasksFromStore();
    await refreshTimelineAndRelated();
  }

  async function removeAdhocTask(serverId: string): Promise<void> {
    const res = await dayStore.removeTaskById(today, serverId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshTasksFromStore();
    await refreshTimelineAndRelated();
  }

  async function promoteFixedEventToRecurring(eventId: string): Promise<void> {
    const res = await dayStore.promoteFixedEventToRecurringTemplate(today, eventId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshEventsFromStore();
    await refreshTimelineAndRelated();
    await refreshTasksFromStore();
  }

  async function demoteRecurringTaskRow(dailyRecurringId: string): Promise<void> {
    const res = await dayStore.demoteRecurringTaskToOneOff(today, dailyRecurringId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshTasksFromStore();
    await refreshTimelineAndRelated();
  }

  async function demoteRecurringCalendarRow(dailyRecurringId: string): Promise<void> {
    const res = await dayStore.demoteRecurringCalendarToOneOff(today, dailyRecurringId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshEventsFromStore();
    await refreshTimelineAndRelated();
  }

  async function removeFixedEventRow(serverId: string): Promise<void> {
    const res = await dayStore.removeFixedEventById(today, serverId, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!res.ok || !res.result) return;
    setUnscheduledCount(res.result.unscheduledTasks.length);
    await refreshEventsFromStore();
    await refreshTimelineAndRelated();
  }

  async function removeCalendarBlock(block: Block): Promise<void> {
    if (block.sourceTaskId) {
      const res = await dayStore.removeTaskById(today, block.sourceTaskId, {
        dayStartTimeHhmm: dayStartTime,
        dayEndTimeHhmm: dayEndTime,
      });
      if (!res.ok || !res.result) return;
      setUnscheduledCount(res.result.unscheduledTasks.length);
      await refreshTasksFromStore();
      await refreshTimelineAndRelated();
      return;
    }
    if (block.sourceEventId) {
      const res = await dayStore.removeFixedEventById(today, block.sourceEventId, {
        dayStartTimeHhmm: dayStartTime,
        dayEndTimeHhmm: dayEndTime,
      });
      if (!res.ok || !res.result) return;
      setUnscheduledCount(res.result.unscheduledTasks.length);
      await refreshEventsFromStore();
      await refreshTimelineAndRelated();
      await refreshTasksFromStore();
      return;
    }
    if (block.sourceDailyRecurringId) {
      const row = recurring.find((r) => r.id === block.sourceDailyRecurringId);
      if (!row) return;
      await deleteRecurringTemplateForItem(row.recurringTemplateId, row.titleSnapshot);
    }
  }

  async function handleCalendarRepeatClick(block: Block): Promise<void> {
    if (block.blockType === "fixed_event" && block.sourceEventId) {
      await promoteFixedEventToRecurring(block.sourceEventId);
      return;
    }
    if (block.blockType === "focus" && block.sourceTaskId && !block.sourceDailyRecurringId) {
      await promoteAdhocTaskToRecurring(block.sourceTaskId);
      return;
    }
    if (block.sourceDailyRecurringId || block.blockType === "recurring_event") {
      const row = recurring.find((r) => r.id === block.sourceDailyRecurringId);
      if (!row) return;
      if (row.kind === "calendar_event") {
        await demoteRecurringCalendarRow(row.id);
      } else {
        await demoteRecurringTaskRow(row.id);
      }
    }
  }

  async function setTimelineTaskCompletion(serverId: string, completed: boolean): Promise<void> {
    const { ok } = await dayStore.setTaskCompletion(today, serverId, completed);
    if (!ok) return;
    await refreshTasksFromStore();
    const [timelineData, timerData] = await Promise.all([dayStore.getTimeline(today), dayStore.getTimerSession(today)]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setTimer(timerData.session);
  }

  async function adjustTimelineTaskPomodoros(serverId: string, delta: number): Promise<void> {
    const { ok } = await dayStore.adjustTaskEstimatedPomodoros(today, serverId, delta, {
      dayStartTimeHhmm: dayStartTime,
      dayEndTimeHhmm: dayEndTime,
    });
    if (!ok) return;
    const [timelineData, timerData] = await Promise.all([dayStore.getTimeline(today), dayStore.getTimerSession(today)]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setTimer(timerData.session);
    await refreshTasksFromStore();
  }

  async function commitRecurringPomodorosCount(
    item: RecurringItemTimed,
    count: number,
    regenerateTimeline: boolean,
  ): Promise<void> {
    const pomos = Math.min(MAX_POMODORO, Math.max(MIN_POMODORO, count));
    const startH = item.startTimeSnapshotHhmm ?? DEFAULT_RECURRING_START_TIME;
    const merged: RecurringItemTimed = {
      ...item,
      estimatedPomodoros: pomos,
      endTimeSnapshotHhmm: recurringTaskEndFromStart(startH, pomos),
    };
    setRecurring((current) => current.map((entry) => (entry.id === item.id ? merged : entry)));
    await dayStore.updateRecurring(today, [
      {
        id: merged.id,
        isCompleted: merged.isCompleted,
        titleSnapshot: merged.titleSnapshot,
        startTimeHhmm: merged.startTimeSnapshotHhmm ?? undefined,
        estimatedPomodoros: pomos,
      },
    ]);
    if (regenerateTimeline) {
      const planData = await dayStore.generatePlan(today, { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime });
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
    }
  }

  async function adjustRecurringPomodorosByDelta(
    item: RecurringItemTimed,
    delta: number,
    regenerateTimeline: boolean,
  ): Promise<void> {
    const current = clampRecurringPomosForUi(item.estimatedPomodoros);
    const next = Math.min(MAX_POMODORO, Math.max(MIN_POMODORO, current + delta));
    if (next === current) return;
    await commitRecurringPomodorosCount(item, next, regenerateTimeline);
  }

  async function setTimelineRecurringCompletion(dailyRecurringRowId: string, completed: boolean): Promise<void> {
    const { ok } = await dayStore.setRecurringCompletion(today, dailyRecurringRowId, completed);
    if (!ok) return;
    const [timelineData, recurringData, timerData] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getRecurring(today),
      dayStore.getTimerSession(today),
    ]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setRecurring(normalizeRecurring(recurringData.recurring));
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
    await refreshEventsFromStore();
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

  function calendarItemStyleResolved(item: CalendarItem): CSSProperties {
    const base = calendarItemStyle(item);
    if (
      calendarResize
      && calendarResize.blockId === item.block.id
      && (item.block.blockType === "fixed_event" || item.block.blockType === "recurring_event")
    ) {
      const gridHeightPx = (calendarBounds.totalMinutes / 60) * HOUR_HEIGHT_PX;
      const startMinute = minutesFromDayStart(item.block.startTimeIso) - calendarBounds.startHour * 60;
      const durationMinutes = Math.max(
        5,
        (new Date(calendarResize.previewEndIso).getTime() - new Date(item.block.startTimeIso).getTime()) / 60_000,
      );
      const y0 = (startMinute / calendarBounds.totalMinutes) * gridHeightPx;
      const y1 = ((startMinute + durationMinutes) / calendarBounds.totalMinutes) * gridHeightPx;
      const gap = CALENDAR_VERTICAL_GAP_PX;
      const topPx = y0 + gap / 2;
      const heightPx = Math.max(y1 - y0 - gap, 10);
      return {
        ...base,
        top: `${(topPx / gridHeightPx) * 100}%`,
        height: `${(heightPx / gridHeightPx) * 100}%`,
      };
    }
    if (calendarMoveDrag?.itemId === item.id && calendarMoveDrag.previewDeltaMinutes !== 0) {
      const gridHeightPx = (calendarBounds.totalMinutes / 60) * HOUR_HEIGHT_PX;
      const ty = (calendarMoveDrag.previewDeltaMinutes / calendarBounds.totalMinutes) * gridHeightPx;
      return { ...base, transform: `translateY(${ty}px)`, zIndex: 15, cursor: "grabbing" };
    }
    return base;
  }

  function handleCalendarGridPointerLeave(): void {
    if (emptySlotHoverTimerRef.current) {
      window.clearTimeout(emptySlotHoverTimerRef.current);
      emptySlotHoverTimerRef.current = null;
    }
    setEmptySlotPopover(null);
    pendingEmptySlotRef.current = null;
  }

  function handleCalendarGridPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    if (calendarMoveDrag || calendarResize) return;
    const grid = calendarGridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const rawMin = minutesOfDayFromGridY(y, rect.height, calendarBounds);
    const sliceStartMin = halfHourSliceStartMin(rawMin);
    const startHhmm = formatMinutesToHhmm(sliceStartMin);

    if (!isSliceFreeOfItems(sliceStartMin, calendarItems)) {
      if (emptySlotHoverTimerRef.current) {
        window.clearTimeout(emptySlotHoverTimerRef.current);
        emptySlotHoverTimerRef.current = null;
      }
      setEmptySlotPopover(null);
      pendingEmptySlotRef.current = null;
      return;
    }

    pendingEmptySlotRef.current = { sliceStartMin, startHhmm };
    if (emptySlotHoverTimerRef.current) {
      window.clearTimeout(emptySlotHoverTimerRef.current);
      emptySlotHoverTimerRef.current = null;
    }
    emptySlotHoverTimerRef.current = window.setTimeout(() => {
      const pending = pendingEmptySlotRef.current;
      if (pending) {
        setEmptySlotPopover({
          sliceStartMin: pending.sliceStartMin,
          startHhmm: pending.startHhmm,
        });
      }
      emptySlotHoverTimerRef.current = null;
    }, 70);
  }

  function clampResizeEndIso(startIso: string, candidateEndIso: string): string {
    const startH = timeInputFromIso(startIso);
    const opts = eventEndTimeOptions(startH);
    if (opts.length === 0) return candidateEndIso;
    const candMs = new Date(candidateEndIso).getTime();
    let best = opts[0]!;
    let bestDiff = Infinity;
    for (const o of opts) {
      const om = new Date(isoAtTodayTime(o)).getTime();
      const d = Math.abs(om - candMs);
      if (d < bestDiff) {
        bestDiff = d;
        best = o;
      }
    }
    return isoAtTodayTime(clampEventEndTime(startH, best));
  }

  async function refreshTimelineAndRelated(): Promise<void> {
    const [timelineData, recurringData, timerData] = await Promise.all([
      dayStore.getTimeline(today),
      dayStore.getRecurring(today),
      dayStore.getTimerSession(today),
    ]);
    setTimeline(sortByStartTime(timelineData.blocks));
    setRecurring(normalizeRecurring(recurringData.recurring));
    setTimer(timerData.session);
  }

  async function commitCalendarMove(item: CalendarItem, deltaMinutes: number): Promise<void> {
    if (deltaMinutes === 0) return;
    const block = item.block;
    const startMin = minutesFromDayStart(block.startTimeIso) + deltaMinutes;
    const startHhmm = snapMinutesToNearestSlot(startMin);
    const startTimeIso = isoAtTodayTime(startHhmm);

    if (item.kind === "focus-session") {
      const actualBreakEnd = item.breakBlock ? addMinutesIso(addMinutesIso(startTimeIso, 25), 5) : addMinutesIso(startTimeIso, 25);
      await dayStore.updateFocusSession(today, block.id, {
        label: block.label.trim(),
        startTimeIso,
        focusEndTimeIso: addMinutesIso(startTimeIso, 25),
        breakEndTimeIso: actualBreakEnd,
      });
    } else if (block.blockType === "fixed_event" || block.blockType === "recurring_event") {
      const durMs = blockEndMs(block) - blockStartMs(block);
      const endTimeIso = new Date(new Date(startTimeIso).getTime() + durMs).toISOString();
      await dayStore.updateTimelineEvent(today, block.id, {
        label: block.label.trim(),
        startTimeIso,
        endTimeIso,
      });
    }
    await refreshTasksFromStore();
    await refreshTimelineAndRelated();
    if (block.blockType === "fixed_event" || block.blockType === "recurring_event") {
      await refreshEventsFromStore();
    }
  }

  function beginCalendarBlockMove(event: React.PointerEvent, item: CalendarItem): void {
    if (editingTimelineBlockId) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const pointerId = event.pointerId;

    function onMove(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      const dy = ev.clientY - startY;
      const rect = calendarGridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const deltaMin = minuteDeltaFromDragDy(dy, rect.height, calendarBounds);
      const snapped = Math.round(deltaMin / 5) * 5;
      setCalendarMoveDrag({
        pointerId,
        itemId: item.id,
        startClientY: startY,
        previewDeltaMinutes: snapped,
      });
    }

    async function onUp(ev: PointerEvent): Promise<void> {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const rect = calendarGridRef.current?.getBoundingClientRect();
      const dy = ev.clientY - startY;
      const deltaMin = rect ? Math.round(minuteDeltaFromDragDy(dy, rect.height, calendarBounds) / 5) * 5 : 0;
      setCalendarMoveDrag(null);
      if (deltaMin !== 0) {
        await commitCalendarMove(item, deltaMin);
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setCalendarMoveDrag({
      pointerId,
      itemId: item.id,
      startClientY: startY,
      previewDeltaMinutes: 0,
    });
  }

  function beginCalendarEventResize(event: React.PointerEvent, block: Block): void {
    if (editingTimelineBlockId) return;
    if (block.blockType !== "fixed_event" && block.blockType !== "recurring_event") return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const pointerId = event.pointerId;
    const originEndIso = block.endTimeIso;

    function onMove(ev: PointerEvent): void {
      if (ev.pointerId !== pointerId) return;
      const dy = ev.clientY - startY;
      const rect = calendarGridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const deltaMin = minuteDeltaFromDragDy(dy, rect.height, calendarBounds);
      const candEnd = new Date(blockEndMs(block) + deltaMin * 60_000).toISOString();
      const snapped = clampResizeEndIso(block.startTimeIso, candEnd);
      setCalendarResize({
        pointerId,
        blockId: block.id,
        startClientY: startY,
        previewEndIso: snapped,
      });
    }

    async function onUp(ev: PointerEvent): Promise<void> {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const rect = calendarGridRef.current?.getBoundingClientRect();
      const dy = ev.clientY - startY;
      const deltaMin = rect ? minuteDeltaFromDragDy(dy, rect.height, calendarBounds) : 0;
      const candEnd = new Date(blockEndMs(block) + deltaMin * 60_000).toISOString();
      const finalEnd = clampResizeEndIso(block.startTimeIso, candEnd);
      setCalendarResize(null);
      const durMin =
        (new Date(finalEnd).getTime() - new Date(block.startTimeIso).getTime()) / 60_000;
      if (durMin >= MIN_EVENT_DURATION_MIN && durMin <= MAX_EVENT_DURATION_MIN && finalEnd !== originEndIso) {
        await dayStore.updateTimelineEvent(today, block.id, {
          label: block.label.trim(),
          startTimeIso: block.startTimeIso,
          endTimeIso: finalEnd,
        });
        await refreshEventsFromStore();
        await refreshTimelineAndRelated();
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    setCalendarResize({
      pointerId,
      blockId: block.id,
      startClientY: startY,
      previewEndIso: originEndIso,
    });
  }

  async function submitCalendarSlotEvent(): Promise<void> {
    if (!slotAddEventOpen?.title.trim()) return;
    const { title, startHhmm, endHhmm } = slotAddEventOpen;
    const safeEnd = clampEventEndTime(startHhmm, endHhmm);
    const result = await dayStore.appendFixedEventAndGeneratePlan(
      today,
      {
        title: title.trim(),
        startTimeIso: `${today}T${startHhmm}:00`,
        endTimeIso: `${today}T${safeEnd}:00`,
      },
      { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime },
    );
    if (result.ok && result.result) {
      setUnscheduledCount(result.result.unscheduledTasks.length);
    }
    setSlotAddEventOpen(null);
    setEmptySlotPopover(null);
    await refreshEventsFromStore();
    await refreshTimelineAndRelated();
  }

  async function submitCalendarSlotTask(): Promise<void> {
    if (!slotAddTaskOpen?.title.trim()) return;
    const { title, startHhmm, estimatedPomodoros } = slotAddTaskOpen;
    const res = await dayStore.appendTaskWithPreferredStart(
      today,
      { title: title.trim(), estimatedPomodoros },
      startHhmm,
      { dayStartTimeHhmm: dayStartTime, dayEndTimeHhmm: dayEndTime },
    );
    if (res.ok && res.result) {
      setUnscheduledCount(res.result.unscheduledTasks.length);
    }
    setSlotAddTaskOpen(null);
    setEmptySlotPopover(null);
    await refreshTasksFromStore();
    await refreshTimelineAndRelated();
  }

  if (loading) {
    return <main className="app"><p>Loading today&apos;s plan...</p></main>;
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Pomodoro Daily Planner</p>
          <h1>{dateParts.dateText}</h1>
        </div>
        <div className="weekday-badge">{dateParts.weekday}</div>
      </header>

      <section className="execution">
          <div className="timeline panel">
            <div className="section-heading timeline-options-banner" aria-labelledby="timeline-options-heading">
              <h2 id="timeline-options-heading" className="timeline-options-title">Options</h2>
              <div className="timeline-options-toolbar">
                <div className="day-boundary-fields day-boundary-fields--toolbar">
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
                <div className="section-actions timeline-options-actions">
                  <button type="button" onClick={() => void resetDay()}>
                    <RotateCcw size={18} aria-hidden="true" />
                    <span>Reset Day</span>
                  </button>
                  <button type="button" onClick={() => void clearDay()}>
                    <Trash2 size={18} aria-hidden="true" />
                    <span>Clear Day</span>
                  </button>
                </div>
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
              <div
                ref={calendarGridRef}
                className="calendar-grid"
                onPointerMove={handleCalendarGridPointerMove}
                onPointerLeave={handleCalendarGridPointerLeave}
              >
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
                {emptySlotPopover && emptySlotBandMetrics && emptySlotBandMetrics.heightPct > 0 && (
                  <div
                    key={emptySlotPopover.sliceStartMin}
                    className="calendar-empty-slot-actions"
                    style={{
                      position: "absolute",
                      left: "0.75rem",
                      top: `${emptySlotBandMetrics.topPct}%`,
                      height: `${emptySlotBandMetrics.heightPct}%`,
                      width: "min(18rem, calc(100% - 1.5rem))",
                      zIndex: 6,
                    }}
                  >
                    <button
                      type="button"
                      className="calendar-slot-action-btn"
                      onClick={() => {
                        if (emptySlotHoverTimerRef.current) {
                          window.clearTimeout(emptySlotHoverTimerRef.current);
                          emptySlotHoverTimerRef.current = null;
                        }
                        const start = emptySlotPopover.startHhmm;
                        const rawEnd = formatMinutesToHhmm(parseHhmmToMinutes(start) + MIN_EVENT_DURATION_MIN);
                        setEmptySlotPopover(null);
                        setSlotAddEventOpen({
                          title: "",
                          startHhmm: start,
                          endHhmm: clampEventEndTime(start, rawEnd),
                        });
                      }}
                    >
                      Add event
                    </button>
                    <button
                      type="button"
                      className="calendar-slot-action-btn"
                      onClick={() => {
                        if (emptySlotHoverTimerRef.current) {
                          window.clearTimeout(emptySlotHoverTimerRef.current);
                          emptySlotHoverTimerRef.current = null;
                        }
                        setEmptySlotPopover(null);
                        setSlotAddTaskOpen({
                          title: "",
                          startHhmm: emptySlotPopover.startHhmm,
                          estimatedPomodoros: 1,
                        });
                      }}
                    >
                      Add task
                    </button>
                  </div>
                )}
                {calendarItems.map((item) => {
                  const block = item.block;
                  const isActive = timer?.activeBlockId === block.id || timer?.activeBlockId === item.breakBlock?.id;
                  const showResize =
                    (block.blockType === "fixed_event" || block.blockType === "recurring_event")
                    && editingTimelineBlockId !== block.id;
                  const isRecurringBlock = Boolean(block.sourceDailyRecurringId) || block.blockType === "recurring_event";
                  const repeatActive = isRecurringBlock;
                  const itemClassName = `${blockClass(block)}${item.kind === "focus-session" ? " calendar-block-session" : ""}${
                    isActive ? " active" : ""
                  }${editingTimelineBlockId === block.id ? " editing" : ""}${showResize ? " calendar-block-resizable" : ""}${
                    isRecurringBlock ? " calendar-block-is-recurring" : ""
                  }`;

                  return (
                    <div key={item.id} className={itemClassName} style={calendarItemStyleResolved(item)}>
                      <div
                        className={`calendar-block-main${editingTimelineBlockId === block.id ? "" : " calendar-block-drag-zone"}`}
                        onPointerDown={
                          editingTimelineBlockId === block.id
                            ? undefined
                            : (e) => beginCalendarBlockMove(e, item)
                        }
                        role="presentation"
                      >
                        <div className="calendar-block-header">
                          <div className="calendar-title-row">
                            <strong className={block.blockType === "focus" ? "calendar-block-time-range" : undefined}>
                              {block.blockType === "focus" && (
                                <Apple className="calendar-time-apple" size={14} strokeWidth={2} aria-hidden="true" />
                              )}
                              <span>{formatTime(block.startTimeIso)} - {formatTime(block.endTimeIso)}</span>
                            </strong>
                            {editingTimelineBlockId !== block.id && <span>{block.label}</span>}
                          </div>
                          <div className="calendar-actions">
                            {item.breakBlock && (
                              <div className="calendar-break-segment calendar-break-segment-inline">
                                <span>{formatTime(item.breakBlock.startTimeIso)}</span>
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => void playBlock(item.breakBlock.id)}
                                  disabled={item.breakBlock.status === "completed"}
                                  aria-label="Play break"
                                  title="Play break"
                                >
                                  <Coffee size={16} aria-hidden="true" />
                                </button>
                              </div>
                            )}
                            {!isNonPomodoroTimelineBlock(block) && (
                              <>
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => void playBlock(block.id)}
                                  disabled={block.status === "completed"}
                                  aria-label={`Play ${block.label}`}
                                  title="Play"
                                >
                                  <Play size={16} aria-hidden="true" />
                                </button>
                                {block.status === "completed" ? (
                                  <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => void revertBlockFromCalendar(block.id)}
                                    aria-label={`Undo complete ${block.label}`}
                                    title="Undo"
                                  >
                                    <RotateCcw size={16} aria-hidden="true" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => void completeBlock(block.id)}
                                    aria-label={`Complete ${block.label}`}
                                    title="Completed"
                                  >
                                    <Check size={16} aria-hidden="true" />
                                  </button>
                                )}
                              </>
                            )}
                            {block.blockType !== "break" && editingTimelineBlockId !== block.id && (
                              <>
                                {(block.blockType === "focus" || block.blockType === "fixed_event" || block.blockType === "recurring_event") && (
                                  <>
                                    <button
                                      type="button"
                                      className={repeatActive ? "calendar-icon-btn calendar-repeat-on" : "calendar-icon-btn"}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={() => void handleCalendarRepeatClick(block)}
                                      aria-label="Recurring"
                                      title="Mark as recurring for future days, or turn off if already recurring"
                                      aria-pressed={repeatActive}
                                    >
                                      <Repeat size={16} aria-hidden="true" />
                                    </button>
                                    <button
                                      type="button"
                                      className="calendar-icon-btn"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={() => void removeCalendarBlock(block)}
                                      aria-label="Remove from calendar"
                                      title="Remove from calendar"
                                    >
                                      <Trash2 size={16} aria-hidden="true" />
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={() => beginTimelineEdit(block)}
                                  aria-label={`Edit ${block.label}`}
                                  title="Edit"
                                >
                                  <Pencil size={16} aria-hidden="true" />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {block.blockType !== "break" && editingTimelineBlockId === block.id && (
                          <div
                            className="calendar-edit-row"
                            onPointerDown={(e) => e.stopPropagation()}
                          >
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
                            {(block.blockType === "fixed_event" || block.blockType === "recurring_event") && (
                              <input
                                type="time"
                                value={timelineEditDraft.endTime}
                                onChange={(event) => setTimelineEditDraft((current) => ({ ...current, endTime: event.target.value }))}
                                aria-label="Timeline end time"
                              />
                            )}
                            <button type="button" onClick={() => void saveTimelineEdit(block)} aria-label="Save timeline label">
                              <Check size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
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
                      {showResize && (
                        <div
                          className="calendar-event-resize-handle"
                          onPointerDown={(e) => beginCalendarEventResize(e, block)}
                          role="separator"
                          aria-orientation="horizontal"
                          aria-label={`Resize ${block.label}`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {slotAddEventOpen && (
            <div
              className="calendar-slot-modal-overlay"
              role="presentation"
              onClick={() => setSlotAddEventOpen(null)}
            >
              <div
                className="calendar-slot-modal panel"
                role="dialog"
                aria-modal="true"
                aria-label="Add calendar event"
                onClick={(e) => e.stopPropagation()}
              >
                <h4>New event</h4>
                <label className="calendar-slot-modal-field">
                  <span>Title</span>
                  <input
                    value={slotAddEventOpen.title}
                    onChange={(e) =>
                      setSlotAddEventOpen((current) => (current ? { ...current, title: e.target.value } : current))
                    }
                    placeholder="Meeting title"
                    autoFocus
                  />
                </label>
                <div className="calendar-slot-modal-times">
                  <label>
                    <span>Start</span>
                    <select
                      value={slotAddEventOpen.startHhmm}
                      onChange={(e) => {
                        const startHhmm = e.target.value;
                        setSlotAddEventOpen((current) =>
                          current
                            ? {
                                ...current,
                                startHhmm,
                                endHhmm: clampEventEndTime(startHhmm, current.endHhmm),
                              }
                            : current,
                        );
                      }}
                      aria-label="Event start"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>{formatSelectTime(time)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>End</span>
                    <select
                      value={
                        eventEndTimeOptions(slotAddEventOpen.startHhmm).includes(slotAddEventOpen.endHhmm)
                          ? slotAddEventOpen.endHhmm
                          : clampEventEndTime(slotAddEventOpen.startHhmm, slotAddEventOpen.endHhmm)
                      }
                      onChange={(e) =>
                        setSlotAddEventOpen((current) =>
                          current
                            ? {
                                ...current,
                                endHhmm: clampEventEndTime(current.startHhmm, e.target.value),
                              }
                            : current,
                        )
                      }
                      aria-label="Event end"
                    >
                      {eventEndTimeOptions(slotAddEventOpen.startHhmm).map((time) => (
                        <option key={time} value={time}>{formatEndOptionLabel(slotAddEventOpen.startHhmm, time)}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="calendar-slot-modal-actions">
                  <button type="button" className="calendar-slot-modal-cancel" onClick={() => setSlotAddEventOpen(null)}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void submitCalendarSlotEvent()}>
                    Save event
                  </button>
                </div>
              </div>
            </div>
          )}

          {slotAddTaskOpen && (
            <div
              className="calendar-slot-modal-overlay"
              role="presentation"
              onClick={() => setSlotAddTaskOpen(null)}
            >
              <div
                className="calendar-slot-modal panel"
                role="dialog"
                aria-modal="true"
                aria-label="Add task"
                onClick={(e) => e.stopPropagation()}
              >
                <h4>New task</h4>
                <label className="calendar-slot-modal-field">
                  <span>Title</span>
                  <input
                    value={slotAddTaskOpen.title}
                    onChange={(e) =>
                      setSlotAddTaskOpen((current) => (current ? { ...current, title: e.target.value } : current))
                    }
                    placeholder="Task title"
                    autoFocus
                  />
                </label>
                <label className="calendar-slot-modal-field">
                  <span>Pomodoros</span>
                  <select
                    value={slotAddTaskOpen.estimatedPomodoros}
                    onChange={(e) =>
                      setSlotAddTaskOpen((current) =>
                        current ? { ...current, estimatedPomodoros: Number(e.target.value) } : current,
                      )
                    }
                    aria-label="Estimated pomodoros"
                  >
                    {POMODORO_OPTIONS.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
                <p className="muted">Starts near {formatSelectTime(slotAddTaskOpen.startHhmm)} (planner will snap to a free slot when needed).</p>
                <div className="calendar-slot-modal-actions">
                  <button type="button" className="calendar-slot-modal-cancel" onClick={() => setSlotAddTaskOpen(null)}>
                    Cancel
                  </button>
                  <button type="button" onClick={() => void submitCalendarSlotTask()}>
                    Add task
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="timeline-timer-column">
            <div className="timeline-timer-sticky">
              <TimerCard
                title={(
                  <span className="timer-card-title-with-icon">
                    <Apple size={20} aria-hidden="true" />
                    Pomodoro Timer
                  </span>
                )}
                variant={pomodoroTimerVariant}
                labelText={pomodoroTimerLabel}
                timeText={formatTimer(remainingSeconds)}
                progressPercent={timerProgressPercent}
                progressDanger={timerAlmostDone}
                stateText={`State: ${timer?.state ?? "idle"}`}
                helperText="Break jumps to the next break. Skip moves to the next task (focus). Reset clears elapsed time for this block."
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
                      onClick={() => void resetPomodoroTimer()}
                      disabled={!timer || !timer.activeBlockId}
                      aria-label="Reset pomodoro timer"
                      title="Reset"
                    >
                      <RotateCcw size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void goToNextBreak()}
                      disabled={!timer}
                      aria-label="Go to next break"
                      title="Next break"
                    >
                      <Coffee size={18} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void skipToNextFocus()}
                      disabled={!timer || !timer.activeBlockId}
                      aria-label="Skip to next task"
                      title="Skip to next task"
                    >
                      <SkipForward size={18} aria-hidden="true" />
                    </button>
                  </>
                )}
              />
              <div className="panel timeline-task-list">
                <h4>Today&apos;s Tasks</h4>
                <ul className="timeline-task-list-items">
                  {tasks
                    .filter((task) => task.serverId)
                    .map((task) => {
                      const pomos = task.estimatedPomodoros ?? 1;
                      return (
                        <li key={task.serverId} className="timeline-task-list-row">
                          <div className="timeline-task-list-main">
                            <span className={task.status === "completed" ? "timeline-task-title is-completed" : "timeline-task-title"}>
                              {task.title}
                            </span>
                            <div className="timeline-task-pomodoro-row">
                              <button
                                type="button"
                                disabled={pomos >= MAX_POMODORO}
                                onClick={() => void adjustTimelineTaskPomodoros(task.serverId as string, 1)}
                                aria-label="Add pomodoro"
                                title="Add pomodoro"
                              >
                                <Plus size={14} aria-hidden="true" />
                                <Apple size={14} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                disabled={pomos <= MIN_POMODORO}
                                onClick={() => void adjustTimelineTaskPomodoros(task.serverId as string, -1)}
                                aria-label="Remove pomodoro"
                                title="Remove pomodoro"
                              >
                                <Minus size={14} aria-hidden="true" />
                                <Apple size={14} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                          <div className="timeline-task-row-icons">
                            <button
                              type="button"
                              className="timeline-row-icon-btn"
                              onClick={() => void promoteAdhocTaskToRecurring(task.serverId as string)}
                              aria-label="Make recurring"
                              title="Make recurring"
                            >
                              <Repeat size={16} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="timeline-row-icon-btn"
                              onClick={() => void removeAdhocTask(task.serverId as string)}
                              aria-label="Remove task"
                              title="Remove task"
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
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
                      );
                    })}
                  {recurringTaskRows.map((item) => {
                    const pomos = clampRecurringPomosForUi(item.estimatedPomodoros);
                    return (
                    <li key={`recurring-${item.id}`} className="timeline-task-list-row is-recurring">
                      <div className="timeline-task-list-main">
                        <span
                          className={
                            item.isCompleted
                              ? "timeline-task-title is-completed is-recurring"
                              : "timeline-task-title is-recurring"
                          }
                        >
                          {item.titleSnapshot}
                        </span>
                        <div className="timeline-task-pomodoro-row">
                          <button
                            type="button"
                            disabled={pomos >= MAX_POMODORO}
                            onClick={() => void adjustRecurringPomodorosByDelta(item, 1, true)}
                            aria-label="Add pomodoro"
                            title="Add pomodoro"
                          >
                            <Plus size={14} aria-hidden="true" />
                            <Apple size={14} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            disabled={pomos <= MIN_POMODORO}
                            onClick={() => void adjustRecurringPomodorosByDelta(item, -1, true)}
                            aria-label="Remove pomodoro"
                            title="Remove pomodoro"
                          >
                            <Minus size={14} aria-hidden="true" />
                            <Apple size={14} aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="timeline-task-row-icons">
                        <button
                          type="button"
                          className="timeline-row-icon-btn timeline-row-repeat-on"
                          onClick={() => void demoteRecurringTaskRow(item.id)}
                          aria-label="Stop repeating (keep as a one-off task today)"
                          title="Stop repeating (keeps as a one-off for today)"
                          aria-pressed="true"
                        >
                          <Repeat size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="timeline-row-icon-btn"
                          onClick={() => void deleteRecurringTemplateForItem(item.recurringTemplateId, item.titleSnapshot)}
                          aria-label="Remove recurring task"
                          title="Remove recurring task"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="timeline-task-actions">
                        {!item.isCompleted ? (
                          <button
                            type="button"
                            className="timeline-task-complete"
                            onClick={() => void setTimelineRecurringCompletion(item.id, true)}
                          >
                            Complete
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="timeline-task-undo"
                            onClick={() => void setTimelineRecurringCompletion(item.id, false)}
                          >
                            Undo
                          </button>
                        )}
                      </div>
                    </li>
                    );
                  })}
                </ul>
                <h4>Calendar events</h4>
                <ul className="timeline-task-list-items">
                  {events
                    .filter((ev) => ev.serverId)
                    .map((ev) => (
                      <li key={ev.serverId} className="timeline-task-list-row timeline-event-row">
                        <div className="timeline-task-list-main">
                          <span className="timeline-task-title">{ev.title}</span>
                          <span className="timeline-event-time">
                            {formatSelectTime(ev.startTime)}–{formatSelectTime(ev.endTime)}
                          </span>
                        </div>
                        <div className="timeline-task-row-icons">
                          <button
                            type="button"
                            className="timeline-row-icon-btn"
                            onClick={() => void promoteFixedEventToRecurring(ev.serverId as string)}
                            aria-label="Make recurring"
                            title="Make recurring"
                          >
                            <Repeat size={16} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="timeline-row-icon-btn"
                            onClick={() => void removeFixedEventRow(ev.serverId as string)}
                            aria-label="Remove event from calendar"
                            title="Remove from calendar"
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                        <div className="timeline-task-actions" aria-hidden="true" />
                      </li>
                    ))}
                  {recurringCalendarRows.map((item) => (
                    <li key={`cal-rec-${item.id}`} className="timeline-task-list-row is-recurring timeline-event-row">
                      <div className="timeline-task-list-main">
                        <span
                          className={
                            item.isCompleted
                              ? "timeline-task-title is-completed is-recurring"
                              : "timeline-task-title is-recurring"
                          }
                        >
                          {item.titleSnapshot}
                        </span>
                        <span className="timeline-event-time">
                          {formatSelectTime(item.startTimeSnapshotHhmm ?? DEFAULT_RECURRING_CALENDAR_START_TIME)}
                          –
                          {formatSelectTime(item.endTimeSnapshotHhmm ?? DEFAULT_RECURRING_CALENDAR_END_TIME)}
                        </span>
                      </div>
                      <div className="timeline-task-row-icons">
                        <button
                          type="button"
                          className="timeline-row-icon-btn timeline-row-repeat-on"
                          onClick={() => void demoteRecurringCalendarRow(item.id)}
                          aria-label="Stop repeating"
                          title="Stop repeating (keeps as a one-off event today)"
                          aria-pressed="true"
                        >
                          <Repeat size={16} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="timeline-row-icon-btn"
                          onClick={() => void deleteRecurringTemplateForItem(item.recurringTemplateId, item.titleSnapshot)}
                          aria-label="Remove recurring event"
                          title="Remove recurring event"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                      <div className="timeline-task-actions">
                        {!item.isCompleted ? (
                          <button
                            type="button"
                            className="timeline-task-complete"
                            onClick={() => void setTimelineRecurringCompletion(item.id, true)}
                          >
                            Complete
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="timeline-task-undo"
                            onClick={() => void setTimelineRecurringCompletion(item.id, false)}
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
          </div>
        </section>
    </main>
  );
}

export default App;
