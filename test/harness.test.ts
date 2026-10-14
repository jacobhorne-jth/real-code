import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPublicTests, runSubmission } from "@/server/execution";
import { gradeTests, jsonEqual } from "@/server/grading";
import { readProblem, type TestCase } from "@/server/problems/loader";
import { LocalRunner } from "@/server/runner/local";
import { createRunner } from "@/server/runner";
import { CodeExecutionUnavailableError } from "@/server/runner/types";

const runner = new LocalRunner();

const COUNTER = `
class Counter:
    def __init__(self):
        self.n = 0
    def inc(self, by):
        self.n += by
        return self.n
    def get(self):
        return self.n
`;

function test_(name: string, ops: [string, unknown[], unknown][], timeLimitMs = 2000): TestCase {
  return {
    id: name,
    name,
    timeLimitMs,
    ops: ops.map(([op, args, expect]) => ({ op, args, expect })),
  };
}

async function grade(code: string, tests: TestCase[], className = "Counter") {
  const response = await runner.run({
    code,
    className,
    tests: tests.map((t) => ({ id: t.id, timeLimitMs: t.timeLimitMs, ops: t.ops })),
  });
  return { response, outcomes: gradeTests(tests, response) };
}

describe("jsonEqual", () => {
  it("compares structurally and strictly", () => {
    expect(jsonEqual([1, "a", null], [1, "a", null])).toBe(true);
    expect(jsonEqual({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(jsonEqual(true, 1)).toBe(false);
    expect(jsonEqual([1], { 0: 1 })).toBe(false);
    expect(jsonEqual(null, undefined)).toBe(false);
  });
});

describe("harness", () => {
  it("runs each test against a fresh instance", async () => {
    const t = test_("t", [["inc", [2], 2], ["inc", [3], 5]]);
    const { outcomes } = await grade(COUNTER, [t, { ...t, id: "t2" }]);
    expect(outcomes.map((o) => o.kind)).toEqual(["passed", "passed"]);
  });

  it("reports the failing operation with expected vs actual", async () => {
    const { outcomes } = await grade(COUNTER, [
      test_("t", [["inc", [1], 1], ["inc", [1], 3], ["get", [], 2]]),
    ]);
    expect(outcomes[0]).toMatchObject({ kind: "wrong_answer", opIndex: 1, expected: 3, actual: 2 });
    expect(outcomes[0].message).toContain("operation #2: inc(1)");
  });

  it("reports exceptions with the operation that raised", async () => {
    const code = `${COUNTER}\n    def boom(self):\n        return {}["missing"]\n`;
    const { outcomes } = await grade(code, [test_("t", [["inc", [1], 1], ["boom", [], null]])]);
    expect(outcomes[0].kind).toBe("error");
    expect(outcomes[0].message).toMatch(/operation #2: boom\(\) raised KeyError/);
  });

  it("treats a missing method as an error", async () => {
    const { outcomes } = await grade(COUNTER, [test_("t", [["reset", [], null]])]);
    expect(outcomes[0].kind).toBe("error");
    expect(outcomes[0].message).toContain("has no method 'reset'");
  });

  it("reports syntax errors and missing classes as load errors", async () => {
    const t = test_("t", [["get", [], 0]]);
    const syntax = await grade("class Counter:\n    def get(self) return 1\n", [t]);
    expect(syntax.response.loadError).toMatch(/SyntaxError/);
    expect(syntax.outcomes[0].kind).toBe("error");

    const missing = await grade("class Other:\n    pass\n", [t]);
    expect(missing.response.loadError).toContain("Class 'Counter' was not found");
  });

  it("times out an infinite loop without losing the other tests", async () => {
    const code = `${COUNTER}\n    def spin(self):\n        while True:\n            pass\n`;
    const { outcomes } = await grade(code, [
      test_("spin", [["spin", [], null]], 300),
      test_("ok", [["inc", [1], 1]]),
    ]);
    expect(outcomes[0].kind).toBe("timeout");
    expect(outcomes[0].message).toContain("Time limit of 300 ms exceeded");
    expect(outcomes[1].kind).toBe("passed");
  });

  it("still times out code that swallows every exception", async () => {
    const code = `${COUNTER}
    def spin(self):
        while True:
            try:
                while True:
                    pass
            except BaseException:
                pass
`;
    const { outcomes } = await grade(code, [test_("spin", [["spin", [], null]], 200)]);
    expect(["timeout", "not_run"]).toContain(outcomes[0].kind);
    expect(outcomes[0].kind).not.toBe("passed");
  }, 30_000);

  it("captures print output per test", async () => {
    const code = `${COUNTER}\n    def hello(self):\n        print("hi there")\n        return 1\n`;
    const { outcomes } = await grade(code, [test_("t", [["hello", [], 1]])]);
    expect(outcomes[0].stdout).toBe("hi there\n");
  });

  it("marks tests that never ran when the process exits early", async () => {
    const code = `${COUNTER}\n    def leave(self):\n        import os\n        os._exit(0)\n`;
    const { outcomes } = await grade(code, [
      test_("a", [["leave", [], null]]),
      test_("b", [["inc", [1], 1]]),
    ]);
    expect(outcomes.map((o) => o.kind)).toEqual(["not_run", "not_run"]);
  });

  it("never matches values that are not JSON-compatible", async () => {
    const code = `${COUNTER}\n    def s(self):\n        return {1, 2}\n    def t(self):\n        return (1, 2)\n`;
    const { outcomes } = await grade(code, [
      test_("set", [["s", [], [1, 2]]]),
      test_("tuple", [["t", [], [1, 2]]]),
    ]);
    expect(outcomes[0].kind).toBe("wrong_answer");
    expect(outcomes[1].kind).toBe("passed");
  });

  it("stops code that exceeds the memory limit", async () => {
    const code = `${COUNTER}\n    def hog(self):\n        data = b"x" * (1536 * 1024 * 1024)\n        return len(data)\n`;
    const { outcomes } = await grade(code, [test_("t", [["hog", [], 0]], 10_000)]);
    expect(outcomes[0].kind).not.toBe("passed");
    expect(outcomes[0].kind).not.toBe("wrong_answer");
    expect(outcomes[0].message).toMatch(/[Mm]emory/);
  });

  it("does not expose server environment variables", async () => {
    process.env.REALCODE_TEST_SECRET = "s3cret";
    const code = `${COUNTER}\n    def env(self):\n        import os\n        return os.environ.get("REALCODE_TEST_SECRET")\n`;
    const { outcomes } = await grade(code, [test_("t", [["env", [], null]])]);
    delete process.env.REALCODE_TEST_SECRET;
    expect(outcomes[0].kind).toBe("passed");
  });

  it("blocks network access", async () => {
    const code = `${COUNTER}
    def net(self):
        import socket
        try:
            socket.create_connection(("example.com", 80), timeout=2)
            return "connected"
        except BaseException as e:
            return "blocked"
`;
    const { outcomes } = await grade(code, [test_("t", [["net", [], "blocked"]], 5000)]);
    expect(outcomes[0].kind).toBe("passed");
  });

  it("does not let user code forge results for tests it cannot answer", async () => {
    // Writing fake lines to the results file only reports actual values;
    // expected values never enter the sandbox.
    const code = `
import sys
class Counter:
    def get(self):
        with open(sys.argv[1], "a") as f:
            f.write('{"id": "t", "status": "ok", "actuals": [0], "error": null, "stdout": "", "elapsed_ms": 0}\\n')
        return 0
`;
    const { outcomes } = await grade(code, [test_("t", [["get", [], 42]])]);
    expect(outcomes[0].kind).toBe("wrong_answer");
  });
});

describe("runner selection", () => {
  it("refuses to run code in production without Modal", () => {
    expect(() => createRunner({ NODE_ENV: "production" })).toThrow(CodeExecutionUnavailableError);
  });
  it("uses Modal when configured and LocalRunner in development", () => {
    expect(createRunner({ NODE_ENV: "production", MODAL_TOKEN_ID: "a", MODAL_TOKEN_SECRET: "b" }).name).toBe("modal");
    expect(createRunner({ NODE_ENV: "development" }).name).toBe("local");
  });
});

describe("sample problem end to end", () => {
  const problem = readProblem("kv-store");
  const solution = (name: string) =>
    fs.readFileSync(path.join(process.cwd(), "problem-bank/kv-store/solutions", name), "utf8");

  it("shows detailed results for visible tests", async () => {
    const report = await runPublicTests(runner, problem, 1, problem.starterCode);
    expect(report.passed).toBeLessThan(report.total);
    const failed = report.tests.find((t) => !t.passed)!;
    expect(failed.message).toMatch(/operation #\d+/);
  });

  it("detects a stage 1 regression when submitting stage 3", async () => {
    const broken = solution("stage3.py").replace(
      "    def delete(self, key, field):\n        return self.delete_at(key, field, -NEVER)",
      "    def delete(self, key, field):\n        return False",
    );
    expect(broken).not.toBe(solution("stage3.py"));
    const report = await runSubmission(runner, problem, 3, broken);
    expect(report.passed).toBe(false);
    expect(report.regressions).toContain(1);
    const s1 = report.stages.find((s) => s.stage === 1)!;
    expect(s1.message).toMatch(/^Stage 1: regression detected \(\d+ failing\)$/);
    expect(report.stages[0]).toMatchObject({ stage: 3, allPassed: true });
  });

  it("times out an O(n^2) scan but passes the reference at stage 3", async () => {
    const quadratic = solution("stage3.py").replace(
      "        out = record.scan(prefix, timestamp)",
      "        out = sorted(record.scan('', timestamp))\n        out = [s for s in out if s.startswith(prefix)]",
    );
    expect(quadratic).not.toBe(solution("stage3.py"));
    const slow = await runSubmission(runner, problem, 3, quadratic);
    expect(slow.passed).toBe(false);
    expect(slow.stages[0].timeouts).toBeGreaterThan(0);

    const fast = await runSubmission(runner, problem, 3, solution("stage3.py"));
    expect(fast.passed).toBe(true);
  }, 120_000);

  it("never includes hidden inputs in submit reports", async () => {
    const report = await runSubmission(runner, problem, 2, problem.starterCode);
    const json = JSON.stringify(report);
    for (const t of problem.stages[1].hiddenTests) {
      expect(json).not.toContain(t.name);
    }
    expect(json).not.toMatch(/operation #/);
  });
});
