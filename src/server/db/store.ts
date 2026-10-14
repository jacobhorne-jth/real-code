import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDatabase } from "./client";

export type EventType =
  | "problem_started"
  | "run"
  | "submit"
  | "stage_unlocked"
  | "problem_finished"
  | "feedback_submitted"
  | "email_submitted";

export interface AttemptRow {
  sessionId: string;
  problemId: string;
  startedAt: number;
  finishedAt: number | null;
}

export interface SubmissionRow {
  stage: number;
  passed: boolean;
  regressionCount: number;
  createdAt: number;
}

const attemptId = (sessionId: string, problemId: string) => `${sessionId}:${problemId}`;

export async function createSession(): Promise<string> {
  const { db, t } = await getDatabase();
  const id = randomUUID();
  await db.insert(t.sessions).values({ id, createdAt: Date.now() });
  return id;
}

export async function sessionExists(id: string): Promise<boolean> {
  const { db, t } = await getDatabase();
  const rows = await db.select({ id: t.sessions.id }).from(t.sessions).where(eq(t.sessions.id, id)).limit(1);
  return rows.length > 0;
}

export async function getAttempt(sessionId: string, problemId: string): Promise<AttemptRow | null> {
  const { db, t } = await getDatabase();
  const rows = await db
    .select()
    .from(t.attempts)
    .where(eq(t.attempts.id, attemptId(sessionId, problemId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Create the attempt if it doesn't exist. Returns it and whether it is new. */
export async function ensureAttempt(
  sessionId: string,
  problemId: string,
): Promise<{ attempt: AttemptRow; created: boolean }> {
  const { db, t } = await getDatabase();
  const inserted = await db
    .insert(t.attempts)
    .values({
      id: attemptId(sessionId, problemId),
      sessionId,
      problemId,
      startedAt: Date.now(),
      finishedAt: null,
    })
    .onConflictDoNothing()
    .returning({ id: t.attempts.id });
  const attempt = await getAttempt(sessionId, problemId);
  if (!attempt) throw new Error("attempt missing after insert");
  return { attempt, created: inserted.length > 0 };
}

export async function markAttemptFinished(sessionId: string, problemId: string): Promise<void> {
  const { db, t } = await getDatabase();
  await db
    .update(t.attempts)
    .set({ finishedAt: Date.now() })
    .where(and(eq(t.attempts.id, attemptId(sessionId, problemId)), sql`${t.attempts.finishedAt} is null`));
}

export async function recordSubmission(row: {
  sessionId: string;
  problemId: string;
  stage: number;
  passed: boolean;
  regressionCount: number;
  report: unknown;
}): Promise<void> {
  const { db, t } = await getDatabase();
  await db.insert(t.submissions).values({
    id: randomUUID(),
    sessionId: row.sessionId,
    problemId: row.problemId,
    stage: row.stage,
    passed: row.passed,
    regressionCount: row.regressionCount,
    report: JSON.stringify(row.report),
    createdAt: Date.now(),
  });
}

export async function listSubmissions(sessionId: string, problemId: string): Promise<SubmissionRow[]> {
  const { db, t } = await getDatabase();
  return db
    .select({
      stage: t.submissions.stage,
      passed: t.submissions.passed,
      regressionCount: t.submissions.regressionCount,
      createdAt: t.submissions.createdAt,
    })
    .from(t.submissions)
    .where(and(eq(t.submissions.sessionId, sessionId), eq(t.submissions.problemId, problemId)))
    .orderBy(t.submissions.createdAt);
}

export async function logEvent(e: {
  type: EventType;
  sessionId: string;
  problemId?: string | null;
  stage?: number | null;
  data?: unknown;
}): Promise<void> {
  try {
    const { db, t } = await getDatabase();
    await db.insert(t.events).values({
      id: randomUUID(),
      sessionId: e.sessionId,
      problemId: e.problemId ?? null,
      type: e.type,
      stage: e.stage ?? null,
      data: e.data === undefined ? null : JSON.stringify(e.data),
      createdAt: Date.now(),
    });
  } catch (err) {
    // Analytics must never break the product.
    console.error("[analytics] failed to log event", e.type, err);
  }
}

export async function saveFeedback(row: {
  sessionId: string;
  problemId: string;
  feedback: string | null;
  email: string | null;
}): Promise<void> {
  const { db, t } = await getDatabase();
  await db.insert(t.feedback).values({ id: randomUUID(), ...row, createdAt: Date.now() });
}

// ---------------------------------------------------------------- admin

export interface FunnelRow {
  problemId: string;
  started: number;
  /** passedStages[i] = sessions that passed stage i + 1. */
  passedStages: number[];
  emailLeft: number;
}

export async function getFunnel(problemId: string, stageCount: number): Promise<FunnelRow> {
  const { db, t } = await getDatabase();
  const distinctSessions = sql<number>`count(distinct ${t.events.sessionId})`;
  const count = async (type: EventType, stage?: number) => {
    const conditions = [eq(t.events.type, type), eq(t.events.problemId, problemId)];
    if (stage !== undefined) conditions.push(eq(t.events.stage, stage));
    const rows = await db.select({ n: distinctSessions }).from(t.events).where(and(...conditions));
    return Number(rows[0]?.n ?? 0);
  };

  const started = await count("problem_started");
  const passedStages: number[] = [];
  for (let stage = 1; stage <= stageCount; stage++) {
    // Passing stage N unlocks N + 1; passing the last stage finishes the problem.
    passedStages.push(
      stage < stageCount ? await count("stage_unlocked", stage + 1) : await count("problem_finished"),
    );
  }
  const emailLeft = await count("email_submitted");
  return { problemId, started, passedStages, emailLeft };
}

export interface FeedbackRow {
  id: string;
  problemId: string;
  sessionId: string;
  feedback: string | null;
  email: string | null;
  createdAt: number;
}

export async function listFeedback(limit = 200): Promise<FeedbackRow[]> {
  const { db, t } = await getDatabase();
  return db.select().from(t.feedback).orderBy(desc(t.feedback.createdAt)).limit(limit);
}
