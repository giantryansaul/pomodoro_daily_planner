export type BlockType = "focus" | "break" | "fixed_event" | "recurring_event";
export type BlockStatus = "planned" | "completed" | "skipped";
export type TimerState = "idle" | "running" | "paused" | "completed";
export type TaskStatus = "pending" | "completed";

export interface Task {
  id: string;
  dayPlanId: string;
  title: string;
  notes: string | null;
  priorityRank: number;
  estimatedPomodoros: number | null;
  status: TaskStatus;
}

export interface FixedEvent {
  id: string;
  dayPlanId: string;
  title: string;
  startTimeIso: string;
  endTimeIso: string;
}

/** Task windows become pomodoro focus/break sessions; calendar events are one block per day (e.g. Lunch). */
export type RecurringTemplateKind = "task" | "calendar_event";

export interface DailyRecurringItem {
  id: string;
  dayPlanId: string;
  recurringTemplateId: string;
  titleSnapshot: string;
  startTimeSnapshotHhmm: string | null;
  endTimeSnapshotHhmm: string | null;
  /** For `kind === "task"`: number of 25+5 focus/break cycles; for `calendar_event`, null. */
  estimatedPomodoros: number | null;
  sortOrder: number;
  isCompleted: boolean;
  kind: RecurringTemplateKind;
}

export type RecurringEditScope = "today" | "template";

export interface DayBoundaryDefaults {
  dayStartTimeHhmm: string;
  dayEndTimeHhmm: string;
}

export interface RecurringTemplate {
  id: string;
  title: string;
  startTimeHhmm: string | null;
  endTimeHhmm: string | null;
  /** For `kind === "task"`: pomodoro count (1–5); for `calendar_event`, null. */
  estimatedPomodoros: number | null;
  sortOrder: number;
  isActive: boolean;
  kind: RecurringTemplateKind;
}

export interface RecurringTemplateInput {
  title: string;
  startTimeHhmm?: string | null;
  endTimeHhmm?: string | null;
  kind?: RecurringTemplateKind;
  /** Required for `kind === "task"` when creating/updating from the UI. */
  estimatedPomodoros?: number;
}

export interface RecurringUpdate {
  id: string;
  isCompleted: boolean;
  titleSnapshot?: string;
  startTimeHhmm?: string;
  endTimeHhmm?: string;
  estimatedPomodoros?: number;
  editScope?: RecurringEditScope;
}

export interface ScheduleBlock {
  id: string;
  dayPlanId: string;
  sourceTaskId: string | null;
  /** Daily recurring row id when this focus block was generated from a recurring window. */
  sourceDailyRecurringId: string | null;
  sourceEventId: string | null;
  blockType: BlockType;
  label: string;
  startTimeIso: string;
  endTimeIso: string;
  sequenceIndex: number;
  status: BlockStatus;
}

export interface TimerSession {
  id: string;
  dayPlanId: string;
  activeBlockId: string | null;
  state: TimerState;
  startedAt: string | null;
  pausedAt: string | null;
  elapsedSeconds: number;
}

export interface TaskInput {
  title: string;
  notes?: string;
  estimatedPomodoros?: number;
}

export interface EventInput {
  title: string;
  startTimeIso: string;
  endTimeIso: string;
}

export interface UnscheduledTask {
  taskId: string;
  title: string;
  reason: string;
}

export interface PlannerResult {
  blocks: ScheduleBlock[];
  unscheduledTasks: UnscheduledTask[];
}
