import type { FinishStats } from "@/lib/api-types";

export interface SubmissionSummary {
  stage: number;
  passed: boolean;
  regressionCount: number;
}

export interface Progress {
  /** Highest stage N such that stages 1..N all have a passing submission. */
  passedStage: number;
  /** The stage the session is working on (and the only one it may submit). */
  unlockedStage: number;
  finished: boolean;
}

/**
 * Derive what a session has unlocked purely from its recorded submit results.
 * Nothing the client sends is trusted here.
 */
export function computeProgress(stageCount: number, submissions: SubmissionSummary[]): Progress {
  const passed = new Set(submissions.filter((s) => s.passed).map((s) => s.stage));
  let passedStage = 0;
  while (passedStage < stageCount && passed.has(passedStage + 1)) passedStage++;
  return {
    passedStage,
    unlockedStage: Math.min(passedStage + 1, stageCount),
    finished: passedStage === stageCount,
  };
}

export function computeFinishStats(
  stageCount: number,
  submissions: SubmissionSummary[],
  startedAt: number,
  finishedAt: number,
): FinishStats {
  const submitsPerStage = Array.from({ length: stageCount }, (_, i) => ({
    stage: i + 1,
    submits: submissions.filter((s) => s.stage === i + 1).length,
  }));
  return {
    totalTimeMs: Math.max(finishedAt - startedAt, 0),
    submitsPerStage,
    regressionsHit: submissions.filter((s) => s.regressionCount > 0).length,
  };
}
