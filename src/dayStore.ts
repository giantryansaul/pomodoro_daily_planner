import { generatePlan } from "./planner";
import { StorageKeys, readJson, writeJson } from "./storage/local";
import type {
  DailyRecurringItem,
  DayBoundaryDefaults,
  EventInput,
  FixedEvent,
  PlannerResult,
  RecurringTemplate,
  RecurringTemplateInput,
  RecurringUpdate,
  ScheduleBlock,
  Task,
  TaskInput,
  TimerSession,
} from "./types";

interface DayBundle {
  id: string;
  dateIso: string;
  tasks: Task[];
  fixedEvents: FixedEvent[];
  dailyRecurring: DailyRecurringItem[];
  timeline: ScheduleBlock[];
  timerSession: TimerSession;
  createdAt: string;
  updatedAt: string;
}

interface PlannerWindowInput {
  dayStartTimeHhmm?: string;
  dayEndTimeHhmm?: string;
}

const DEFAULT_DAY_START_TIME = "07:00";
const DEFAULT_DAY_END_TIME = "19:00";
const HHMM_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const DEFAULT_RECURRING_TEMPLATES: ReadonlyArray<{ title: string; start: string; end: string }> = [
  { title: "Inbox zero", start: "07:00", end: "07:30" },
  { title: "Read technical post", start: "07:30", end: "08:00" },
  { title: "Exercise", start: "12:00", end: "12:30" },
  { title: "Lunch", start: "12:30", end: "13:00" },
];

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function readDayBoundaryDefaults(): DayBoundaryDefaults {
  const stored = readJson<DayBoundaryDefaults>(StorageKeys.dayBoundaryDefaults);
  if (stored && typeof stored.dayStartTimeHhmm === "string" && typeof stored.dayEndTimeHhmm === "string") {
    return stored;
  }
  const seeded: DayBoundaryDefaults = {
    dayStartTimeHhmm: DEFAULT_DAY_START_TIME,
    dayEndTimeHhmm: DEFAULT_DAY_END_TIME,
  };
  writeJson(StorageKeys.dayBoundaryDefaults, seeded);
  return seeded;
}

function readRecurringTemplates(): RecurringTemplate[] {
  const stored = readJson<RecurringTemplate[]>(StorageKeys.recurringTemplates);
  if (Array.isArray(stored)) return stored;
  const seeded: RecurringTemplate[] = DEFAULT_RECURRING_TEMPLATES.map((template, index) => ({
    id: newId(),
    title: template.title,
    startTimeHhmm: template.start,
    endTimeHhmm: template.end,
    sortOrder: index,
    isActive: true,
  }));
  writeJson(StorageKeys.recurringTemplates, seeded);
  return seeded;
}

function writeRecurringTemplates(templates: RecurringTemplate[]): void {
  writeJson(StorageKeys.recurringTemplates, templates);
}

function emptyTimerSession(dayPlanId: string): TimerSession {
  return {
    id: newId(),
    dayPlanId,
    activeBlockId: null,
    state: "idle",
    startedAt: null,
    pausedAt: null,
    elapsedSeconds: 0,
  };
}

function materializeRecurringForDay(dayPlanId: string, existing: DailyRecurringItem[]): DailyRecurringItem[] {
  const templates = readRecurringTemplates().filter((template) => template.isActive);
  const byTemplateId = new Map(existing.map((item) => [item.recurringTemplateId, item]));
  return templates
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((template) => {
      const prior = byTemplateId.get(template.id);
      if (prior) {
        return {
          ...prior,
          titleSnapshot: template.title,
          startTimeSnapshotHhmm: template.startTimeHhmm,
          endTimeSnapshotHhmm: template.endTimeHhmm,
          sortOrder: template.sortOrder,
        };
      }
      return {
        id: newId(),
        dayPlanId,
        recurringTemplateId: template.id,
        titleSnapshot: template.title,
        startTimeSnapshotHhmm: template.startTimeHhmm,
        endTimeSnapshotHhmm: template.endTimeHhmm,
        sortOrder: template.sortOrder,
        isCompleted: false,
      };
    });
}

function readDayBundleRaw(dateIso: string): DayBundle | null {
  return readJson<DayBundle>(StorageKeys.day(dateIso));
}

function migrateTimelineBlocks(blocks: ScheduleBlock[]): ScheduleBlock[] {
  return blocks.map((block) => ({
    ...block,
    sourceDailyRecurringId: block.sourceDailyRecurringId ?? null,
  }));
}

function writeDayBundle(bundle: DayBundle): void {
  bundle.updatedAt = nowIso();
  writeJson(StorageKeys.day(bundle.dateIso), bundle);
}

function loadOrCreateDayBundle(dateIso: string): DayBundle {
  const stored = readDayBundleRaw(dateIso);
  if (stored) {
    stored.timeline = migrateTimelineBlocks(stored.timeline);
    if (!Array.isArray(stored.dailyRecurring) || stored.dailyRecurring.length === 0) {
      stored.dailyRecurring = materializeRecurringForDay(stored.id, stored.dailyRecurring ?? []);
      writeDayBundle(stored);
    }
    return stored;
  }
  const id = newId();
  const created: DayBundle = {
    id,
    dateIso,
    tasks: [],
    fixedEvents: [],
    dailyRecurring: materializeRecurringForDay(id, []),
    timeline: [],
    timerSession: emptyTimerSession(id),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  writeJson(StorageKeys.day(dateIso), created);
  return created;
}

function eventKey(event: EventInput): string {
  return `${event.title.trim()}|${event.startTimeIso}|${event.endTimeIso}`;
}

function dailyRecurringToFixedEvent(dateIso: string, dayPlanId: string, item: DailyRecurringItem): FixedEvent | null {
  if (!item.startTimeSnapshotHhmm || !item.endTimeSnapshotHhmm) return null;
  return {
    id: item.id,
    dayPlanId,
    title: item.titleSnapshot,
    startTimeIso: `${dateIso}T${item.startTimeSnapshotHhmm}:00`,
    endTimeIso: `${dateIso}T${item.endTimeSnapshotHhmm}:00`,
  };
}

function replacePlannedTimeline(bundle: DayBundle, newPlannedBlocks: ScheduleBlock[]): void {
  const completedBlocks = bundle.timeline.filter((block) => block.status !== "planned");
  const removedPlannedIds = new Set(
    bundle.timeline.filter((block) => block.status === "planned").map((block) => block.id),
  );
  if (bundle.timerSession.activeBlockId && removedPlannedIds.has(bundle.timerSession.activeBlockId)) {
    bundle.timerSession = {
      ...bundle.timerSession,
      activeBlockId: null,
    };
  }
  bundle.timeline = [...completedBlocks, ...newPlannedBlocks];
}

function generateAndPersist(bundle: DayBundle, plannerWindow: PlannerWindowInput): PlannerResult {
  const recurringEvents: FixedEvent[] = bundle.dailyRecurring
    .map((item) => dailyRecurringToFixedEvent(bundle.dateIso, bundle.id, item))
    .filter((event): event is FixedEvent => event !== null);
  const result = generatePlan(
    bundle.dateIso,
    bundle.tasks,
    bundle.fixedEvents,
    bundle.id,
    recurringEvents,
    plannerWindow,
  );
  replacePlannedTimeline(bundle, result.blocks);
  writeDayBundle(bundle);
  return result;
}

function parsePlannerWindow(input: PlannerWindowInput): PlannerWindowInput {
  const { dayStartTimeHhmm, dayEndTimeHhmm } = input;
  if (
    typeof dayStartTimeHhmm !== "string"
    || typeof dayEndTimeHhmm !== "string"
    || !HHMM_PATTERN.test(dayStartTimeHhmm)
    || !HHMM_PATTERN.test(dayEndTimeHhmm)
    || dayStartTimeHhmm >= dayEndTimeHhmm
  ) {
    return {};
  }
  return { dayStartTimeHhmm, dayEndTimeHhmm };
}

function parseRecurringTemplateInput(input: RecurringTemplateInput | undefined): RecurringTemplateInput | null {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const startTimeHhmm = typeof input?.startTimeHhmm === "string" ? input.startTimeHhmm : null;
  const endTimeHhmm = typeof input?.endTimeHhmm === "string" ? input.endTimeHhmm : null;
  if (!title) return null;
  if (
    !startTimeHhmm
    || !endTimeHhmm
    || !HHMM_PATTERN.test(startTimeHhmm)
    || !HHMM_PATTERN.test(endTimeHhmm)
    || startTimeHhmm >= endTimeHhmm
  ) {
    return null;
  }
  return { title, startTimeHhmm, endTimeHhmm };
}

function applyRecurringUpdates(bundle: DayBundle, updates: RecurringUpdate[]): void {
  const validUpdates = updates.filter(
    (update) => typeof update.id === "string" && typeof update.isCompleted === "boolean",
  );
  if (validUpdates.length === 0) return;

  const hasTimedFields = validUpdates.some(
    (update) =>
      typeof update.titleSnapshot === "string"
      || typeof update.startTimeHhmm === "string"
      || typeof update.endTimeHhmm === "string",
  );

  const updatesById = new Map(validUpdates.map((update) => [update.id, update]));

  if (hasTimedFields) {
    const templates = readRecurringTemplates();
    let templatesChanged = false;

    bundle.dailyRecurring = bundle.dailyRecurring.map((item) => {
      const update = updatesById.get(item.id);
      if (!update) return item;

      const nextTitleSnapshot = update.titleSnapshot ?? item.titleSnapshot;
      const nextStartTime = update.startTimeHhmm ?? item.startTimeSnapshotHhmm;
      const nextEndTime = update.endTimeHhmm ?? item.endTimeSnapshotHhmm;

      if (update.editScope === "template") {
        const templateIndex = templates.findIndex((template) => template.id === item.recurringTemplateId);
        if (templateIndex !== -1) {
          templates[templateIndex] = {
            ...templates[templateIndex],
            title: nextTitleSnapshot,
            startTimeHhmm: nextStartTime,
            endTimeHhmm: nextEndTime,
          };
          templatesChanged = true;
        }
      }

      return {
        ...item,
        titleSnapshot: nextTitleSnapshot,
        startTimeSnapshotHhmm: nextStartTime,
        endTimeSnapshotHhmm: nextEndTime,
        isCompleted: update.isCompleted,
      };
    });

    if (templatesChanged) {
      writeRecurringTemplates(templates);
    }
    return;
  }

  bundle.dailyRecurring = bundle.dailyRecurring.map((item) => {
    const update = updatesById.get(item.id);
    if (!update) return item;
    return { ...item, isCompleted: update.isCompleted };
  });
}

export const dayStore = {
  async getDayBoundaryDefaults(): Promise<DayBoundaryDefaults> {
    return readDayBoundaryDefaults();
  },

  async setDayBoundaryDefaults(input: DayBoundaryDefaults): Promise<void> {
    if (
      !HHMM_PATTERN.test(input.dayStartTimeHhmm)
      || !HHMM_PATTERN.test(input.dayEndTimeHhmm)
      || input.dayStartTimeHhmm >= input.dayEndTimeHhmm
    ) {
      return;
    }
    writeJson(StorageKeys.dayBoundaryDefaults, input);
  },

  async getTasks(dateIso: string): Promise<{ dayPlanId: string; tasks: Task[] }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return { dayPlanId: bundle.id, tasks: bundle.tasks };
  },

  async replaceTasks(dateIso: string, tasks: TaskInput[]): Promise<void> {
    const bundle = loadOrCreateDayBundle(dateIso);
    const replacedTaskIds = new Set(bundle.tasks.map((task) => task.id));
    const nextTasks: Task[] = tasks.map((input, index) => ({
      id: newId(),
      dayPlanId: bundle.id,
      title: input.title,
      notes: input.notes ?? null,
      priorityRank: index + 1,
      estimatedPomodoros: input.estimatedPomodoros ?? null,
      status: "pending",
    }));
    bundle.tasks = nextTasks;
    bundle.timeline = bundle.timeline.map((block) => {
      if (block.sourceTaskId && replacedTaskIds.has(block.sourceTaskId)) {
        return { ...block, sourceTaskId: null };
      }
      return block;
    });
    writeDayBundle(bundle);
  },

  async getRecurring(dateIso: string): Promise<{ dayPlanId: string; recurring: DailyRecurringItem[] }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return { dayPlanId: bundle.id, recurring: bundle.dailyRecurring };
  },

  async updateRecurring(dateIso: string, updates: RecurringUpdate[]): Promise<void> {
    const bundle = loadOrCreateDayBundle(dateIso);
    applyRecurringUpdates(bundle, updates);
    writeDayBundle(bundle);
  },

  async deleteRecurringTemplate(dateIso: string, recurringTemplateId: string): Promise<void> {
    const before = readRecurringTemplates();
    const nextTemplates = before.filter((template) => template.id !== recurringTemplateId);
    if (nextTemplates.length === before.length) return;
    writeRecurringTemplates(nextTemplates);
    const bundle = loadOrCreateDayBundle(dateIso);
    bundle.dailyRecurring = materializeRecurringForDay(bundle.id, bundle.dailyRecurring);
    const defaults = readDayBoundaryDefaults();
    if (bundle.timeline.length > 0) {
      generateAndPersist(bundle, {
        dayStartTimeHhmm: defaults.dayStartTimeHhmm,
        dayEndTimeHhmm: defaults.dayEndTimeHhmm,
      });
    } else {
      writeDayBundle(bundle);
    }
  },

  async setTaskCompletion(dateIso: string, taskId: string, completed: boolean): Promise<{ ok: boolean }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    if (!bundle.tasks.some((task) => task.id === taskId)) return { ok: false };

    const affectedBlockIds = new Set(
      bundle.timeline
        .filter(
          (block) =>
            block.sourceTaskId === taskId && (block.blockType === "focus" || block.blockType === "break"),
        )
        .map((block) => block.id),
    );

    bundle.tasks = bundle.tasks.map((task) =>
      task.id === taskId ? { ...task, status: completed ? "completed" : "pending" } : task,
    );

    bundle.timeline = bundle.timeline.map((block) => {
      if (block.sourceTaskId !== taskId || (block.blockType !== "focus" && block.blockType !== "break")) {
        return block;
      }
      if (completed && block.status === "planned") {
        return { ...block, status: "completed" as const };
      }
      if (!completed && block.status === "completed") {
        return { ...block, status: "planned" as const };
      }
      return block;
    });

    if (
      completed
      && bundle.timerSession.activeBlockId
      && affectedBlockIds.has(bundle.timerSession.activeBlockId)
    ) {
      bundle.timerSession = {
        ...bundle.timerSession,
        activeBlockId: null,
        state: "idle",
        elapsedSeconds: 0,
        startedAt: null,
        pausedAt: null,
      };
    }

    writeDayBundle(bundle);
    return { ok: true };
  },

  async setRecurringCompletion(dateIso: string, dailyRecurringId: string, completed: boolean): Promise<{ ok: boolean }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    if (!bundle.dailyRecurring.some((item) => item.id === dailyRecurringId)) return { ok: false };

    const affectedBlockIds = new Set(
      bundle.timeline
        .filter(
          (block) =>
            block.sourceDailyRecurringId === dailyRecurringId
            && (block.blockType === "focus" || block.blockType === "break"),
        )
        .map((block) => block.id),
    );

    bundle.dailyRecurring = bundle.dailyRecurring.map((item) =>
      item.id === dailyRecurringId ? { ...item, isCompleted: completed } : item,
    );

    bundle.timeline = bundle.timeline.map((block) => {
      if (block.sourceDailyRecurringId !== dailyRecurringId || (block.blockType !== "focus" && block.blockType !== "break")) {
        return block;
      }
      if (completed && block.status === "planned") {
        return { ...block, status: "completed" as const };
      }
      if (!completed && block.status === "completed") {
        return { ...block, status: "planned" as const };
      }
      return block;
    });

    if (
      completed
      && bundle.timerSession.activeBlockId
      && affectedBlockIds.has(bundle.timerSession.activeBlockId)
    ) {
      bundle.timerSession = {
        ...bundle.timerSession,
        activeBlockId: null,
        state: "idle",
        elapsedSeconds: 0,
        startedAt: null,
        pausedAt: null,
      };
    }

    writeDayBundle(bundle);
    return { ok: true };
  },

  async adjustTaskEstimatedPomodoros(
    dateIso: string,
    taskId: string,
    delta: number,
    plannerWindow: PlannerWindowInput,
  ): Promise<{ ok: boolean }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    const task = bundle.tasks.find((entry) => entry.id === taskId);
    if (!task) return { ok: false };

    const current = Math.max(1, task.estimatedPomodoros ?? 1);
    const next = Math.min(6, Math.max(1, current + delta));
    if (next === current) {
      return { ok: true };
    }

    bundle.tasks = bundle.tasks.map((entry) =>
      entry.id === taskId ? { ...entry, estimatedPomodoros: next } : entry,
    );
    generateAndPersist(bundle, parsePlannerWindow(plannerWindow));
    return { ok: true };
  },

  async createRecurringTemplateForDay(
    dateIso: string,
    input: RecurringTemplateInput,
  ): Promise<{ ok: boolean; recurring?: DailyRecurringItem[] }> {
    const validInput = parseRecurringTemplateInput(input);
    if (!validInput) return { ok: false };
    const templates = readRecurringTemplates();
    const maxSort = templates.reduce((current, template) => Math.max(current, template.sortOrder), -1);
    const created: RecurringTemplate = {
      id: newId(),
      title: validInput.title,
      startTimeHhmm: validInput.startTimeHhmm ?? null,
      endTimeHhmm: validInput.endTimeHhmm ?? null,
      sortOrder: maxSort + 1,
      isActive: true,
    };
    writeRecurringTemplates([...templates, created]);

    const bundle = loadOrCreateDayBundle(dateIso);
    bundle.dailyRecurring = materializeRecurringForDay(bundle.id, bundle.dailyRecurring);
    writeDayBundle(bundle);
    return { ok: true, recurring: bundle.dailyRecurring };
  },

  async getEvents(dateIso: string): Promise<{ dayPlanId: string; events: FixedEvent[] }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return { dayPlanId: bundle.id, events: bundle.fixedEvents };
  },

  async replaceEvents(dateIso: string, events: EventInput[]): Promise<void> {
    const bundle = loadOrCreateDayBundle(dateIso);
    const replacedEventIds = new Set(bundle.fixedEvents.map((event) => event.id));
    const seen = new Set<string>();
    const nextEvents: FixedEvent[] = [];
    for (const input of events) {
      const title = input.title.trim();
      const startMs = new Date(input.startTimeIso).getTime();
      const endMs = new Date(input.endTimeIso).getTime();
      const key = eventKey(input);
      if (!title || Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs || seen.has(key)) continue;
      seen.add(key);
      nextEvents.push({
        id: newId(),
        dayPlanId: bundle.id,
        title,
        startTimeIso: input.startTimeIso,
        endTimeIso: input.endTimeIso,
      });
    }
    bundle.fixedEvents = nextEvents;
    bundle.timeline = bundle.timeline.map((block) => {
      if (block.sourceEventId && replacedEventIds.has(block.sourceEventId)) {
        return { ...block, sourceEventId: null };
      }
      return block;
    });
    writeDayBundle(bundle);
  },

  async generatePlan(dateIso: string, plannerWindow: PlannerWindowInput): Promise<PlannerResult> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return generateAndPersist(bundle, parsePlannerWindow(plannerWindow));
  },

  async resetAndGenerate(dateIso: string, plannerWindow: PlannerWindowInput): Promise<PlannerResult> {
    const bundle = loadOrCreateDayBundle(dateIso);
    bundle.timeline = [];
    bundle.tasks = bundle.tasks.map((task) => ({ ...task, status: "pending" }));
    bundle.dailyRecurring = bundle.dailyRecurring.map((item) => ({ ...item, isCompleted: false }));
    bundle.timerSession = emptyTimerSession(bundle.id);
    return generateAndPersist(bundle, parsePlannerWindow(plannerWindow));
  },

  async clearDay(dateIso: string): Promise<{
    dayPlanId: string;
    tasks: Task[];
    events: FixedEvent[];
    timeline: ScheduleBlock[];
    recurring: DailyRecurringItem[];
    session: TimerSession;
  }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    bundle.tasks = [];
    bundle.fixedEvents = [];
    bundle.timeline = [];
    bundle.dailyRecurring = [];
    bundle.timerSession = emptyTimerSession(bundle.id);
    bundle.dailyRecurring = materializeRecurringForDay(bundle.id, []);
    writeDayBundle(bundle);
    return {
      dayPlanId: bundle.id,
      tasks: bundle.tasks,
      events: bundle.fixedEvents,
      timeline: bundle.timeline,
      recurring: bundle.dailyRecurring,
      session: bundle.timerSession,
    };
  },

  async getTimeline(dateIso: string): Promise<{ dayPlanId: string; blocks: ScheduleBlock[] }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return { dayPlanId: bundle.id, blocks: bundle.timeline };
  },

  async markBlockCompleted(dateIso: string, blockId: string): Promise<{ ok: boolean }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    const target = bundle.timeline.find((block) => block.id === blockId);
    if (!target) return { ok: false };
    bundle.timeline = bundle.timeline.map((block) =>
      block.id === blockId ? { ...block, status: "completed" } : block,
    );
    if (target.sourceTaskId) {
      bundle.tasks = bundle.tasks.map((task) =>
        task.id === target.sourceTaskId ? { ...task, status: "completed" } : task,
      );
    }
    writeDayBundle(bundle);
    return { ok: true };
  },

  async updateFocusSession(
    dateIso: string,
    blockId: string,
    input: { label: string; startTimeIso: string; focusEndTimeIso: string; breakEndTimeIso: string },
  ): Promise<{ ok: boolean }> {
    const label = input.label.trim();
    if (
      !label
      || Number.isNaN(new Date(input.startTimeIso).getTime())
      || Number.isNaN(new Date(input.focusEndTimeIso).getTime())
      || Number.isNaN(new Date(input.breakEndTimeIso).getTime())
    ) {
      return { ok: false };
    }
    const bundle = loadOrCreateDayBundle(dateIso);
    const focusBlock = bundle.timeline.find((block) => block.id === blockId && block.blockType === "focus");
    if (!focusBlock) return { ok: false };

    const previousFocusEnd = focusBlock.endTimeIso;
    const breakBlock = bundle.timeline
      .filter((block) => block.blockType === "break" && block.startTimeIso === previousFocusEnd)
      .sort((a, b) => a.sequenceIndex - b.sequenceIndex)[0];

    bundle.timeline = bundle.timeline.map((block) => {
      if (block.id === focusBlock.id) {
        return { ...block, label, startTimeIso: input.startTimeIso, endTimeIso: input.focusEndTimeIso };
      }
      if (breakBlock && block.id === breakBlock.id) {
        return { ...block, startTimeIso: input.focusEndTimeIso, endTimeIso: input.breakEndTimeIso };
      }
      return block;
    });

    if (focusBlock.sourceTaskId) {
      bundle.tasks = bundle.tasks.map((task) =>
        task.id === focusBlock.sourceTaskId ? { ...task, title: label } : task,
      );
      bundle.timeline = bundle.timeline.map((block) =>
        block.sourceTaskId === focusBlock.sourceTaskId ? { ...block, label } : block,
      );
    } else if (focusBlock.sourceDailyRecurringId) {
      const recurringId = focusBlock.sourceDailyRecurringId;
      bundle.timeline = bundle.timeline.map((block) =>
        block.sourceDailyRecurringId === recurringId && block.blockType === "focus" ? { ...block, label } : block,
      );
      bundle.dailyRecurring = bundle.dailyRecurring.map((item) =>
        item.id === recurringId ? { ...item, titleSnapshot: label } : item,
      );
    }

    writeDayBundle(bundle);
    return { ok: true };
  },

  async updateTimelineEvent(
    dateIso: string,
    blockId: string,
    input: { label: string; startTimeIso: string; endTimeIso: string },
  ): Promise<{ ok: boolean }> {
    const label = input.label.trim();
    const startMs = new Date(input.startTimeIso).getTime();
    const endMs = new Date(input.endTimeIso).getTime();
    if (!label || Number.isNaN(startMs) || Number.isNaN(endMs) || startMs >= endMs) {
      return { ok: false };
    }
    const bundle = loadOrCreateDayBundle(dateIso);
    const target = bundle.timeline.find((block) => block.id === blockId && block.blockType === "fixed_event");
    if (!target) return { ok: false };
    bundle.timeline = bundle.timeline.map((block) =>
      block.id === blockId
        ? { ...block, label, startTimeIso: input.startTimeIso, endTimeIso: input.endTimeIso }
        : block,
    );
    writeDayBundle(bundle);
    return { ok: true };
  },

  async getTimerSession(dateIso: string): Promise<{ dayPlanId: string; session: TimerSession }> {
    const bundle = loadOrCreateDayBundle(dateIso);
    return { dayPlanId: bundle.id, session: bundle.timerSession };
  },

  async upsertTimerSession(dateIso: string, session: Partial<TimerSession>): Promise<void> {
    const bundle = loadOrCreateDayBundle(dateIso);
    bundle.timerSession = {
      id: session.id ?? bundle.timerSession.id ?? newId(),
      dayPlanId: bundle.id,
      activeBlockId: session.activeBlockId ?? null,
      state: session.state ?? "idle",
      startedAt: session.startedAt ?? null,
      pausedAt: session.pausedAt ?? null,
      elapsedSeconds: session.elapsedSeconds ?? 0,
    };
    writeDayBundle(bundle);
  },
};

export type { DayBundle, PlannerWindowInput };
