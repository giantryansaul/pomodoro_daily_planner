import cors from "cors";
import express from "express";
import { getDbPath, initDb } from "./db.js";
import { dayPlanDao, eventDao, recurringDao, scheduleBlockDao, taskDao, timerSessionDao } from "./dao.js";
import { generatePlan } from "./planner.js";
import type { EventInput, RecurringCompletionUpdate, TaskInput } from "./types.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json());

initDb();

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
  const updates: RecurringCompletionUpdate[] = Array.isArray(req.body.recurring) ? req.body.recurring : [];
  recurringDao.updateCompletions(dayPlan.id, updates);
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
  const tasks = taskDao.listForDay(dayPlan.id);
  const events = eventDao.listForDay(dayPlan.id);
  const plan = generatePlan(req.params.date, tasks, events, dayPlan.id);
  scheduleBlockDao.replacePlanned(dayPlan.id, plan.blocks);
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
  console.log(`Morning Planner API running on http://localhost:${port}`);
});
