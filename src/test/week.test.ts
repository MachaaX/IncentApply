import { describe, expect, it } from "vitest";
import { getTimeRemainingToSettlement, getWeekWindow } from "../utils/week";

describe("week utilities", () => {
  it("uses previous Friday as week start on Thursday", () => {
    const now = new Date("2026-02-12T15:00:00.000Z");
    const window = getWeekWindow(now, "America/New_York");
    expect(window.weekId).toBe("2026-02-06");
  });

  it("rolls to new week on Friday", () => {
    const now = new Date("2026-02-13T15:00:00.000Z");
    const window = getWeekWindow(now, "America/New_York");
    expect(window.weekId).toBe("2026-02-13");
  });

  it("never returns negative countdown", () => {
    const now = new Date("2026-02-13T00:00:00.000Z");
    const countdown = getTimeRemainingToSettlement(now, "UTC");
    expect(countdown.totalMs).toBeGreaterThanOrEqual(0);
  });
});
