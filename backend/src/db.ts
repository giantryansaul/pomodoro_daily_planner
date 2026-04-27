import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = process.env.MORNING_PLANNER_DATA_DIR ?? path.resolve(process.cwd(), "../data");
const dbPath = process.env.MORNING_PLANNER_DB_PATH ?? path.join(dataDir, "morning-planner.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS day_plans (
    id TEXT PRIMARY KEY,
    date_iso TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    notes TEXT,
    priority_rank INTEGER NOT NULL,
    estimated_pomodoros INTEGER,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS recurring_templates (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS daily_recurring_items (
    id TEXT PRIMARY KEY,
    day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
    recurring_template_id TEXT NOT NULL REFERENCES recurring_templates(id),
    title_snapshot TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    is_completed INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS fixed_events (
    id TEXT PRIMARY KEY,
    day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    start_time_iso TEXT NOT NULL,
    end_time_iso TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS schedule_blocks (
    id TEXT PRIMARY KEY,
    day_plan_id TEXT NOT NULL REFERENCES day_plans(id) ON DELETE CASCADE,
    source_task_id TEXT REFERENCES tasks(id),
    block_type TEXT NOT NULL,
    label TEXT NOT NULL,
    start_time_iso TEXT NOT NULL,
    end_time_iso TEXT NOT NULL,
    sequence_index INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS timer_sessions (
    id TEXT PRIMARY KEY,
    day_plan_id TEXT NOT NULL UNIQUE REFERENCES day_plans(id) ON DELETE CASCADE,
    active_block_id TEXT REFERENCES schedule_blocks(id),
    state TEXT NOT NULL,
    started_at TEXT,
    paused_at TEXT,
    elapsed_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
];

export function initDb(): void {
  db.pragma("foreign_keys = ON");
  for (const statement of schemaStatements) {
    db.exec(statement);
  }
  ensureSourceEventColumn();
  seedRecurringTemplates();
}

function ensureSourceEventColumn(): void {
  const columns = db.prepare("PRAGMA table_info(schedule_blocks)").all() as Array<{ name: string }>;
  const hasSourceEventId = columns.some((column) => column.name === "source_event_id");
  if (!hasSourceEventId) {
    db.exec("ALTER TABLE schedule_blocks ADD COLUMN source_event_id TEXT REFERENCES fixed_events(id)");
  }
}

function seedRecurringTemplates(): void {
  const count = db.prepare("SELECT COUNT(*) as count FROM recurring_templates").get() as { count: number };
  if (count.count > 0) return;

  const now = new Date().toISOString();
  const defaults = ["Inbox zero", "Read technical post", "Exercise", "Lunch"];
  const stmt = db.prepare(
    `INSERT INTO recurring_templates (id, title, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction(() => {
    defaults.forEach((title, idx) => {
      stmt.run(crypto.randomUUID(), title, idx, now, now);
    });
  });
  tx();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function getDbPath(): string {
  return dbPath;
}
