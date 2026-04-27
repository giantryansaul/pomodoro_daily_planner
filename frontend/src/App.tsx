import { Check, Coffee, Minus, Pause, Pencil, Play, Plus, RotateCcw, Save, SkipForward, X } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

type AppMode = "editing" | "timeline";
type TaskInput = { clientId: string; title: string; estimatedPomodoros?: number };
type RecurringItem = { id: string; titleSnapshot: string; isCompleted: boolean };
type EventInput = { clientId: string; title: string; startTime: string; endTime: string };
type Block = {
  id: string;
  blockType: "focus" | "break" | "fixed_event";
  sourceTaskId: string | null;
  sourceEventId: string | null;
  label: string;
  startTimeIso: string;
  endTimeIso: string;
  status: "planned" | "completed" | "skipped";
};
type TimerSession = {
  id: string;
  activeBlockId: string | null;
  state: "idle" | "running" | "paused" | "completed";
  elapsedSeconds: number;
};
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

const API = "http://localhost:3001/api";
const today = new Date().toISOString().slice(0, 10);
const PLANNING_TIMER_SECONDS = 10 * 60;
const CALENDAR_START_HOUR = 7;
const CALENDAR_END_HOUR = 19;
const HOUR_HEIGHT_PX = 96;
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
  const blockTypeClass = block.blockType === "fixed_event" ? "calendar-block-event" : `calendar-block-${block.blockType}`;
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
  const eventLaneMap = assignMeetingLanes(blocks.filter((block) => block.blockType === "fixed_event"));
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
    if (block.blockType === "fixed_event") {
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

function App() {
  const [mode, setMode] = useState<AppMode>("editing");
  const [planningSecondsLeft, setPlanningSecondsLeft] = useState(PLANNING_TIMER_SECONDS);
  const [planningTimerRunning, setPlanningTimerRunning] = useState(false);
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [eventDraft, setEventDraft] = useState<EventInput>({
    clientId: newClientId(),
    title: "",
    startTime: "09:00",
    endTime: "09:30",
  });
  const [timeline, setTimeline] = useState<Block[]>([]);
  const [timer, setTimer] = useState<TimerSession | null>(null);
  const [editingTimelineBlockId, setEditingTimelineBlockId] = useState<string | null>(null);
  const [timelineEditDraft, setTimelineEditDraft] = useState<TimelineEditDraft>({ label: "", startTime: "", endTime: "" });
  const [unscheduledCount, setUnscheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);

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
  const displayedBlockDurationSeconds = durationInSeconds(displayedBlock);
  const displayedElapsedSeconds = activeBlock ? (timer?.elapsedSeconds ?? 0) : 0;
  const remainingSeconds = Math.max(displayedBlockDurationSeconds - displayedElapsedSeconds, 0);
  const timerProgressPercent =
    displayedBlockDurationSeconds > 0 ? Math.min((displayedElapsedSeconds / displayedBlockDurationSeconds) * 100, 100) : 0;
  const timerAlmostDone = displayedBlockDurationSeconds > 0 && remainingSeconds <= displayedBlockDurationSeconds * 0.2;
  const hasActiveBlock = Boolean(timer?.activeBlockId);
  const timerIsRunningWithBlock = timer?.state === "running" && hasActiveBlock;
  const dateParts = useMemo(() => formatDateParts(today), []);
  const calendarBounds = useMemo(() => {
    const blockStarts = orderedTimeline.map((block) => minutesFromDayStart(block.startTimeIso));
    const blockEnds = orderedTimeline.map((block) => minutesFromDayStart(block.endTimeIso));
    const startHour = Math.min(CALENDAR_START_HOUR, Math.floor(Math.min(...blockStarts, CALENDAR_START_HOUR * 60) / 60));
    const endHour = Math.max(CALENDAR_END_HOUR, Math.ceil(Math.max(...blockEnds, CALENDAR_END_HOUR * 60) / 60));
    return { startHour, endHour, totalMinutes: (endHour - startHour) * 60 };
  }, [orderedTimeline]);
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
    const [tasksRes, recurringRes, eventsRes, timelineRes, timerRes] = await Promise.all([
      fetch(`${API}/day/${today}/tasks`),
      fetch(`${API}/day/${today}/recurring`),
      fetch(`${API}/day/${today}/events`),
      fetch(`${API}/day/${today}/timeline`),
      fetch(`${API}/day/${today}/timer-session`),
    ]);

    const tasksData = await tasksRes.json();
    const recurringData = await recurringRes.json();
    const eventsData = await eventsRes.json();
    const timelineData = (await timelineRes.json()) as { blocks: Block[] };
    const timerData = await timerRes.json();

    setTasks(tasksData.tasks.map((task: { title: string; estimatedPomodoros: number | null }) => ({
      clientId: newClientId(),
      title: task.title,
      estimatedPomodoros: task.estimatedPomodoros ?? undefined,
    })));
    setRecurring(recurringData.recurring);
    setEvents(
      eventsData.events.map((event: { title: string; startTimeIso: string; endTimeIso: string }) => ({
        clientId: newClientId(),
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
      })),
    );
    const loadedTimeline = sortByStartTime(timelineData.blocks);
    setTimeline(loadedTimeline);
    setTimer(timerData.session);
    setMode(loadedTimeline.length > 0 ? "timeline" : "editing");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  async function saveDay(): Promise<void> {
    await fetch(`${API}/day/${today}/tasks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tasks: tasks.map(({ title, estimatedPomodoros }) => ({ title, estimatedPomodoros })),
      }),
    });

    await fetch(`${API}/day/${today}/recurring`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recurring: recurring.map((item) => ({ id: item.id, isCompleted: item.isCompleted })),
      }),
    });

    await fetch(`${API}/day/${today}/events`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: events.map((event) => ({
          title: event.title,
          startTimeIso: `${today}T${event.startTime}:00`,
          endTimeIso: `${today}T${event.endTime}:00`,
        })),
      }),
    });

    const planRes = await fetch(`${API}/day/${today}/generate-plan`, { method: "POST" });
    const planData = await planRes.json();
    setUnscheduledCount(planData.unscheduledTasks.length);
    const timelineRes = await fetch(`${API}/day/${today}/timeline`);
    const timelineData = (await timelineRes.json()) as { blocks: Block[] };
    const regeneratedTimeline = sortByStartTime(timelineData.blocks);
    setTimeline(regeneratedTimeline);
    setMode("timeline");
  }

  async function regenerateTimeline(): Promise<void> {
    const planRes = await fetch(`${API}/day/${today}/generate-plan`, { method: "POST" });
    const planData = await planRes.json();
    setUnscheduledCount(planData.unscheduledTasks.length);
    const timelineRes = await fetch(`${API}/day/${today}/timeline`);
    const timelineData = (await timelineRes.json()) as { blocks: Block[] };
    setTimeline(sortByStartTime(timelineData.blocks));
    setEditingTimelineBlockId(null);
  }

  async function persistTimer(next: TimerSession): Promise<void> {
    await fetch(`${API}/day/${today}/timer-session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: next }),
    });
  }

  async function startTimer(): Promise<void> {
    const firstBlock = orderedTimeline.find((block) => block.blockType !== "fixed_event" && block.status !== "completed");
    if (!firstBlock || !timer) return;
    const next = { ...timer, activeBlockId: firstBlock.id, state: "running" as const, elapsedSeconds: 0 };
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
    if (!timer) return;
    const nextState: TimerSession["state"] = timer.state === "paused" ? "running" : "paused";
    const next: TimerSession = { ...timer, state: nextState };
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
    await fetch(`${API}/day/${today}/timeline/${blockId}/complete`, { method: "POST" });
    setTimeline((current) => current.map((block) => (block.id === blockId ? { ...block, status: "completed" } : block)));
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
    if (block.blockType === "focus" && block.sourceTaskId) {
      const startTimeIso = isoAtTodayTime(timelineEditDraft.startTime);
      const focusEndTimeIso = addMinutesIso(startTimeIso, 25);
      const breakEndTimeIso = addMinutesIso(startTimeIso, 30);
      await fetch(`${API}/day/${today}/timeline/${block.id}/focus-session`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nextLabel, startTimeIso, focusEndTimeIso, breakEndTimeIso }),
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
            if (entry.sourceTaskId === block.sourceTaskId) {
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
      await fetch(`${API}/day/${today}/timeline/${block.id}/event`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: nextLabel, startTimeIso, endTimeIso }),
      });
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

  function updateEvent(clientId: string, updates: Partial<EventInput>): void {
    setEvents((current) => current.map((event) => (event.clientId === clientId ? { ...event, ...updates } : event)));
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
    const itemEndIso = item.breakBlock?.endTimeIso ?? item.block.endTimeIso;
    const startMinute = minutesFromDayStart(item.block.startTimeIso) - calendarBounds.startHour * 60;
    const durationMinutes = Math.max(5, (new Date(itemEndIso).getTime() - new Date(item.block.startTimeIso).getTime()) / 60_000);
    const baseStyle: CSSProperties = {
      top: `${(startMinute / calendarBounds.totalMinutes) * 100}%`,
      height: `${(durationMinutes / calendarBounds.totalMinutes) * 100}%`,
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
          <p className="eyebrow">Morning Planner</p>
          <h1>{dateParts.dateText}</h1>
        </div>
        <div className="weekday-badge">{dateParts.weekday}</div>
      </header>

      {mode === "editing" && (
        <section className="editing-layout">
          <div>
            <div className="section-heading">
              <div>
                <h2>Plan the Day</h2>
                <p>Add work, eliminate recurring items, and block calendar events before saving the timeline.</p>
              </div>
              <button disabled={tasks.length === 0} onClick={() => void saveDay()}>
                <Save size={18} aria-hidden="true" />
                <span>Save Day</span>
              </button>
            </div>

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
                <h3>Eliminate Recurring Tasks</h3>
                <ul className="editable-list">
                  {recurring.map((item) => (
                    <li key={item.id}>
                      <div className="item-row">
                        <span className={item.isCompleted ? "done" : ""}>{item.titleSnapshot}</span>
                        <button
                          onClick={() =>
                            setRecurring((current) =>
                              current.map((entry) =>
                                entry.id === item.id ? { ...entry, isCompleted: !entry.isCompleted } : entry,
                              ),
                            )
                          }
                        >
                          {item.isCompleted ? <RotateCcw size={18} aria-hidden="true" /> : <X size={18} aria-hidden="true" />}
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
                    onChange={(event) => setEventDraft((current) => ({ ...current, startTime: event.target.value }))}
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
                      <option key={time} value={time}>{formatSelectTime(time)}</option>
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
                          onChange={(event) => updateEvent(eventItem.clientId, { startTime: event.target.value })}
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
                            <option key={time} value={time}>{formatSelectTime(time)}</option>
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

          <div className="panel timer-card">
            <h3>Planning Timer</h3>
            <p className="timer-display">
              {Math.floor(planningSecondsLeft / 60)}:{String(planningSecondsLeft % 60).padStart(2, "0")}
            </p>
            <div className="row">
              <button onClick={togglePlanningTimer} aria-label={planningTimerRunning ? "Pause planning timer" : "Start planning timer"}>
                {planningTimerRunning ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
              </button>
              <button onClick={resetPlanningTimer} aria-label="Reset planning timer">
                <RotateCcw size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="muted">Use this 10-minute timer to time box your planning session.</p>
          </div>
        </section>
      )}

      {mode === "timeline" && (
        <section className="execution">
          <div className="timeline panel">
            <div className="section-heading">
              <h2>Timeline</h2>
              <button onClick={() => setMode("editing")}>
                <Pencil size={18} aria-hidden="true" />
                <span>Edit Timeline</span>
              </button>
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
                      {item.breakBlock && (
                        <div className="calendar-break-segment">
                          <span>{formatTime(item.breakBlock.startTimeIso)}</span>
                          <div className="calendar-actions">
                            <button
                              onClick={() => void playBlock(item.breakBlock.id)}
                              disabled={item.breakBlock.status === "completed"}
                              aria-label="Play break"
                              title="Play break"
                            >
                              <Coffee size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className={`active-timer panel active-timer-${displayedBlock?.blockType ?? "empty"}`}>
            <h3>Active timer</h3>
            <p className="active-label"><strong>{displayedBlock?.label ?? "No task ready"}</strong></p>
            <p className="active-time">{formatTimer(remainingSeconds)}</p>
            <div className="progress-track" aria-label="Timer progress">
              <div
                className={`progress-fill${timerAlmostDone ? " danger" : ""}`}
                style={{ width: `${timerProgressPercent}%` }}
              />
            </div>
            <p className="muted">State: {timer?.state ?? "idle"}</p>
            <div className="row">
              <button onClick={() => void startTimer()} disabled={!timer || timerIsRunningWithBlock} aria-label="Start timer">
                <Play size={18} aria-hidden="true" />
              </button>
              <button onClick={() => void togglePause()} disabled={!timer || timer.state === "idle" || timer.state === "completed"}>
                {timer?.state === "paused" ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
              </button>
              <button onClick={() => void skipBlock()} disabled={!timer || !timer.activeBlockId} aria-label="Skip block">
                <SkipForward size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
