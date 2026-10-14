import type { ClientProblemState, ClientStage, FinishStats } from "@/lib/api-types";
import { formatCall, pyRepr } from "./grading";
import type { Problem, Stage } from "./problems/loader";

function toClientStage(stage: Stage): ClientStage {
  return {
    number: stage.number,
    title: stage.title,
    className: stage.className,
    prompt: stage.prompt,
    methods: stage.newMethods.map((m) => ({ name: m.name, signature: m.signature })),
    examples: stage.publicTests.map((t) => ({
      name: t.name,
      ops: t.ops.map((o) => ({ call: formatCall(o.op, o.args), expect: pyRepr(o.expect, 500) })),
    })),
  };
}

/**
 * The only way problem content reaches the browser. Includes stages
 * 1..unlockedStage and their public tests; hidden tests, solutions and
 * anything about later stages are never included.
 */
export function buildClientState(
  problem: Problem,
  progress: { unlockedStage: number; finished: boolean },
  attempt: { startedAt: number; finishedAt: number | null },
  stats: FinishStats | null,
): ClientProblemState {
  const visible = Math.max(1, Math.min(progress.unlockedStage, problem.stages.length));
  return {
    problem: {
      id: problem.id,
      title: problem.title,
      difficulty: problem.difficulty,
      timeEstimateMinutes: problem.timeEstimateMinutes,
      language: problem.language,
      stageCount: problem.stages.length,
    },
    starterCode: problem.starterCode,
    unlockedStage: visible,
    finished: progress.finished,
    stages: problem.stages.slice(0, visible).map(toClientStage),
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    stats: progress.finished ? stats : null,
  };
}
