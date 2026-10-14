/**
 * End-to-end check against a running server (npm run dev in another terminal):
 *
 *   npm run e2e                       # http://localhost:3000, problem kv-store
 *   BASE_URL=https://... npm run e2e -- my-problem
 *
 * Passes every stage with the reference solutions, checks that locked stages
 * never appear in responses, and checks that breaking a stage-1 behaviour is
 * reported as a regression. Uses only the public HTTP API.
 */
import fs from "node:fs";
import path from "node:path";
import { readProblem } from "../src/server/problems/loader";

const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const problemId = process.argv[2] ?? "kv-store";
const problem = readProblem(problemId);
const solution = (n: number) =>
  fs.readFileSync(path.join(process.cwd(), "problem-bank", problemId, "solutions", `stage${n}.py`), "utf8");

let failures = 0;
function check(ok: boolean, label: string) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
}

async function post(url: string, body: unknown): Promise<{ status: number; text: string; json: any }> {
  const res = await fetch(BASE + url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, text, json };
}

function leaksFutureStages(text: string, unlocked: number): string | null {
  for (const stage of problem.stages.slice(unlocked)) {
    if (text.includes(stage.prompt.slice(0, 40))) return `stage ${stage.number} prompt`;
    for (const m of stage.newMethods) {
      if (new RegExp(`\\b${m.name}\\b`).test(text)) return `stage ${stage.number} method ${m.name}`;
    }
  }
  return null;
}

/** Break a stage-1 behaviour: delete() always claims the field was missing. */
function breakStageOne(code: string): string {
  const out = code.replace(/(\n    def delete\(self, key, field\):\n)/, "$1        return False\n");
  if (out === code) throw new Error("could not find delete() to break");
  return out;
}

async function main() {
  console.log(`E2E against ${BASE} (${problemId})\n`);

  const page = await fetch(`${BASE}/problems/${problemId}`);
  const html = await page.text();
  check(page.status === 200, "problem page loads");
  check(leaksFutureStages(html, 1) === null && !html.includes(problem.stages[0].prompt.slice(0, 40)),
    "page HTML contains no stage content (it is fetched after load)");

  const session = await post("/api/session", {});
  check(session.status === 200, "session created");
  const sessionId: string = session.json.sessionId;
  const url = (action: string) => `/api/problems/${problemId}/${action}`;

  const start = await post(url("start"), { sessionId });
  check(start.status === 200 && start.json.state.unlockedStage === 1, "starts at stage 1");
  check(leaksFutureStages(start.text, 1) === null, "start response has no locked-stage content");

  const run = await post(url("run"), { sessionId, code: start.json.state.starterCode });
  const failed = run.json.report.tests.find((t: any) => !t.passed);
  check(run.status === 200 && failed && /operation #\d+/.test(failed.message ?? ""),
    "Run reports which operation failed for the starter code");

  for (const stage of problem.stages) {
    const n = stage.number;
    const code = solution(n);

    const runRes = await post(url("run"), { sessionId, code });
    check(runRes.json.report.passed === runRes.json.report.total,
      `stage ${n}: Run passes ${runRes.json.report.passed}/${runRes.json.report.total} examples`);

    if (n >= 2) {
      const broken = await post(url("submit"), { sessionId, code: breakStageOne(code) });
      const s1 = broken.json.report.stages.find((s: any) => s.stage === 1);
      check(
        broken.json.report.passed === false && broken.json.report.regressions.includes(1) && s1.regression,
        `stage ${n}: breaking stage-1 delete() is caught → "${s1?.message}"`,
      );
      check(broken.json.unlocked === null, `stage ${n}: a failed submit unlocks nothing`);
      check(!/operation #/.test(broken.text), `stage ${n}: hidden-test failures show counts only`);
    }

    const submit = await post(url("submit"), { sessionId, code });
    const lines = submit.json.report.stages.map((s: any) => s.message).join(" · ");
    check(submit.json.report.passed === true, `stage ${n}: Submit passes → ${lines}`);
    const unlocked = submit.json.state.unlockedStage;
    if (n < problem.stages.length) {
      check(submit.json.unlocked === n + 1, `stage ${n}: unlocks stage ${n + 1}`);
      check(leaksFutureStages(submit.text, unlocked) === null, `stage ${n}: response has no stage ${n + 2}+ content`);
    } else {
      check(submit.json.finished === true, "final stage: problem finished");
      const stats = submit.json.state.stats;
      check(Boolean(stats) && stats.totalTimeMs >= 0, `finish stats: ${JSON.stringify(stats)}`);
    }
  }

  const feedback = await post(url("feedback"), {
    sessionId,
    feedback: "E2E check: felt realistic.",
    email: "e2e@example.com",
  });
  check(feedback.status === 200, "feedback and email accepted");

  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll end-to-end checks passed.");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
