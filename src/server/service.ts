import "server-only";
import type { ClientProblemState, SubmitResponseBody } from "@/lib/api-types";
import {
  ensureAttempt,
  getAttempt,
  listSubmissions,
  logEvent,
  markAttemptFinished,
  recordSubmission,
  saveFeedback,
} from "./db/store";
import { runPublicTests, runSubmission, type RunReport } from "./execution";
import type { Problem } from "./problems/loader";
import { computeFinishStats, computeProgress } from "./progress";
import { fail } from "./api";
import { CodeExecutionUnavailableError, getRunner } from "./runner";
import { buildClientState } from "./views";

export async function loadState(sessionId: string, problem: Problem): Promise<ClientProblemState> {
  const { attempt } = await ensureAttempt(sessionId, problem.id);
  const submissions = await listSubmissions(sessionId, problem.id);
  const progress = computeProgress(problem.stages.length, submissions);
  const stats =
    progress.finished && attempt.finishedAt
      ? computeFinishStats(problem.stages.length, submissions, attempt.startedAt, attempt.finishedAt)
      : null;
  return buildClientState(problem, progress, attempt, stats);
}

/** Opening a problem: creates the attempt (starting the clock) on first visit. */
export async function startProblem(sessionId: string, problem: Problem): Promise<ClientProblemState> {
  const { created } = await ensureAttempt(sessionId, problem.id);
  if (created) await logEvent({ type: "problem_started", sessionId, problemId: problem.id, stage: 1 });
  return loadState(sessionId, problem);
}

/** Surface runner infrastructure failures as a clean 502 instead of a 500. */
async function execute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CodeExecutionUnavailableError) throw err;
    console.error("[runner]", err);
    fail(502, "execution_failed", "The code runner failed. Please try again in a moment.");
  }
}

async function currentStage(sessionId: string, problem: Problem) {
  await ensureAttempt(sessionId, problem.id);
  return computeProgress(problem.stages.length, await listSubmissions(sessionId, problem.id));
}

/** Run the visible examples for the stage the server says is current. */
export async function runCode(sessionId: string, problem: Problem, code: string): Promise<RunReport> {
  const progress = await currentStage(sessionId, problem);
  const runner = getRunner();
  const report = await execute(() => runPublicTests(runner, problem, progress.unlockedStage, code));
  await logEvent({
    type: "run",
    sessionId,
    problemId: problem.id,
    stage: progress.unlockedStage,
    data: { passed: report.passed, total: report.total, loadError: Boolean(report.loadError) },
  });
  return report;
}

/**
 * Run hidden tests for the current stage plus all earlier stages. Passing
 * unlocks the next stage; the stage is chosen by the server, never the client.
 */
export async function submitCode(
  sessionId: string,
  problem: Problem,
  code: string,
): Promise<SubmitResponseBody> {
  const before = await currentStage(sessionId, problem);
  const stage = before.unlockedStage;
  const runner = getRunner();
  const report = await execute(() => runSubmission(runner, problem, stage, code));

  await recordSubmission({
    sessionId,
    problemId: problem.id,
    stage,
    passed: report.passed,
    regressionCount: report.regressions.length,
    report,
  });
  await logEvent({
    type: "submit",
    sessionId,
    problemId: problem.id,
    stage,
    data: {
      passed: report.passed,
      regressions: report.regressions,
      stages: report.stages.map((s) => ({ stage: s.stage, passed: s.passed, total: s.total })),
    },
  });

  let unlocked: number | null = null;
  let finished = false;
  if (report.passed && !before.finished) {
    if (stage < problem.stages.length) {
      unlocked = stage + 1;
      await logEvent({ type: "stage_unlocked", sessionId, problemId: problem.id, stage: unlocked });
    } else {
      finished = true;
      await markAttemptFinished(sessionId, problem.id);
      await logEvent({ type: "problem_finished", sessionId, problemId: problem.id, stage });
    }
  }

  return { report, unlocked, finished, state: await loadState(sessionId, problem) };
}

export class NotFinishedError extends Error {}

export async function submitFeedback(
  sessionId: string,
  problem: Problem,
  input: { feedback: string | null; email: string | null },
): Promise<void> {
  const attempt = await getAttempt(sessionId, problem.id);
  const progress = computeProgress(problem.stages.length, await listSubmissions(sessionId, problem.id));
  if (!attempt || !progress.finished) throw new NotFinishedError("Finish the problem first");

  await saveFeedback({ sessionId, problemId: problem.id, ...input });
  if (input.feedback) {
    await logEvent({ type: "feedback_submitted", sessionId, problemId: problem.id });
  }
  if (input.email) {
    await logEvent({ type: "email_submitted", sessionId, problemId: problem.id });
  }
}
