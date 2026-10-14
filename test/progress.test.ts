import { describe, expect, it } from "vitest";
import { computeFinishStats, computeProgress } from "@/server/progress";

const sub = (stage: number, passed: boolean, regressionCount = 0) => ({ stage, passed, regressionCount });

describe("stage unlock logic", () => {
  it("starts at stage 1 with no submissions", () => {
    expect(computeProgress(4, [])).toEqual({ passedStage: 0, unlockedStage: 1, finished: false });
  });

  it("failed submits unlock nothing", () => {
    expect(computeProgress(4, [sub(1, false), sub(1, false)]).unlockedStage).toBe(1);
  });

  it("each passing submit unlocks the next stage", () => {
    expect(computeProgress(4, [sub(1, false), sub(1, true)]).unlockedStage).toBe(2);
    expect(computeProgress(4, [sub(1, true), sub(2, true), sub(3, false, 1)]).unlockedStage).toBe(3);
  });

  it("requires every earlier stage to have passed", () => {
    // A stray pass at stage 3 without stage 2 must not unlock anything beyond 2.
    expect(computeProgress(4, [sub(1, true), sub(3, true)])).toMatchObject({ passedStage: 1, unlockedStage: 2 });
  });

  it("finishes after the last stage and never goes past it", () => {
    const all = [sub(1, true), sub(2, true), sub(3, true), sub(4, true)];
    expect(computeProgress(4, all)).toEqual({ passedStage: 4, unlockedStage: 4, finished: true });
    expect(computeProgress(4, [...all, sub(5, true)]).unlockedStage).toBe(4);
  });

  it("computes finish stats", () => {
    const subs = [sub(1, false), sub(1, true), sub(2, true), sub(3, false, 1), sub(3, false, 2), sub(3, true), sub(4, true)];
    expect(computeFinishStats(4, subs, 1_000, 61_000)).toEqual({
      totalTimeMs: 60_000,
      submitsPerStage: [
        { stage: 1, submits: 2 },
        { stage: 2, submits: 1 },
        { stage: 3, submits: 3 },
        { stage: 4, submits: 1 },
      ],
      regressionsHit: 2,
    });
  });
});
