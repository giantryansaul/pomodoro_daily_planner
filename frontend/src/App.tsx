import { useCallback, useEffect, useMemo, useState } from "react";

type TaskInput = { title: string; estimatedPomodoros?: number };
type RecurringItem = { id: string; titleSnapshot: string; isCompleted: boolean };
type EventInput = { title: string; startTime: string; endTime: string };
type Block = {
  id: string;
  blockType: "focus" | "break" | "fixed_event";
  label: string;
  startTimeIso: string;
  endTimeIso: string;
};
type TimerSession = {
  id: string;
  activeBlockId: string | null;
  state: "idle" | "running" | "paused" | "completed";
  elapsedSeconds: number;
};

const API = "http://localhost:3001/api";
const today = new Date().toISOString().slice(0, 10);

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function durationInSeconds(block?: Block): number {
  if (!block) return 0;
  return Math.max(0, Math.floor((new Date(block.endTimeIso).getTime() - new Date(block.startTimeIso).getTime()) / 1000));
}

function App() {
  const [step, setStep] = useState(1);
  const [planningSecondsLeft, setPlanningSecondsLeft] = useState(10 * 60);
  const [tasks, setTasks] = useState<TaskInput[]>([]);
  const [taskDraft, setTaskDraft] = useState("");
  const [recurring, setRecurring] = useState<RecurringItem[]>([]);
  const [events, setEvents] = useState<EventInput[]>([]);
  const [eventDraft, setEventDraft] = useState<EventInput>({ title: "", startTime: "09:00", endTime: "09:30" });
  const [timeline, setTimeline] = useState<Block[]>([]);
  const [timer, setTimer] = useState<TimerSession | null>(null);
  const [unscheduledCount, setUnscheduledCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const activeBlock = useMemo(() => timeline.find((block) => block.id === timer?.activeBlockId), [timeline, timer?.activeBlockId]);
  const remainingSeconds = Math.max(durationInSeconds(activeBlock) - (timer?.elapsedSeconds ?? 0), 0);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPlanningSecondsLeft((current) => (current > 0 ? current - 1 : 0));
      setTimer((current) => {
        if (!current || current.state !== "running") return current;
        return { ...current, elapsedSeconds: current.elapsedSeconds + 1 };
      });
    }, 1000);
    return () => window.clearInterval(timerId);
  }, []);

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
    const timelineData = await timelineRes.json();
    const timerData = await timerRes.json();

    setTasks(tasksData.tasks.map((task: { title: string; estimatedPomodoros: number | null }) => ({
      title: task.title,
      estimatedPomodoros: task.estimatedPomodoros ?? undefined,
    })));
    setRecurring(recurringData.recurring);
    setEvents(
      eventsData.events.map((event: { title: string; startTimeIso: string; endTimeIso: string }) => ({
        title: event.title,
        startTime: event.startTimeIso.slice(11, 16),
        endTime: event.endTimeIso.slice(11, 16),
      })),
    );
    setTimeline(timelineData.blocks);
    setTimer(timerData.session);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDay();
  }, [loadDay]);

  async function saveTasksAndContinue(): Promise<void> {
    await fetch(`${API}/day/${today}/tasks`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks }),
    });
    setStep(2);
  }

  async function saveRecurringAndContinue(): Promise<void> {
    await fetch(`${API}/day/${today}/recurring`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recurring: recurring.map((item) => ({ id: item.id, isCompleted: item.isCompleted })),
      }),
    });
    setStep(3);
  }

  async function saveEventsAndGenerate(): Promise<void> {
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
    const timelineData = await timelineRes.json();
    setTimeline(timelineData.blocks);
    setStep(4);
  }

  async function persistTimer(next: TimerSession): Promise<void> {
    await fetch(`${API}/day/${today}/timer-session`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session: next }),
    });
  }

  async function startTimer(): Promise<void> {
    const firstBlock = timeline.find((block) => block.blockType !== "fixed_event");
    if (!firstBlock || !timer) return;
    const next = { ...timer, activeBlockId: firstBlock.id, state: "running" as const, elapsedSeconds: 0 };
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
    const currentIndex = timeline.findIndex((block) => block.id === timer.activeBlockId);
    const nextBlock = timeline.slice(currentIndex + 1).find((block) => block.blockType !== "fixed_event");
    const next = {
      ...timer,
      activeBlockId: nextBlock?.id ?? null,
      elapsedSeconds: 0,
      state: nextBlock ? ("running" as const) : ("completed" as const),
    };
    setTimer(next);
    await persistTimer(next);
  }

  function addTask(): void {
    const title = taskDraft.trim();
    if (!title) return;
    setTasks((current) => [...current, { title }]);
    setTaskDraft("");
  }

  function addEvent(): void {
    if (!eventDraft.title.trim()) return;
    setEvents((current) => [...current, eventDraft]);
    setEventDraft({ title: "", startTime: "09:00", endTime: "09:30" });
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

      <section className="wizard">
        <h2>Daily Planning Flow (Strict)</h2>
        <p>Step {step} of 4</p>

        {step === 1 && (
          <div className="panel">
            <h3>1) Prioritize tasks (10 minutes)</h3>
            <p>Time left: {Math.floor(planningSecondsLeft / 60)}:{String(planningSecondsLeft % 60).padStart(2, "0")}</p>
            <div className="row">
              <input value={taskDraft} onChange={(event) => setTaskDraft(event.target.value)} placeholder="Important task" />
              <button onClick={addTask}>Add</button>
            </div>
            <ol>{tasks.map((task, index) => <li key={`${task.title}-${index}`}>{task.title}</li>)}</ol>
            <button disabled={tasks.length === 0} onClick={() => void saveTasksAndContinue()}>Save and continue</button>
          </div>
        )}

        {step === 2 && (
          <div className="panel">
            <h3>2) Recurring checklist</h3>
            <ul>
              {recurring.map((item) => (
                <li key={item.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={item.isCompleted}
                      onChange={() =>
                        setRecurring((current) =>
                          current.map((entry) =>
                            entry.id === item.id ? { ...entry, isCompleted: !entry.isCompleted } : entry,
                          ),
                        )
                      }
                    />
                    <span className={item.isCompleted ? "done" : ""}>{item.titleSnapshot}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button onClick={() => void saveRecurringAndContinue()}>Save and continue</button>
          </div>
        )}

        {step === 3 && (
          <div className="panel">
            <h3>3) Fixed events</h3>
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
            <ul>{events.map((event, index) => <li key={`${event.title}-${index}`}>{event.startTime}-{event.endTime} {event.title}</li>)}</ul>
            <button onClick={() => void saveEventsAndGenerate()}>Generate schedule</button>
          </div>
        )}
      </section>

      {step === 4 && (
        <section className="execution">
          <div className="timeline panel">
            <h3>Timeline</h3>
            {unscheduledCount > 0 && <p className="warning">{unscheduledCount} tasks could not be fully scheduled.</p>}
            <ul>
              {timeline.map((block) => (
                <li key={block.id} className={timer?.activeBlockId === block.id ? "active" : ""}>
                  <strong>{formatTime(block.startTimeIso)} - {formatTime(block.endTimeIso)}</strong> {block.label} ({block.blockType})
                </li>
              ))}
            </ul>
          </div>

          <div className="active panel">
            <h3>Active timer</h3>
            <p><strong>{activeBlock?.label ?? "No active block"}</strong></p>
            <p>Remaining: {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, "0")}</p>
            <p>State: {timer?.state ?? "idle"}</p>
            <div className="row">
              <button onClick={() => void startTimer()} disabled={!timer || timer.state === "running"}>Start</button>
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
