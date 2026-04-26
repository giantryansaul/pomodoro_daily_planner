import cors from "cors";
import express from "express";
import { db, getDbPath, initDb, nowIso } from "./db.js";
import { generatePlan } from "./planner.js";
import type { DailyRecurringItem, FixedEvent, Task, TimerSession } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

initDb();

function getOrCreateDayPlan(dateIso: string): { id: string; dateIso: string } {
  const existing = db.prepare("SELECT id, date_iso as dateIso FROM day_plans WHERE date_iso = ?").get(dateIso) as
    | { id: string; dateIso: string }
    | undefined;
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = nowIso();
  db.prepare("INSERT INTO day_plans (id, date_iso, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, dateIso, now, now);
  materializeRecurringForDay(id);
  return { id, dateIso };
}

function materializeRecurringForDay(dayPlanId: string): void {
  const templates = db
    .prepare("SELECT id, title, sort_order FROM recurring_templates WHERE is_active = 1 ORDER BY sort_order ASC")
    .all() as Array<{ id: string; title: string; sort_order: number }>;
  const now = nowIso();
  const stmt = db.prepare(
    `INSERT INTO daily_recurring_items
    (id, day_plan_id, recurring_template_id, title_snapshot, sort_order, is_completed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    for (const template of templates) {
      stmt.run(
        crypto.randomUUID(),
        dayPlanId,
        template.id,
        template.title,
        template.sort_order,
        0,
        now,
        now,
      );
    }
  });
  tx();
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dbPath: getDbPath() });
});

app.get("/api/day/:date/tasks", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const tasks = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, title, notes, priority_rank as priorityRank,
       estimated_pomodoros as estimatedPomodoros, status
       FROM tasks WHERE day_plan_id = ? ORDER BY priority_rank ASC, created_at ASC`,
    )
    .all(dayPlan.id) as Task[];
  res.json({ dayPlanId: dayPlan.id, tasks });
});

app.put("/api/day/:date/tasks", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const incoming = Array.isArray(req.body.tasks) ? req.body.tasks : [];
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM tasks WHERE day_plan_id = ?").run(dayPlan.id);
    const stmt = db.prepare(
      `INSERT INTO tasks
      (id, day_plan_id, title, notes, priority_rank, estimated_pomodoros, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    incoming.forEach((task: { title: string; notes?: string; estimatedPomodoros?: number }, index: number) => {
      stmt.run(
        crypto.randomUUID(),
        dayPlan.id,
        task.title,
        task.notes ?? null,
        index + 1,
        task.estimatedPomodoros ?? null,
        "pending",
        now,
        now,
      );
    });
  });
  tx();
  res.json({ ok: true });
});

app.get("/api/day/:date/recurring", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const recurringRows = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, recurring_template_id as recurringTemplateId,
       title_snapshot as titleSnapshot, sort_order as sortOrder, is_completed as isCompleted
       FROM daily_recurring_items WHERE day_plan_id = ? ORDER BY sort_order ASC`,
    )
    .all(dayPlan.id) as Array<Omit<DailyRecurringItem, "isCompleted"> & { isCompleted: number }>;
  const recurring: DailyRecurringItem[] = recurringRows.map((item) => ({
    ...item,
    isCompleted: item.isCompleted === 1,
  }));
  res.json({ dayPlanId: dayPlan.id, recurring });
});

app.put("/api/day/:date/recurring", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const incoming = Array.isArray(req.body.recurring) ? req.body.recurring : [];
  const now = nowIso();
  const stmt = db.prepare(
    "UPDATE daily_recurring_items SET is_completed = ?, updated_at = ?, completed_at = ? WHERE id = ? AND day_plan_id = ?",
  );
  incoming.forEach((item: { id: string; isCompleted: boolean }) => {
    stmt.run(item.isCompleted ? 1 : 0, now, item.isCompleted ? now : null, item.id, dayPlan.id);
  });
  res.json({ ok: true });
});

app.get("/api/day/:date/events", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const events = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, title, start_time_iso as startTimeIso, end_time_iso as endTimeIso
       FROM fixed_events WHERE day_plan_id = ? ORDER BY start_time_iso ASC`,
    )
    .all(dayPlan.id) as FixedEvent[];
  res.json({ dayPlanId: dayPlan.id, events });
});

app.put("/api/day/:date/events", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const incoming = Array.isArray(req.body.events) ? req.body.events : [];
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM fixed_events WHERE day_plan_id = ?").run(dayPlan.id);
    const stmt = db.prepare(
      "INSERT INTO fixed_events (id, day_plan_id, title, start_time_iso, end_time_iso, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    incoming.forEach((event: { title: string; startTimeIso: string; endTimeIso: string }) => {
      stmt.run(crypto.randomUUID(), dayPlan.id, event.title, event.startTimeIso, event.endTimeIso, now, now);
    });
  });
  tx();
  res.json({ ok: true });
});

app.post("/api/day/:date/generate-plan", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const tasks = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, title, notes, priority_rank as priorityRank,
       estimated_pomodoros as estimatedPomodoros, status
       FROM tasks WHERE day_plan_id = ? ORDER BY priority_rank ASC, created_at ASC`,
    )
    .all(dayPlan.id) as Task[];
  const events = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, title, start_time_iso as startTimeIso, end_time_iso as endTimeIso
       FROM fixed_events WHERE day_plan_id = ? ORDER BY start_time_iso ASC`,
    )
    .all(dayPlan.id) as FixedEvent[];

  const plan = generatePlan(req.params.date, tasks, events, dayPlan.id);
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM schedule_blocks WHERE day_plan_id = ? AND status = 'planned'").run(dayPlan.id);
    const stmt = db.prepare(
      `INSERT INTO schedule_blocks
      (id, day_plan_id, source_task_id, block_type, label, start_time_iso, end_time_iso, sequence_index, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const block of plan.blocks) {
      stmt.run(
        block.id,
        block.dayPlanId,
        block.sourceTaskId,
        block.blockType,
        block.label,
        block.startTimeIso,
        block.endTimeIso,
        block.sequenceIndex,
        block.status,
        now,
        now,
      );
    }
  });
  tx();

  res.json({ ok: true, ...plan });
});

app.get("/api/day/:date/timeline", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const blocks = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, source_task_id as sourceTaskId, block_type as blockType,
       label, start_time_iso as startTimeIso, end_time_iso as endTimeIso, sequence_index as sequenceIndex,
       status
       FROM schedule_blocks WHERE day_plan_id = ?
       ORDER BY start_time_iso ASC`,
    )
    .all(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, blocks });
});

app.get("/api/day/:date/timer-session", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const existing = db
    .prepare(
      `SELECT id, day_plan_id as dayPlanId, active_block_id as activeBlockId, state,
       started_at as startedAt, paused_at as pausedAt, elapsed_seconds as elapsedSeconds
       FROM timer_sessions WHERE day_plan_id = ?`,
    )
    .get(dayPlan.id) as TimerSession | undefined;
  if (existing) {
    return res.json({ dayPlanId: dayPlan.id, session: existing });
  }
  const session: TimerSession = {
    id: crypto.randomUUID(),
    dayPlanId: dayPlan.id,
    activeBlockId: null,
    state: "idle",
    startedAt: null,
    pausedAt: null,
    elapsedSeconds: 0,
  };
  db.prepare(
    `INSERT INTO timer_sessions
    (id, day_plan_id, active_block_id, state, started_at, paused_at, elapsed_seconds, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(session.id, session.dayPlanId, session.activeBlockId, session.state, null, null, 0, nowIso());
  return res.json({ dayPlanId: dayPlan.id, session });
});

app.put("/api/day/:date/timer-session", (req, res) => {
  const dayPlan = getOrCreateDayPlan(req.params.date);
  const payload = req.body.session as Partial<TimerSession>;
  db.prepare(
    `INSERT INTO timer_sessions (id, day_plan_id, active_block_id, state, started_at, paused_at, elapsed_seconds, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(day_plan_id) DO UPDATE SET
       active_block_id = excluded.active_block_id,
       state = excluded.state,
       started_at = excluded.started_at,
       paused_at = excluded.paused_at,
       elapsed_seconds = excluded.elapsed_seconds,
       updated_at = excluded.updated_at`,
  ).run(
    payload.id ?? crypto.randomUUID(),
    dayPlan.id,
    payload.activeBlockId ?? null,
    payload.state ?? "idle",
    payload.startedAt ?? null,
    payload.pausedAt ?? null,
    payload.elapsedSeconds ?? 0,
    nowIso(),
  );
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Morning Planner API running on http://localhost:${port}`);
});
