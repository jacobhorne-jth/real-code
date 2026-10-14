/** Types shared by the API routes and the browser. Nothing here is secret. */

export interface ClientExampleOp {
  /** e.g. `set('A', 'B', 'E')` */
  call: string;
  /** Python repr of the expected return value. */
  expect: string;
}

export interface ClientExample {
  name: string;
  ops: ClientExampleOp[];
}

export interface ClientStage {
  number: number;
  title: string;
  className: string;
  prompt: string;
  /** Methods introduced in this stage. */
  methods: { name: string; signature: string }[];
  examples: ClientExample[];
}

export interface FinishStats {
  totalTimeMs: number;
  submitsPerStage: { stage: number; submits: number }[];
  /** Submits in which at least one earlier stage failed. */
  regressionsHit: number;
}

export interface ClientProblemState {
  problem: {
    id: string;
    title: string;
    difficulty: string;
    timeEstimateMinutes: number;
    language: string;
    stageCount: number;
  };
  starterCode: string;
  /** Highest stage the session may see and submit. */
  unlockedStage: number;
  finished: boolean;
  /** Only unlocked stages, in order. Later stages are never sent. */
  stages: ClientStage[];
  startedAt: number;
  finishedAt: number | null;
  stats: FinishStats | null;
}

export interface PublicTestReport {
  name: string;
  passed: boolean;
  kind: "passed" | "wrong_answer" | "error" | "timeout" | "not_run";
  message: string | null;
  expected: string | null;
  actual: string | null;
  stdout: string;
  elapsedMs: number;
}

export interface RunResponseBody {
  report: {
    stage: number;
    passed: number;
    total: number;
    loadError: string | null;
    tests: PublicTestReport[];
  };
}

export interface StageSubmitReport {
  stage: number;
  passed: number;
  total: number;
  allPassed: boolean;
  regression: boolean;
  wrongAnswers: number;
  errors: number;
  timeouts: number;
  message: string;
}

export interface SubmitResponseBody {
  report: {
    stage: number;
    passed: boolean;
    regressions: number[];
    loadError: string | null;
    stages: StageSubmitReport[];
  };
  /** Set when this submit unlocked a new stage or finished the problem. */
  unlocked: number | null;
  finished: boolean;
  state: ClientProblemState;
}

export interface ApiError {
  error: string;
  code:
    | "bad_request"
    | "invalid_session"
    | "not_found"
    | "rate_limited"
    | "execution_unavailable"
    | "execution_failed"
    | "not_finished"
    | "unauthorized"
    | "server_error";
  retryAfterMs?: number;
}
