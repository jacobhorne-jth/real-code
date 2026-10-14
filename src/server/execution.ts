import { gradeTests, pyRepr, type OutcomeKind, type TestOutcome } from "./grading";
import type { Problem, Stage, TestCase } from "./problems/loader";
import type { CodeRunner } from "./runner/types";

export const MAX_CODE_BYTES = 64 * 1024;

/** Detailed result for a visible example test. Safe to send to the browser. */
export interface PublicTestReport {
  name: string;
  passed: boolean;
  kind: OutcomeKind;
  message: string | null;
  expected: string | null;
  actual: string | null;
  stdout: string;
  elapsedMs: number;
}

export interface RunReport {
  stage: number;
  passed: number;
  total: number;
  loadError: string | null;
  tests: PublicTestReport[];
}

/** Counts-only result for one stage's hidden tests. Never contains inputs. */
export interface StageSubmitReport {
  stage: number;
  passed: number;
  total: number;
  allPassed: boolean;
  /** True when this is an earlier stage that now fails. */
  regression: boolean;
  wrongAnswers: number;
  errors: number;
  timeouts: number;
  message: string;
}

export interface SubmitReport {
  stage: number;
  /** Current stage and every earlier stage passed. */
  passed: boolean;
  regressions: number[];
  loadError: string | null;
  /** Current stage first, then earlier stages in descending order. */
  stages: StageSubmitReport[];
}

function toSandboxTests(tests: TestCase[]) {
  return tests.map((t) => ({
    id: t.id,
    timeLimitMs: t.timeLimitMs,
    ops: t.ops.map((o) => ({ op: o.op, args: o.args })),
  }));
}

function stageAt(problem: Problem, stage: number): Stage {
  const s = problem.stages[stage - 1];
  if (!s) throw new Error(`Problem ${problem.id} has no stage ${stage}`);
  return s;
}

export async function runPublicTests(
  runner: CodeRunner,
  problem: Problem,
  stageNumber: number,
  code: string,
): Promise<RunReport> {
  const stage = stageAt(problem, stageNumber);
  const response = await runner.run({
    code,
    className: stage.className,
    tests: toSandboxTests(stage.publicTests),
  });
  const outcomes = gradeTests(stage.publicTests, response);
  const tests = outcomes.map((o) => ({
    name: o.name,
    passed: o.kind === "passed",
    kind: o.kind,
    message: o.message,
    expected: o.kind === "wrong_answer" ? pyRepr(o.expected, 500) : null,
    actual: o.kind === "wrong_answer" ? pyRepr(o.actual, 500) : null,
    stdout: o.stdout,
    elapsedMs: Math.round(o.elapsedMs),
  }));
  return {
    stage: stageNumber,
    passed: tests.filter((t) => t.passed).length,
    total: tests.length,
    loadError: response.loadError,
    tests,
  };
}

function summarizeStage(
  stage: number,
  outcomes: TestOutcome[],
  isCurrent: boolean,
): StageSubmitReport {
  const count = (k: OutcomeKind) => outcomes.filter((o) => o.kind === k).length;
  const passed = count("passed");
  const total = outcomes.length;
  const failing = total - passed;
  const allPassed = failing === 0;
  const regression = !isCurrent && !allPassed;
  const timeouts = count("timeout");
  const errors = count("error") + count("not_run");
  const wrongAnswers = count("wrong_answer");

  let message: string;
  if (isCurrent) {
    message = `Stage ${stage}: passed ${passed}/${total}`;
  } else if (regression) {
    message = `Stage ${stage}: regression detected (${failing} failing)`;
  } else {
    message = `Stage ${stage}: still passing (${passed}/${total})`;
  }
  return { stage, passed, total, allPassed, regression, wrongAnswers, errors, timeouts, message };
}

/**
 * Run the hidden tests for `stageNumber` plus every earlier stage's hidden
 * tests (regression), in one sandbox call.
 */
export async function runSubmission(
  runner: CodeRunner,
  problem: Problem,
  stageNumber: number,
  code: string,
): Promise<SubmitReport> {
  const current = stageAt(problem, stageNumber);
  const stages = problem.stages.slice(0, stageNumber);
  const allTests = stages.flatMap((s) => s.hiddenTests);
  const response = await runner.run({
    code,
    className: current.className,
    tests: toSandboxTests(allTests),
  });
  const outcomes = gradeTests(allTests, response);
  const byId = new Map(outcomes.map((o) => [o.id, o]));

  const reports = stages
    .map((s) =>
      summarizeStage(
        s.number,
        s.hiddenTests.map((t) => byId.get(t.id)!),
        s.number === stageNumber,
      ),
    )
    .reverse();

  return {
    stage: stageNumber,
    passed: reports.every((r) => r.allPassed),
    regressions: reports.filter((r) => r.regression).map((r) => r.stage),
    loadError: response.loadError,
    stages: reports,
  };
}
