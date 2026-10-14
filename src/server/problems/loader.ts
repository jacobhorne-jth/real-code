import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { problemConfigSchema, testFileSchema } from "./schema";

export interface Method {
  name: string;
  signature: string;
}

export interface TestOp {
  op: string;
  args: unknown[];
  expect: unknown;
}

export interface TestCase {
  /** Stable id, e.g. "s2-hidden-4". */
  id: string;
  name: string;
  timeLimitMs: number;
  ops: TestOp[];
}

export interface Stage {
  number: number;
  title: string;
  className: string;
  /** Methods introduced in this stage. */
  newMethods: Method[];
  /** Everything callable at this stage: this stage's methods plus all earlier ones. */
  interface: Method[];
  prompt: string;
  publicTests: TestCase[];
  hiddenTests: TestCase[];
}

export interface Problem {
  id: string;
  title: string;
  difficulty: string;
  timeEstimateMinutes: number;
  language: string;
  starterCode: string;
  stages: Stage[];
}

export interface ProblemSummary {
  id: string;
  title: string;
  difficulty: string;
  timeEstimateMinutes: number;
  stageCount: number;
}

export class ProblemFormatError extends Error {
  constructor(problemId: string, message: string) {
    super(`[${problemId}] ${message}`);
    this.name = "ProblemFormatError";
  }
}

const PROBLEM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function problemBankDir(): string {
  return process.env.PROBLEM_BANK_DIR
    ? path.resolve(process.env.PROBLEM_BANK_DIR)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), "problem-bank");
}

export function isValidProblemId(id: string): boolean {
  return PROBLEM_ID.test(id);
}

function readText(problemId: string, file: string): string {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new ProblemFormatError(problemId, `missing file ${path.basename(path.dirname(file))}/${path.basename(file)}`);
  }
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

function readTests(
  problemId: string,
  dir: string,
  stage: number,
  kind: "public" | "hidden",
  defaultLimit: number,
): TestCase[] {
  const rel = `tests/stage${stage}_${kind}.json`;
  let raw: unknown;
  try {
    raw = JSON.parse(readText(problemId, path.join(dir, rel)));
  } catch (err) {
    if (err instanceof ProblemFormatError) throw err;
    throw new ProblemFormatError(problemId, `${rel} is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = testFileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProblemFormatError(problemId, `${rel} is malformed: ${formatZodError(parsed.error)}`);
  }
  return parsed.data.map((t, i) => ({
    id: `s${stage}-${kind}-${i + 1}`,
    name: t.name,
    timeLimitMs: t.time_limit_ms ?? defaultLimit,
    ops: t.ops.map((o) => ({ op: o.op, args: o.args, expect: o.expect ?? null })),
  }));
}

/** Read and validate a problem from disk. Throws ProblemFormatError on any problem. */
export function readProblem(problemId: string, bankDir = problemBankDir()): Problem {
  if (!isValidProblemId(problemId)) throw new ProblemFormatError(problemId, "invalid problem id");
  const dir = path.join(bankDir, problemId);
  let configRaw: unknown;
  try {
    configRaw = YAML.parse(readText(problemId, path.join(dir, "problem.yaml")));
  } catch (err) {
    if (err instanceof ProblemFormatError) throw err;
    throw new ProblemFormatError(problemId, `problem.yaml is not valid YAML: ${(err as Error).message}`);
  }
  const parsed = problemConfigSchema.safeParse(configRaw);
  if (!parsed.success) {
    throw new ProblemFormatError(problemId, `problem.yaml is invalid: ${formatZodError(parsed.error)}`);
  }
  const config = parsed.data;

  const stages: Stage[] = [];
  const cumulative: Method[] = [];
  config.stages.forEach((s, i) => {
    const number = i + 1;
    for (const m of s.methods) {
      if (cumulative.some((c) => c.name === m.name)) {
        throw new ProblemFormatError(problemId, `stage ${number} redefines method '${m.name}'`);
      }
      cumulative.push(m);
    }
    stages.push({
      number,
      title: s.title,
      className: s.class_name ?? config.class_name,
      newMethods: s.methods,
      interface: [...cumulative],
      prompt: readText(problemId, path.join(dir, `stage${number}.md`)),
      publicTests: readTests(problemId, dir, number, "public", config.default_time_limit_ms),
      hiddenTests: readTests(problemId, dir, number, "hidden", config.default_time_limit_ms),
    });
  });

  return {
    id: problemId,
    title: config.title,
    difficulty: config.difficulty,
    timeEstimateMinutes: config.time_estimate_minutes,
    language: config.language,
    starterCode: readText(problemId, path.join(dir, "starter.py")),
    stages,
  };
}

export function listProblemIds(bankDir = problemBankDir()): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bankDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && isValidProblemId(e.name))
    .filter((e) => fs.existsSync(path.join(bankDir, e.name, "problem.yaml")))
    .map((e) => e.name)
    .sort();
}

const cache = new Map<string, Problem>();

/** Cached problem lookup for the app. Returns null for unknown ids. */
export function getProblem(problemId: string): Problem | null {
  if (!isValidProblemId(problemId)) return null;
  const useCache = process.env.NODE_ENV === "production";
  if (useCache && cache.has(problemId)) return cache.get(problemId)!;
  if (!listProblemIds().includes(problemId)) return null;
  const problem = readProblem(problemId);
  if (useCache) cache.set(problemId, problem);
  return problem;
}

export function listProblems(): ProblemSummary[] {
  return listProblemIds().flatMap((id) => {
    try {
      const p = getProblem(id);
      return p
        ? [{
            id: p.id,
            title: p.title,
            difficulty: p.difficulty,
            timeEstimateMinutes: p.timeEstimateMinutes,
            stageCount: p.stages.length,
          }]
        : [];
    } catch (err) {
      console.error(err);
      return [];
    }
  });
}
