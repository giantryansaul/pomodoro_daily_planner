import { describe, expect, it } from "vitest";
import { generatePlan } from "./planner.js";
import type { FixedEvent, Task } from "./types.js";

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
});
