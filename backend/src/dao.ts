import { db, nowIso } from "./db.js";
import type {
  DailyRecurringItem,
  EventInput,
  FixedEvent,
  RecurringCompletionUpdate,
  ScheduleBlock,
  Task,
  TaskInput,
  TimerSession,
} from "./types.js";

export const dayPlanDao = {
  getOrCreate(dateIso: string): { id: string; dateIso: string } {
    const existing = db
      .prepare("SELECT id, date_iso as dateIso FROM day_plans WHERE date_iso = ?")
      .get(dateIso) as { id: string; dateIso: string } | undefined;
    if (existing) return existing;

    const id = crypto.randomUUID();
    const now = nowIso();
    db.prepare("INSERT INTO day_plans (id, date_iso, created_at, updated_at) VALUES (?, ?, ?, ?)").run(
      id,
      dateIso,
      now,
      now,
    );
    dayPlanDao.materializeRecurring(id);
    return { id, dateIso };
  },

  materializeRecurring(dayPlanId: string): void {
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
        stmt.run(crypto.randomUUID(), dayPlanId, template.id, template.title, template.sort_order, 0, now, now);
      }
    });
    tx();
  },
};

export const taskDao = {
  listForDay(dayPlanId: string): Task[] {
    return db
      .prepare(
        `SELECT id, day_plan_id as dayPlanId, title, notes, priority_rank as priorityRank,
         estimated_pomodoros as estimatedPomodoros, status
         FROM tasks WHERE day_plan_id = ? ORDER BY priority_rank ASC, created_at ASC`,
      )
      .all(dayPlanId) as Task[];
  },

  replaceAll(dayPlanId: string, tasks: TaskInput[]): void {
    const now = nowIso();
    const stmt = db.prepare(
      `INSERT INTO tasks
      (id, day_plan_id, title, notes, priority_rank, estimated_pomodoros, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      db.prepare("UPDATE schedule_blocks SET source_task_id = NULL WHERE day_plan_id = ?").run(dayPlanId);
      db.prepare("DELETE FROM tasks WHERE day_plan_id = ?").run(dayPlanId);
      tasks.forEach((task, index) => {
        stmt.run(
          crypto.randomUUID(),
          dayPlanId,
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
  },
};

export const recurringDao = {
  listForDay(dayPlanId: string): DailyRecurringItem[] {
    const rows = db
      .prepare(
        `SELECT id, day_plan_id as dayPlanId, recurring_template_id as recurringTemplateId,
         title_snapshot as titleSnapshot, sort_order as sortOrder, is_completed as isCompleted
         FROM daily_recurring_items WHERE day_plan_id = ? ORDER BY sort_order ASC`,
      )
      .all(dayPlanId) as Array<Omit<DailyRecurringItem, "isCompleted"> & { isCompleted: number }>;
    return rows.map((row) => ({ ...row, isCompleted: row.isCompleted === 1 }));
  },

  updateCompletions(dayPlanId: string, updates: RecurringCompletionUpdate[]): void {
    const now = nowIso();
    const stmt = db.prepare(
      "UPDATE daily_recurring_items SET is_completed = ?, updated_at = ?, completed_at = ? WHERE id = ? AND day_plan_id = ?",
    );
    updates.forEach((item) => {
      stmt.run(item.isCompleted ? 1 : 0, now, item.isCompleted ? now : null, item.id, dayPlanId);
    });
  },
};

export const eventDao = {
  listForDay(dayPlanId: string): FixedEvent[] {
    return db
      .prepare(
        `SELECT id, day_plan_id as dayPlanId, title, start_time_iso as startTimeIso, end_time_iso as endTimeIso
         FROM fixed_events WHERE day_plan_id = ? ORDER BY start_time_iso ASC`,
      )
      .all(dayPlanId) as FixedEvent[];
  },

  replaceAll(dayPlanId: string, events: EventInput[]): void {
    const now = nowIso();
    const stmt = db.prepare(
      "INSERT INTO fixed_events (id, day_plan_id, title, start_time_iso, end_time_iso, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM fixed_events WHERE day_plan_id = ?").run(dayPlanId);
      events.forEach((event) => {
        stmt.run(crypto.randomUUID(), dayPlanId, event.title, event.startTimeIso, event.endTimeIso, now, now);
      });
    });
    tx();
  },
};

export const scheduleBlockDao = {
  listForDay(dayPlanId: string): ScheduleBlock[] {
    return db
      .prepare(
        `SELECT id, day_plan_id as dayPlanId, source_task_id as sourceTaskId, block_type as blockType,
         label, start_time_iso as startTimeIso, end_time_iso as endTimeIso, sequence_index as sequenceIndex,
         status
         FROM schedule_blocks WHERE day_plan_id = ? ORDER BY start_time_iso ASC`,
      )
      .all(dayPlanId) as ScheduleBlock[];
  },

  replacePlanned(dayPlanId: string, blocks: ScheduleBlock[]): void {
    const now = nowIso();
    const stmt = db.prepare(
      `INSERT INTO schedule_blocks
      (id, day_plan_id, source_task_id, block_type, label, start_time_iso, end_time_iso, sequence_index, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE timer_sessions SET active_block_id = NULL
         WHERE day_plan_id = ? AND active_block_id IN (
           SELECT id FROM schedule_blocks WHERE day_plan_id = ? AND status = 'planned'
         )`,
      ).run(dayPlanId, dayPlanId);
      db.prepare("DELETE FROM schedule_blocks WHERE day_plan_id = ? AND status = 'planned'").run(dayPlanId);
      blocks.forEach((block) => {
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
      });
    });
    tx();
  },
};

export const timerSessionDao = {
  getOrCreate(dayPlanId: string): TimerSession {
    const existing = db
      .prepare(
        `SELECT id, day_plan_id as dayPlanId, active_block_id as activeBlockId, state,
         started_at as startedAt, paused_at as pausedAt, elapsed_seconds as elapsedSeconds
         FROM timer_sessions WHERE day_plan_id = ?`,
      )
      .get(dayPlanId) as TimerSession | undefined;
    if (existing) return existing;

    const session: TimerSession = {
      id: crypto.randomUUID(),
      dayPlanId,
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
    ).run(session.id, session.dayPlanId, null, session.state, null, null, 0, nowIso());
    return session;
  },

  upsert(dayPlanId: string, session: Partial<TimerSession>): void {
    db.prepare(
      `INSERT INTO timer_sessions
       (id, day_plan_id, active_block_id, state, started_at, paused_at, elapsed_seconds, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day_plan_id) DO UPDATE SET
         active_block_id = excluded.active_block_id,
         state = excluded.state,
         started_at = excluded.started_at,
         paused_at = excluded.paused_at,
         elapsed_seconds = excluded.elapsed_seconds,
         updated_at = excluded.updated_at`,
    ).run(
      session.id ?? crypto.randomUUID(),
      dayPlanId,
      session.activeBlockId ?? null,
      session.state ?? "idle",
      session.startedAt ?? null,
      session.pausedAt ?? null,
      session.elapsedSeconds ?? 0,
      nowIso(),
    );
  },
};
