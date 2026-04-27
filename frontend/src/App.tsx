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

const API = "http://localhost:3001/api";
const today = new Date().toISOString().slice(0, 10);
const PLANNING_TIMER_SECONDS = 10 * 60;

function newClientId(): string {
  return crypto.randomUUID();
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function sortByStartTime<T extends { startTimeIso: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => new Date(a.startTimeIso).getTime() - new Date(b.startTimeIso).getTime());
}

function durationInSeconds(block?: Block): number {
  if (!block) return 0;
  return Math.max(0, Math.floor((new Date(block.endTimeIso).getTime() - new Date(block.startTimeIso).getTime()) / 1000));
}

function App() {
  const [mode, setMode] = useState<AppMode>("editing");
  const [planningSecondsLeft, setPlanningSecondsLeft] = useState(PLANNING_TIMER_SECONDS);
  const [planningTimerRunning, setPlanningTimerRunning] = useState(false);
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
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
  const [timelineLabelDraft, setTimelineLabelDraft] = useState("");
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
  const remainingSeconds = Math.max(durationInSeconds(displayedBlock) - (activeBlock ? (timer?.elapsedSeconds ?? 0) : 0), 0);
  const hasActiveBlock = Boolean(timer?.activeBlockId);
  const timerIsRunningWithBlock = timer?.state === "running" && hasActiveBlock;

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
    setTimelineLabelDraft(block.label);
  }

  async function saveTimelineEdit(block: Block): Promise<void> {
    const nextLabel = timelineLabelDraft.trim();
    if (!nextLabel) return;
    if (block.blockType === "focus" && block.sourceTaskId) {
      await fetch(`${API}/day/${today}/tasks/${block.sourceTaskId}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextLabel }),
      });
      setTimeline((current) =>
        current.map((entry) => (entry.sourceTaskId === block.sourceTaskId ? { ...entry, label: nextLabel } : entry)),
      );
    } else if (block.blockType === "fixed_event" && block.sourceEventId) {
      await fetch(`${API}/day/${today}/events/${block.sourceEventId}/title`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextLabel }),
      });
      setTimeline((current) => current.map((entry) => (entry.id === block.id ? { ...entry, label: nextLabel } : entry)));
    }
    setEditingTimelineBlockId(null);
    setTimelineLabelDraft("");
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
    if (editingTaskId === clientId) {
      setEditingTaskId(null);
    }
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

  if (loading) {
    return <main className="app"><p>Loading today&apos;s plan...</p></main>;
  }

  return (
    <main className="app">
      <header>
        <h1>Morning Planner</h1>
        <p>{today}</p>
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
                Save Day
              </button>
            </div>

            <div className="edit-panels">
              <div className="panel">
                <h3>Add Tasks</h3>
                <div className="row">
                  <input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="Important task" />
                  <button onClick={addTask}>Add</button>
                </div>
                <ol className="editable-list">
                  {tasks.map((task) => (
                    <li key={task.clientId}>
                      {editingTaskId === task.clientId ? (
                        <div className="edit-row">
                          <input
                            value={task.title}
                            onChange={(event) => updateTask(task.clientId, { title: event.target.value })}
                            aria-label="Task title"
                          />
                          <input
                            type="number"
                            min="1"
                            value={task.estimatedPomodoros ?? 1}
                            onChange={(event) =>
                              updateTask(task.clientId, { estimatedPomodoros: Number(event.target.value) || 1 })
                            }
                            aria-label="Estimated Pomodoros"
                          />
                          <button onClick={() => setEditingTaskId(null)}>Save</button>
                        </div>
                      ) : (
                        <div className="item-row">
                          <span>{task.title}</span>
                          <span className="muted">{task.estimatedPomodoros ?? 1} pomodoro</span>
                          <button onClick={() => setEditingTaskId(task.clientId)}>Edit</button>
                          <button onClick={() => deleteTask(task.clientId)}>Remove</button>
                        </div>
                      )}
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
                          {item.isCompleted ? "Restore" : "Eliminate"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="panel">
                <h3>Add Calendar Events</h3>
                <div className="row">
                  <input
                    value={eventDraft.title}
                    onChange={(event) => setEventDraft((current) => ({ ...current, title: event.target.value }))}
                    placeholder="Meeting title"
                  />
                  <input
                    type="time"
                    value={eventDraft.startTime}
                    onChange={(event) => setEventDraft((current) => ({ ...current, startTime: event.target.value }))}
                  />
                  <input
                    type="time"
                    value={eventDraft.endTime}
                    onChange={(event) => setEventDraft((current) => ({ ...current, endTime: event.target.value }))}
                  />
                  <button onClick={addEvent}>Add</button>
                </div>
                <ul className="editable-list">
                  {events.map((eventItem) => (
                    <li key={eventItem.clientId}>
                      <div className="edit-row">
                        <input
                          value={eventItem.title}
                          onChange={(event) => updateEvent(eventItem.clientId, { title: event.target.value })}
                          aria-label="Event title"
                        />
                        <input
                          type="time"
                          value={eventItem.startTime}
                          onChange={(event) => updateEvent(eventItem.clientId, { startTime: event.target.value })}
                          aria-label="Event start"
                        />
                        <input
                          type="time"
                          value={eventItem.endTime}
                          onChange={(event) => updateEvent(eventItem.clientId, { endTime: event.target.value })}
                          aria-label="Event end"
                        />
                        <button onClick={() => deleteEvent(eventItem.clientId)}>Remove</button>
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
              <button onClick={togglePlanningTimer}>{planningTimerRunning ? "Pause" : "Start"}</button>
              <button onClick={resetPlanningTimer}>Reset</button>
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
              <button onClick={() => setMode("editing")}>Edit Timeline for Day</button>
            </div>
            {unscheduledCount > 0 && <p className="warning">{unscheduledCount} tasks could not be fully scheduled.</p>}
            <ul>
              {orderedTimeline.map((block) => (
                <li
                  key={block.id}
                  className={`${timer?.activeBlockId === block.id ? "active " : ""}${block.status === "completed" ? "completed" : ""}`.trim()}
                >
                  <div className="item-row">
                    <strong>{formatTime(block.startTimeIso)} - {formatTime(block.endTimeIso)}</strong>
                    {editingTimelineBlockId === block.id ? (
                      <>
                        <input
                          value={timelineLabelDraft}
                          onChange={(event) => setTimelineLabelDraft(event.target.value)}
                          aria-label="Timeline label"
                        />
                        <button onClick={() => void saveTimelineEdit(block)}>Save</button>
                      </>
                    ) : (
                      <span>{block.label} ({block.blockType})</span>
                    )}
                    <button
                      onClick={() => void playBlock(block.id)}
                      disabled={block.blockType === "fixed_event" || block.status === "completed"}
                    >
                      Play
                    </button>
                    <button
                      onClick={() => void completeBlock(block.id)}
                      disabled={block.blockType === "fixed_event" || block.status === "completed"}
                    >
                      Completed
                    </button>
                    {editingTimelineBlockId === block.id ? (
                      <button
                        onClick={() => {
                          setEditingTimelineBlockId(null);
                          setTimelineLabelDraft("");
                        }}
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        onClick={() => beginTimelineEdit(block)}
                        disabled={block.blockType === "break"}
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="active panel">
            <h3>Active timer</h3>
            <p><strong>{displayedBlock?.label ?? "No task ready"}</strong></p>
            <p>Remaining: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</p>
            <p>State: {timer?.state ?? "idle"}</p>
            <div className="row">
              <button onClick={() => void startTimer()} disabled={!timer || timerIsRunningWithBlock}>Start</button>
              <button onClick={() => void togglePause()} disabled={!timer || timer.state === "idle" || timer.state === "completed"}>
                {timer?.state === "paused" ? "Resume" : "Pause"}
              </button>
              <button onClick={() => void skipBlock()} disabled={!timer || !timer.activeBlockId}>Skip</button>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
