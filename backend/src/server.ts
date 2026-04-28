import cors from "cors";
import express from "express";
import { getDbPath, initDb } from "./db.js";
import { dayPlanDao, eventDao, recurringDao, scheduleBlockDao, taskDao, timerSessionDao } from "./dao.js";
import { generatePlan } from "./planner.js";
import type { EventInput, RecurringUpdate, TaskInput } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

initDb();

function generateAndPersistDayPlan(
  dateIso: string,
  dayPlanId: string,
  plannerWindow: { dayStartTimeHhmm?: string; dayEndTimeHhmm?: string } = {},
): ReturnType<typeof generatePlan> {
  const tasks = taskDao.listForDay(dayPlanId);
  const events = eventDao.listForDay(dayPlanId);
  const recurring = recurringDao.listForDay(dayPlanId)
    .filter((item) => item.startTimeSnapshotHhmm && item.endTimeSnapshotHhmm)
    .map((item) => ({
      id: item.id,
      dayPlanId,
      title: item.titleSnapshot,
      startTimeIso: `${dateIso}T${item.startTimeSnapshotHhmm}:00`,
      endTimeIso: `${dateIso}T${item.endTimeSnapshotHhmm}:00`,
    }));
  const plan = generatePlan(dateIso, tasks, events, dayPlanId, recurring, plannerWindow);
  scheduleBlockDao.replacePlanned(dayPlanId, plan.blocks);
  return plan;
}

function parsePlannerWindow(body: unknown): { dayStartTimeHhmm?: string; dayEndTimeHhmm?: string } {
  if (!body || typeof body !== "object") return {};
  const payload = body as { dayStartTimeHhmm?: unknown; dayEndTimeHhmm?: unknown };
  const dayStartTimeHhmm = typeof payload.dayStartTimeHhmm === "string" ? payload.dayStartTimeHhmm : undefined;
  const dayEndTimeHhmm = typeof payload.dayEndTimeHhmm === "string" ? payload.dayEndTimeHhmm : undefined;
  const hhmmPattern = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!dayStartTimeHhmm || !dayEndTimeHhmm || !hhmmPattern.test(dayStartTimeHhmm) || !hhmmPattern.test(dayEndTimeHhmm)) {
    return {};
  }
  if (dayStartTimeHhmm >= dayEndTimeHhmm) return {};
  return { dayStartTimeHhmm, dayEndTimeHhmm };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, dbPath: getDbPath() });
});

app.get("/api/day/:date/tasks", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const tasks = taskDao.listForDay(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, tasks });
});

app.put("/api/day/:date/tasks", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const tasks: TaskInput[] = Array.isArray(req.body.tasks) ? req.body.tasks : [];
  taskDao.replaceAll(dayPlan.id, tasks);
  res.json({ ok: true });
});

app.get("/api/day/:date/recurring", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const recurring = recurringDao.listForDay(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, recurring });
});

app.put("/api/day/:date/recurring", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const updates: RecurringUpdate[] = Array.isArray(req.body.recurring) ? req.body.recurring : [];
  const validUpdates = updates.filter((update) => typeof update.id === "string" && typeof update.isCompleted === "boolean");
  const hasTimedFields = validUpdates.some(
    (update) => typeof update.titleSnapshot === "string" || typeof update.startTimeHhmm === "string" || typeof update.endTimeHhmm === "string",
  );
  if (hasTimedFields) {
    recurringDao.updateTimed(dayPlan.id, validUpdates);
  } else {
    recurringDao.updateCompletions(dayPlan.id, validUpdates);
  }
  res.json({ ok: true });
});

app.get("/api/day/:date/events", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const events = eventDao.listForDay(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, events });
});

app.put("/api/day/:date/events", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const events: EventInput[] = Array.isArray(req.body.events) ? req.body.events : [];
  eventDao.replaceAll(dayPlan.id, events);
  res.json({ ok: true });
});

app.post("/api/day/:date/generate-plan", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const plannerWindow = parsePlannerWindow(req.body);
  const plan = generateAndPersistDayPlan(req.params.date, dayPlan.id, plannerWindow);
  res.json({ ok: true, ...plan });
});

app.post("/api/day/:date/reset-and-generate", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  dayPlanDao.resetDayStateForRebuild(dayPlan.id);
  const plannerWindow = parsePlannerWindow(req.body);
  const plan = generateAndPersistDayPlan(req.params.date, dayPlan.id, plannerWindow);
  res.json({ ok: true, ...plan });
});

app.get("/api/day/:date/timeline", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const blocks = scheduleBlockDao.listForDay(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, blocks });
});

app.post("/api/day/:date/timeline/:blockId/complete", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const block = scheduleBlockDao.markCompleted(dayPlan.id, req.params.blockId);
  if (!block) {
    res.status(404).json({ error: "Timeline block not found" });
    return;
  }
  if (block.sourceTaskId) {
    taskDao.updateStatus(dayPlan.id, block.sourceTaskId, "completed");
  }
  res.json({ ok: true });
});

app.put("/api/day/:date/tasks/:taskId/title", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  taskDao.updateTitle(dayPlan.id, req.params.taskId, title);
  scheduleBlockDao.updateLabelsBySourceTask(dayPlan.id, req.params.taskId, title);
  res.json({ ok: true });
});

app.put("/api/day/:date/events/:eventId/title", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
  if (!title) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  eventDao.updateTitle(dayPlan.id, req.params.eventId, title);
  scheduleBlockDao.updateLabelsBySourceEvent(dayPlan.id, req.params.eventId, title);
  res.json({ ok: true });
});

app.put("/api/day/:date/timeline/:blockId/focus-session", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  const startTimeIso = typeof req.body.startTimeIso === "string" ? req.body.startTimeIso : "";
  const focusEndTimeIso = typeof req.body.focusEndTimeIso === "string" ? req.body.focusEndTimeIso : "";
  const breakEndTimeIso = typeof req.body.breakEndTimeIso === "string" ? req.body.breakEndTimeIso : "";
  if (!label || Number.isNaN(new Date(startTimeIso).getTime()) || Number.isNaN(new Date(focusEndTimeIso).getTime()) || Number.isNaN(new Date(breakEndTimeIso).getTime())) {
    res.status(400).json({ error: "Valid label and session times are required" });
    return;
  }
  const updated = scheduleBlockDao.updateFocusSession(dayPlan.id, req.params.blockId, {
    label,
    startTimeIso,
    focusEndTimeIso,
    breakEndTimeIso,
  });
  if (!updated) {
    res.status(404).json({ error: "Focus block not found" });
    return;
  }
  if (updated.sourceTaskId) {
    taskDao.updateTitle(dayPlan.id, updated.sourceTaskId, label);
    scheduleBlockDao.updateLabelsBySourceTask(dayPlan.id, updated.sourceTaskId, label);
  }
  res.json({ ok: true });
});

app.put("/api/day/:date/timeline/:blockId/event", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const label = typeof req.body.label === "string" ? req.body.label.trim() : "";
  const startTimeIso = typeof req.body.startTimeIso === "string" ? req.body.startTimeIso : "";
  const endTimeIso = typeof req.body.endTimeIso === "string" ? req.body.endTimeIso : "";
  const start = new Date(startTimeIso).getTime();
  const end = new Date(endTimeIso).getTime();
  if (!label || Number.isNaN(start) || Number.isNaN(end) || start >= end) {
    res.status(400).json({ error: "Valid label and event times are required" });
    return;
  }
  const updated = scheduleBlockDao.updateTimelineEvent(dayPlan.id, req.params.blockId, { label, startTimeIso, endTimeIso });
  if (!updated) {
    res.status(404).json({ error: "Timeline event not found" });
    return;
  }
  res.json({ ok: true });
});

app.get("/api/day/:date/timer-session", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  const session = timerSessionDao.getOrCreate(dayPlan.id);
  res.json({ dayPlanId: dayPlan.id, session });
});

app.put("/api/day/:date/timer-session", (req, res) => {
  const dayPlan = dayPlanDao.getOrCreate(req.params.date);
  timerSessionDao.upsert(dayPlan.id, req.body.session ?? {});
  res.json({ ok: true });
});

app.listen(port, () => {
  console.log(`Pom Day API running on http://localhost:${port}`);
});
