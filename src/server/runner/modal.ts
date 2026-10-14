import {
  buildHarnessPayload,
  describeProcessFailure,
  overallBudgetMs,
  parseHarnessOutput,
} from "./protocol";
import type { CodeRunner, RunRequest, RunResponse } from "./types";

/** Shape returned by `run_tests` in modal_app/runner.py. */
interface ModalRunOutput {
  results: string;
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
}

interface ModalFunction {
  remote(args?: unknown[]): Promise<unknown>;
}

/**
 * Executes code on Modal: each call gets a fresh single-use container with
 * networking blocked (see modal_app/runner.py).
 */
export class ModalRunner implements CodeRunner {
  readonly name = "modal";
  private fn: Promise<ModalFunction> | null = null;

  constructor(
    private readonly opts: {
      tokenId: string;
      tokenSecret: string;
      appName?: string;
      functionName?: string;
      environment?: string;
    },
  ) {}

  private getFunction(): Promise<ModalFunction> {
    if (!this.fn) {
      this.fn = (async () => {
        const { ModalClient } = await import("modal");
        const client = new ModalClient({
          tokenId: this.opts.tokenId,
          tokenSecret: this.opts.tokenSecret,
          environment: this.opts.environment,
        });
        return client.functions.fromName(
          this.opts.appName ?? "realcode-runner",
          this.opts.functionName ?? "run_tests",
        );
      })();
      // Let a failed lookup be retried on the next request.
      this.fn.catch(() => {
        this.fn = null;
      });
    }
    return this.fn;
  }

  async run(request: RunRequest): Promise<RunResponse> {
    const budgetMs = overallBudgetMs(request);
    const fn = await this.getFunction();
    const raw = await fn.remote([
      JSON.stringify({ payload: buildHarnessPayload(request), timeout_ms: budgetMs }),
    ]);
    if (typeof raw !== "string") throw new Error("Unexpected response from Modal runner");
    const out = JSON.parse(raw) as ModalRunOutput;
    const parsed = parseHarnessOutput(out.results ?? "", request);
    let processError = describeProcessFailure({
      timedOut: Boolean(out.timed_out),
      exitCode: out.exit_code,
      signal: out.exit_code !== null && out.exit_code < 0 ? `signal ${-out.exit_code}` : null,
      stderr: out.stderr ?? "",
      budgetMs,
    });
    if (!processError && !parsed.loadError && parsed.results.size < request.tests.length) {
      processError = "Your program exited before all tests finished";
    }
    return { ...parsed, processError };
  }
}
