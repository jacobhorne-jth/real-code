/** One operation sent into the sandbox. Expected values never leave the server. */
export interface SandboxOp {
  op: string;
  args: unknown[];
}

export interface SandboxTest {
  id: string;
  timeLimitMs: number;
  ops: SandboxOp[];
}

export interface RunRequest {
  code: string;
  className: string;
  tests: SandboxTest[];
}

export type RawStatus = "ok" | "error" | "timeout";

/** What the harness reports for one test: actual return values, not verdicts. */
export interface RawTestResult {
  id: string;
  status: RawStatus;
  actuals: unknown[];
  error: string | null;
  stdout: string;
  elapsedMs: number;
}

export interface RunResponse {
  /** Set when the code could not be loaded (syntax error, missing class...). */
  loadError: string | null;
  /** Results keyed by test id. Tests missing from the map never finished. */
  results: Map<string, RawTestResult>;
  /** Why tests are missing, e.g. the process was killed for exceeding its budget. */
  processError: string | null;
}

export interface CodeRunner {
  readonly name: string;
  run(request: RunRequest): Promise<RunResponse>;
}

export class CodeExecutionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeExecutionUnavailableError";
  }
}
