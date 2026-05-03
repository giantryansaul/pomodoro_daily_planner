import { describe, expect, it } from "vitest";
import { generatePlan } from "./planner";
import type { FixedEvent, Task } from "./types";

function makeTask(id: string, title: string, priorityRank: number, estimatedPomodoros = 1): Task {
  return {
    id,
    dayPlanId: "day-1",
    title,
    notes: null,
    priorityRank,
    estimatedPomodoros,
    status: "pending",
  };
}

describe("generatePlan", () => {
  it("schedules by priority order", () => {
    const tasks = [makeTask("b", "Second", 2), makeTask("a", "First", 1)];
    const fixedEvents: FixedEvent[] = [];
    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");
    const firstFocus = result.blocks.find((block) => block.blockType === "focus");
    expect(firstFocus?.label).toBe("First");
  });

  it("returns unscheduled when insufficient time", () => {
    const tasks = [makeTask("a", "Big task", 1, 20)];
    const fixedEvents: FixedEvent[] = [
      {
        id: "evt-1",
        dayPlanId: "day-1",
        title: "Busy day",
        startTimeIso: "2026-04-25T07:00:00",
        endTimeIso: "2026-04-25T21:50:00",
      },
    ];
    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");
    expect(result.unscheduledTasks.length).toBeGreaterThan(0);
  });

  it("orders generated focus blocks before later fixed events chronologically", () => {
    const tasks = [makeTask("a", "First focus", 1)];
    const fixedEvents: FixedEvent[] = [
      {
        id: "evt-1",
        dayPlanId: "day-1",
        title: "Nine AM meeting",
        startTimeIso: "2026-04-25T09:00:00",
        endTimeIso: "2026-04-25T09:30:00",
      },
    ];

    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");

    expect(result.blocks[0].label).toBe("First focus");
    expect(result.blocks.map((block) => block.label)).toContain("Nine AM meeting");
  });

  it("keeps fixed events represented once on repeated generation", () => {
    const tasks = [makeTask("a", "First focus", 1)];
    const fixedEvents: FixedEvent[] = [
      {
        id: "evt-1",
        dayPlanId: "day-1",
        title: "Calendar hold",
        startTimeIso: "2026-04-25T11:00:00",
        endTimeIso: "2026-04-25T11:30:00",
      },
    ];

    const firstResult = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");
    const secondResult = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");

    expect(firstResult.blocks.filter((block) => block.label === "Calendar hold")).toHaveLength(1);
    expect(secondResult.blocks.filter((block) => block.label === "Calendar hold")).toHaveLength(1);
  });

  it("does not schedule focus and break sessions into fixed events", () => {
    const tasks = [makeTask("a", "Needs full block", 1)];
    const fixedEvents: FixedEvent[] = [
      {
        id: "evt-1",
        dayPlanId: "day-1",
        title: "Early meeting",
        startTimeIso: "2026-04-25T07:25:00",
        endTimeIso: "2026-04-25T08:00:00",
      },
    ];

    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1");
    const focus = result.blocks.find((block) => block.blockType === "focus");
    const breakBlock = result.blocks.find((block) => block.blockType === "break");
    const fixedEventEnd = new Date(fixedEvents[0].endTimeIso).getTime();
    const focusStart = new Date(focus?.startTimeIso ?? "").getTime();
    const focusEnd = new Date(focus?.endTimeIso ?? "").getTime();
    const breakStart = new Date(breakBlock?.startTimeIso ?? "").getTime();
    const breakEnd = new Date(breakBlock?.endTimeIso ?? "").getTime();

    expect(focusStart).toBe(fixedEventEnd);
    expect(focusEnd - focusStart).toBe(25 * 60_000);
    expect(breakStart).toBe(focusEnd);
    expect(breakEnd - breakStart).toBe(5 * 60_000);
  });

  it("tiles recurring windows into focus+break and keeps task focus after the window", () => {
    const tasks = [makeTask("a", "Deep work", 1)];
    const fixedEvents: FixedEvent[] = [];
    const recurringEvents: FixedEvent[] = [
      {
        id: "rec-1",
        dayPlanId: "day-1",
        title: "Morning routine",
        startTimeIso: "2026-04-25T07:00:00",
        endTimeIso: "2026-04-25T07:30:00",
      },
    ];

    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1", recurringEvents);
    const recurringFocus = result.blocks.find((block) => block.blockType === "focus" && block.sourceDailyRecurringId === "rec-1");
    const recurringBreak = result.blocks.find((block) => block.blockType === "break" && block.startTimeIso === recurringFocus?.endTimeIso);
    const taskFocus = result.blocks.find((block) => block.blockType === "focus" && block.sourceTaskId === "a");
    const recurringEnd = new Date(recurringEvents[0].endTimeIso).getTime();
    const taskFocusStart = new Date(taskFocus?.startTimeIso ?? "").getTime();

    expect(recurringFocus?.label).toBe("Morning routine");
    expect(recurringFocus?.sourceDailyRecurringId).toBe("rec-1");
    expect(recurringBreak?.label).toBe("Break");
    expect(taskFocusStart).toBeGreaterThanOrEqual(recurringEnd);
  });

  it("schedules two pomodoro cycles in a 60-minute recurring window", () => {
    const tasks: Task[] = [];
    const fixedEvents: FixedEvent[] = [];
    const recurringEvents: FixedEvent[] = [
      {
        id: "rec-long",
        dayPlanId: "day-1",
        title: "Deep routine",
        startTimeIso: "2026-04-25T12:00:00",
        endTimeIso: "2026-04-25T13:00:00",
      },
    ];

    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1", recurringEvents);
    const recurringFocusBlocks = result.blocks.filter(
      (block) => block.blockType === "focus" && block.sourceDailyRecurringId === "rec-long",
    );
    const recurringBreakBlocks = result.blocks.filter(
      (block) => block.blockType === "break" && block.startTimeIso >= recurringEvents[0].startTimeIso,
    );

    expect(recurringFocusBlocks).toHaveLength(2);
    expect(recurringBreakBlocks.length).toBeGreaterThanOrEqual(2);
    expect(new Date(recurringFocusBlocks[1].startTimeIso).getTime() - new Date(recurringFocusBlocks[0].startTimeIso).getTime()).toBe(
      30 * 60_000,
    );
  });

  it("respects a custom day planning window", () => {
    const tasks = [makeTask("a", "Windowed work", 1)];
    const fixedEvents: FixedEvent[] = [];
    const result = generatePlan("2026-04-25", tasks, fixedEvents, "day-1", [], {
      dayStartTimeHhmm: "10:00",
      dayEndTimeHhmm: "12:00",
    });
    const focus = result.blocks.find((block) => block.blockType === "focus");
    expect(focus?.startTimeIso).toBe(new Date("2026-04-25T10:00:00").toISOString());
  });
});
