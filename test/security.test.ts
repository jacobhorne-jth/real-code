import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClientProblemState, SubmitResponseBody } from "@/lib/api-types";
import { readProblem, type Problem } from "@/server/problems/loader";
import { buildClientState } from "@/server/views";

const problem: Problem = readProblem("kv-store");
const solutionsDir = path.join(process.cwd(), "problem-bank/kv-store/solutions");
const solution = (n: number) => fs.readFileSync(path.join(solutionsDir, `stage${n}.py`), "utf8");

/** Assert that nothing belonging to stages after `unlocked` is in `json`. */
function expectNoFutureContent(json: string, unlocked: number) {
  for (const stage of problem.stages) {
    if (stage.number <= unlocked) {
      expect(json).toContain(JSON.stringify(stage.prompt).slice(1, 60));
      continue;
    }
    expect(json).not.toContain(stage.prompt.slice(0, 40));
    expect(json).not.toContain(stage.title);
    for (const m of stage.newMethods) {
      expect(json).not.toMatch(new RegExp(`\\b${m.name}\\b`));
    }
    for (const t of [...stage.publicTests, ...stage.hiddenTests]) {
      expect(json).not.toContain(t.name);
    }
  }
}

function expectNoSecrets(json: string) {
  const publicNames = new Set(problem.stages.flatMap((s) => s.publicTests.map((t) => t.name)));
  for (const stage of problem.stages) {
    for (const t of stage.hiddenTests) {
      if (!publicNames.has(t.name)) expect(json).not.toContain(t.name);
    }
  }
  // Reference solution internals.
  expect(json).not.toContain("bisect");
  expect(json).not.toContain("backup_times");
}

describe("client state never includes locked stages", () => {
  for (let unlocked = 1; unlocked <= problem.stages.length; unlocked++) {
    it(`with stage ${unlocked} unlocked`, () => {
      const state = buildClientState(
        problem,
        { unlockedStage: unlocked, finished: false },
        { startedAt: 0, finishedAt: null },
        null,
      );
      expect(state.stages.map((s) => s.number)).toEqual(
        Array.from({ length: unlocked }, (_, i) => i + 1),
      );
      const json = JSON.stringify(state);
      expectNoFutureContent(json, unlocked);
      expectNoSecrets(json);
    });
  }

  it("clamps out-of-range progress", () => {
    const state = buildClientState(problem, { unlockedStage: 99, finished: false }, { startedAt: 0, finishedAt: null }, null);
    expect(state.stages).toHaveLength(problem.stages.length);
    const none = buildClientState(problem, { unlockedStage: 0, finished: false }, { startedAt: 0, finishedAt: null }, null);
    expect(none.stages).toHaveLength(1);
  });
});

describe("API: unlocks follow server-side submit results", () => {
  let tmp: string;
  let routes: {
    session: typeof import("@/app/api/session/route");
    start: typeof import("@/app/api/problems/[id]/start/route");
    run: typeof import("@/app/api/problems/[id]/run/route");
    submit: typeof import("@/app/api/problems/[id]/submit/route");
    feedback: typeof import("@/app/api/problems/[id]/feedback/route");
  };
  let ipCounter = 0;

  beforeAll(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "realcode-test-"));
    process.env.SQLITE_PATH = path.join(tmp, "test.db");
    delete process.env.DATABASE_URL;
    const { resetDatabaseForTests } = await import("@/server/db/client");
    await resetDatabaseForTests();
    routes = {
      session: await import("@/app/api/session/route"),
      start: await import("@/app/api/problems/[id]/start/route"),
      run: await import("@/app/api/problems/[id]/run/route"),
      submit: await import("@/app/api/problems/[id]/submit/route"),
      feedback: await import("@/app/api/problems/[id]/feedback/route"),
    };
  });

  afterAll(async () => {
    const { resetDatabaseForTests } = await import("@/server/db/client");
    await resetDatabaseForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const request = (body: unknown, ip?: string) =>
    new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip ?? `10.0.0.${++ipCounter}` },
      body: JSON.stringify(body),
    });
  const ctx = (id = "kv-store") => ({ params: Promise.resolve({ id }) });

  async function newSession(): Promise<string> {
    const res = await routes.session.POST(request({}));
    expect(res.status).toBe(200);
    return ((await res.json()) as { sessionId: string }).sessionId;
  }

  async function start(sessionId: string): Promise<{ state: ClientProblemState; raw: string }> {
    const res = await routes.start.POST(request({ sessionId }), ctx());
    expect(res.status).toBe(200);
    const raw = await res.text();
    return { state: (JSON.parse(raw) as { state: ClientProblemState }).state, raw };
  }

  async function submit(sessionId: string, code: string, extra: Record<string, unknown> = {}) {
    const res = await routes.submit.POST(request({ sessionId, code, ...extra }), ctx());
    expect(res.status).toBe(200);
    const raw = await res.text();
    return { body: JSON.parse(raw) as SubmitResponseBody, raw };
  }

  it("walks all four stages, revealing each only after a passing submit", async () => {
    const sessionId = await newSession();

    const first = await start(sessionId);
    expect(first.state.unlockedStage).toBe(1);
    expectNoFutureContent(first.raw, 1);
    expectNoSecrets(first.raw);

    // Run shows details for visible tests only.
    const run = await routes.run.POST(request({ sessionId, code: first.state.starterCode }), ctx());
    expect(run.status).toBe(200);

    // A failing submit unlocks nothing.
    const failing = await submit(sessionId, first.state.starterCode);
    expect(failing.body.report.passed).toBe(false);
    expect(failing.body.unlocked).toBeNull();
    expectNoFutureContent(failing.raw, 1);
    expectNoSecrets(failing.raw);

    // The client can't pick the stage: a forged stage field is ignored, and
    // code that would pass stage 4 only unlocks the next stage.
    const forged = await submit(sessionId, solution(4), { stage: 4, unlockedStage: 4 });
    expect(forged.body.report.stage).toBe(1);
    expect(forged.body.unlocked).toBe(2);
    expect(forged.body.state.unlockedStage).toBe(2);
    expectNoFutureContent(forged.raw, 2);
    expectNoSecrets(forged.raw);

    const s2 = await submit(sessionId, solution(2));
    expect(s2.body.report.stage).toBe(2);
    expect(s2.body.unlocked).toBe(3);
    expectNoFutureContent(s2.raw, 3);

    const s3 = await submit(sessionId, solution(3));
    expect(s3.body.unlocked).toBe(4);
    expectNoFutureContent(s3.raw, 4);
    expect(s3.body.state.finished).toBe(false);

    const s4 = await submit(sessionId, solution(4));
    expect(s4.body.report.passed).toBe(true);
    expect(s4.body.finished).toBe(true);
    expect(s4.body.state.finished).toBe(true);
    expect(s4.body.state.stats?.submitsPerStage.map((s) => s.submits)).toEqual([2, 1, 1, 1]);
    expectNoSecrets(s4.raw);

    // Reloading keeps progress, derived from stored results.
    const again = await start(sessionId);
    expect(again.state.finished).toBe(true);

    const fb = await routes.feedback.POST(
      request({ sessionId, feedback: "Felt real.", email: "me@example.com" }),
      ctx(),
    );
    expect(fb.status).toBe(200);
  }, 120_000);

  it("a different session starts from stage 1", async () => {
    const other = await newSession();
    const { state } = await start(other);
    expect(state.unlockedStage).toBe(1);
    expect(state.stages).toHaveLength(1);
  });

  it("rejects feedback before the problem is finished", async () => {
    const sessionId = await newSession();
    await start(sessionId);
    const res = await routes.feedback.POST(request({ sessionId, feedback: "hi" }), ctx());
    expect(res.status).toBe(403);
  });

  it("rejects unknown sessions, unknown problems and path tricks", async () => {
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await routes.start.POST(request({ sessionId: unknown }), ctx())).status).toBe(401);
    expect((await routes.start.POST(request({ sessionId: "not-a-uuid" }), ctx())).status).toBe(400);
    const sessionId = await newSession();
    expect((await routes.start.POST(request({ sessionId }), ctx("nope"))).status).toBe(404);
    expect((await routes.start.POST(request({ sessionId }), ctx("../problem-bank"))).status).toBe(404);
  });

  it("rejects oversized code", async () => {
    const sessionId = await newSession();
    const res = await routes.run.POST(request({ sessionId, code: "x".repeat(70 * 1024) }), ctx());
    expect([400, 413]).toContain(res.status);
  });

  it("rate-limits submits per session and per IP", async () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await routes.submit.POST(request({ sessionId, code: "" }), ctx());
      statuses.push(res.status);
    }
    expect(statuses).toContain(429);

    const statusesIp: number[] = [];
    for (let i = 0; i < 40; i++) {
      const sid = `22222222-2222-4222-8222-${String(i).padStart(12, "0")}`;
      const res = await routes.submit.POST(request({ sessionId: sid, code: "" }, "203.0.113.9"), ctx());
      statusesIp.push(res.status);
    }
    expect(statusesIp).toContain(429);
  });
});
