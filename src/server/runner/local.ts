import { execFile, spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildHarnessPayload,
  describeProcessFailure,
  MEMORY_LIMIT_MB,
  overallBudgetMs,
  parseHarnessOutput,
} from "./protocol";
import type { CodeRunner, RunRequest, RunResponse } from "./types";

const MAX_CAPTURE_BYTES = 64 * 1024;
const MAX_RESULTS_BYTES = 64 * 1024 * 1024;
const MEMORY_POLL_MS = 100;

export const HARNESS_PATH = path.join(process.cwd(), "runner", "harness.py");

type Isolation = "sandbox-exec" | "unshare" | "none";

let isolationCache: Isolation | null = null;

/** Pick the strongest network isolation this OS offers without root. */
function detectIsolation(python: string): Isolation {
  if (isolationCache) return isolationCache;
  isolationCache = "none";
  if (process.platform === "darwin") {
    const probe = spawnSync(
      "/usr/bin/sandbox-exec",
      ["-p", "(version 1)(allow default)(deny network*)", python, "-c", "pass"],
      { timeout: 10_000 },
    );
    if (probe.status === 0) isolationCache = "sandbox-exec";
  } else if (process.platform === "linux") {
    const probe = spawnSync(
      "unshare",
      ["--net", "--map-root-user", python, "-c", "pass"],
      { timeout: 10_000 },
    );
    if (probe.status === 0) isolationCache = "unshare";
  }
  if (isolationCache === "none" && process.env.NODE_ENV !== "test") {
    console.warn(
      "[LocalRunner] OS-level network isolation unavailable; relying on the in-process block only.",
    );
  }
  return isolationCache;
}

function sandboxProfile(workdir: string): string {
  const dir = workdir.replace(/["\\]/g, "");
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    "(deny process-fork)",
    "(deny file-write*)",
    `(allow file-write* (subpath "${dir}") (literal "/dev/null") (literal "/dev/tty"))`,
  ].join("");
}

/** Small counting semaphore so a burst of requests can't fork-bomb the dev box. */
class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;
  constructor(private readonly limit: number) {}
  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    return () => {
      this.active--;
      this.queue.shift()?.();
    };
  }
}

class CappedBuffer {
  private chunks: Buffer[] = [];
  private size = 0;
  constructor(private readonly cap: number) {}
  push(chunk: Buffer) {
    if (this.size >= this.cap) return;
    const slice = chunk.subarray(0, this.cap - this.size);
    this.chunks.push(slice);
    this.size += slice.length;
  }
  toString() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

/**
 * Runs code in a local Python subprocess. For development and the validator
 * only: it limits time, memory (where the OS honours RLIMIT_AS), output and
 * network, but it is not a security boundary.
 */
export class LocalRunner implements CodeRunner {
  readonly name = "local";
  private readonly python: string;
  private readonly semaphore: Semaphore;

  constructor(opts: { python?: string; concurrency?: number } = {}) {
    this.python = opts.python ?? process.env.PYTHON_BIN ?? "python3";
    this.semaphore = new Semaphore(
      opts.concurrency ?? Number(process.env.LOCAL_RUNNER_CONCURRENCY ?? 4),
    );
  }

  async run(request: RunRequest): Promise<RunResponse> {
    const release = await this.semaphore.acquire();
    const workdir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "realcode-")));
    try {
      return await this.execute(request, workdir);
    } finally {
      release();
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }

  private execute(request: RunRequest, workdir: string): Promise<RunResponse> {
    const resultsPath = path.join(workdir, "results.jsonl");
    const pythonArgs = ["-I", "-S", HARNESS_PATH, resultsPath];
    const isolation = detectIsolation(this.python);
    let command = this.python;
    let args = pythonArgs;
    if (isolation === "sandbox-exec") {
      command = "/usr/bin/sandbox-exec";
      args = ["-p", sandboxProfile(workdir), this.python, ...pythonArgs];
    } else if (isolation === "unshare") {
      command = "unshare";
      args = ["--net", "--map-root-user", this.python, ...pythonArgs];
    }

    const budgetMs = overallBudgetMs(request);
    return new Promise<RunResponse>((resolve, reject) => {
      // Only pass what Python needs: never leak the server's secrets.
      const child = spawn(command, args, {
        cwd: workdir,
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: workdir,
          TMPDIR: workdir,
          LANG: "C.UTF-8",
          PYTHONDONTWRITEBYTECODE: "1",
        } as Record<string, string> as unknown as NodeJS.ProcessEnv,
      });
      const stdout = new CappedBuffer(MAX_CAPTURE_BYTES);
      const stderr = new CappedBuffer(MAX_CAPTURE_BYTES);
      child.stdout.on("data", (c: Buffer) => stdout.push(c));
      child.stderr.on("data", (c: Buffer) => stderr.push(c));
      child.stdin.on("error", () => {});

      let timedOut = false;
      const killGroup = () => {
        try {
          if (child.pid) process.kill(-child.pid, "SIGKILL");
        } catch {
          // Already gone.
        }
      };
      const timer = setTimeout(() => {
        timedOut = true;
        killGroup();
      }, budgetMs);

      // RLIMIT_AS is enforced by the harness on Linux; macOS ignores it, so
      // poll the resident set size instead.
      let memoryExceeded = false;
      const memoryWatch =
        process.platform === "linux"
          ? null
          : setInterval(() => {
              if (!child.pid) return;
              execFile("ps", ["-o", "rss=", "-p", String(child.pid)], (err, out) => {
                const rssKb = Number.parseInt(String(out).trim(), 10);
                if (!err && rssKb > MEMORY_LIMIT_MB * 1024) {
                  memoryExceeded = true;
                  killGroup();
                }
              });
            }, MEMORY_POLL_MS);

      child.on("error", (err) => {
        clearTimeout(timer);
        if (memoryWatch) clearInterval(memoryWatch);
        reject(new Error(`Failed to start Python (${this.python}): ${err.message}`));
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timer);
        if (memoryWatch) clearInterval(memoryWatch);
        killGroup();
        let text = "";
        try {
          const fd = fs.openSync(resultsPath, "r");
          try {
            const buf = Buffer.alloc(Math.min(fs.fstatSync(fd).size, MAX_RESULTS_BYTES));
            fs.readSync(fd, buf, 0, buf.length, 0);
            text = buf.toString("utf8");
          } finally {
            fs.closeSync(fd);
          }
        } catch {
          // No results file: the harness never got going.
        }
        const parsed = parseHarnessOutput(text, request);
        const err = stderr.toString();
        let processError = describeProcessFailure({
          timedOut,
          exitCode,
          signal: timedOut ? null : signal,
          stderr: err,
          budgetMs,
        });
        if (memoryExceeded) {
          processError = `Memory limit of ${MEMORY_LIMIT_MB} MB exceeded`;
        }
        if (!processError && !parsed.loadError && parsed.results.size < request.tests.length) {
          processError = "Your program exited before all tests finished";
        }
        resolve({ ...parsed, processError });
      });

      child.stdin.end(JSON.stringify(buildHarnessPayload(request)));
    });
  }
}
