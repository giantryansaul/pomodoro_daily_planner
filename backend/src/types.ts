export type BlockType = "focus" | "break" | "fixed_event";
export type BlockStatus = "planned" | "completed" | "skipped";
export type TimerState = "idle" | "running" | "paused" | "completed";

export interface Task {
  id: string;
  dayPlanId: string;
  title: string;
  notes: string | null;
  priorityRank: number;
  estimatedPomodoros: number | null;
  status: string;
}

export interface FixedEvent {
  id: string;
  dayPlanId: string;
  title: string;
  startTimeIso: string;
  endTimeIso: string;
}

export interface DailyRecurringItem {
  id: string;
  dayPlanId: string;
  recurringTemplateId: string;
  titleSnapshot: string;
  sortOrder: number;
  isCompleted: boolean;
}

export interface ScheduleBlock {
  id: string;
  dayPlanId: string;
  sourceTaskId: string | null;
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

export interface RecurringCompletionUpdate {
  id: string;
  isCompleted: boolean;
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
