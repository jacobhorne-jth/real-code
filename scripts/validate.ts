/**
 * Validates every problem in problem-bank/ (see README "Validating problems").
 *
 *   npm run validate              # all problems
 *   npm run validate -- kv-store  # just one
 *
 * Exits non-zero if any check fails. Uses LocalRunner, so no keys are needed.
 */
import fs from "node:fs";
import path from "node:path";
import { runPublicTests, runSubmission } from "../src/server/execution";
import {
  listProblemIds,
  problemBankDir,
  readProblem,
  type Problem,
} from "../src/server/problems/loader";
import { LocalRunner } from "../src/server/runner/local";

const REQUIRED_STAGES = 4;

type Check = { name: string; ok: boolean; detail?: string };

const color = process.stdout.isTTY
  ? { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` }
  : { red: (s: string) => s, green: (s: string) => s, dim: (s: string) => s };

/** Number of parameters (excluding self) in "name(self, a: int, b: str) -> X". */
export function signatureArity(signature: string): { name: string; arity: number } | null {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*(->.*)?$/.exec(signature);
  if (!m) return null;
  const params: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of m[2]) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());
  const rest = params.filter((p, i) => !(i === 0 && p === "self"));
  return { name: m[1], arity: rest.length };
}

function checkStructure(problem: Problem, dir: string): Check[] {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail?: string) => checks.push({ name, ok, detail });

  add(
    `has ${REQUIRED_STAGES} stages`,
    problem.stages.length === REQUIRED_STAGES,
    `found ${problem.stages.length}`,
  );
  for (const file of ["hints.md", "starter.py"]) {
    add(`${file} exists`, fs.existsSync(path.join(dir, file)));
  }
  for (const stage of problem.stages) {
    add(`solutions/stage${stage.number}.py exists`, fs.existsSync(path.join(dir, "solutions", `stage${stage.number}.py`)));
    const naiveRequired = stage.number < problem.stages.length;
    if (naiveRequired) {
      add(
        `solutions/naive_stage${stage.number}.py exists`,
        fs.existsSync(path.join(dir, "solutions", `naive_stage${stage.number}.py`)),
      );
    }
  }

  const first = problem.stages[0];
  add(
    `starter.py defines class ${first.className}`,
    new RegExp(`^class\\s+${first.className}\\b`, "m").test(problem.starterCode),
  );
  const future = problem.stages.slice(1).flatMap((s) => s.newMethods.map((m) => m.name));
  const leaked = future.filter((name) => new RegExp(`\\b${name}\\b`).test(problem.starterCode));
  add(
    "starter.py does not reveal later stages' methods",
    leaked.length === 0,
    leaked.length ? `mentions ${leaked.join(", ")}` : undefined,
  );

  for (const stage of problem.stages) {
    for (const m of stage.newMethods) {
      const parsed = signatureArity(m.signature);
      add(
        `stage ${stage.number}: signature of ${m.name} is well-formed`,
        parsed !== null && parsed.name === m.name,
        m.signature,
      );
    }
    const arity = new Map(stage.interface.map((m) => [m.name, signatureArity(m.signature)?.arity]));
    for (const kind of ["public", "hidden"] as const) {
      const tests = kind === "public" ? stage.publicTests : stage.hiddenTests;
      const problems: string[] = [];
      for (const t of tests) {
        t.ops.forEach((op, i) => {
          if (!arity.has(op.op)) {
            problems.push(`"${t.name}" op #${i + 1}: '${op.op}' is not in the stage ${stage.number} interface`);
          } else if (arity.get(op.op) !== op.args.length) {
            problems.push(
              `"${t.name}" op #${i + 1}: ${op.op} takes ${arity.get(op.op)} args, got ${op.args.length}`,
            );
          }
        });
      }
      add(
        `stage ${stage.number} ${kind} tests use only interface methods with correct arity`,
        problems.length === 0,
        problems.slice(0, 5).join("\n"),
      );
    }
  }
  return checks;
}

function failureSummary(stages: { stage: number; passed: number; total: number; wrongAnswers: number; errors: number; timeouts: number }[]) {
  return stages
    .filter((s) => s.passed < s.total)
    .map((s) => `stage ${s.stage}: ${s.passed}/${s.total} (wrong ${s.wrongAnswers}, errors ${s.errors}, timeouts ${s.timeouts})`)
    .join("; ");
}

async function checkSolutions(problem: Problem, dir: string, runner: LocalRunner): Promise<Check[]> {
  const last = problem.stages.length;
  const read = (file: string) => {
    const p = path.join(dir, "solutions", file);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  };

  const jobs = problem.stages.flatMap((stage) => {
    const n = stage.number;
    const list: Promise<Check>[] = [];

    const reference = read(`stage${n}.py`);
    if (reference !== null) {
      list.push(
        (async () => {
          const issues: string[] = [];
          for (let k = 1; k <= n; k++) {
            const pub = await runPublicTests(runner, problem, k, reference);
            if (pub.passed !== pub.total) {
              const bad = pub.tests.find((t) => !t.passed);
              issues.push(
                `stage ${k} public ${pub.passed}/${pub.total}${pub.loadError ? `: ${pub.loadError}` : bad ? `: "${bad.name}" ${bad.message ?? ""}` : ""}`,
              );
            }
          }
          const hidden = await runSubmission(runner, problem, n, reference);
          if (!hidden.passed) issues.push(hidden.loadError ?? failureSummary(hidden.stages));
          return {
            name: `solutions/stage${n}.py passes public + hidden tests for stages 1-${n}`,
            ok: issues.length === 0,
            detail: issues.join("\n"),
          };
        })(),
      );
    }

    const naive = read(`naive_stage${n}.py`);
    if (naive !== null) {
      list.push(
        (async () => {
          const own = await runSubmission(runner, problem, n, naive);
          const pub = await runPublicTests(runner, problem, n, naive);
          const passesOwn = own.passed && pub.passed === pub.total;
          const checks: Check[] = [];
          checks.push({
            name: `solutions/naive_stage${n}.py passes stage ${n}`,
            ok: passesOwn,
            detail: own.loadError ?? failureSummary(own.stages),
          });
          if (n < last) {
            const later = await runSubmission(runner, problem, last, naive);
            const laterStages = later.stages.filter((s) => s.stage > n);
            const failsLater = laterStages.some((s) => !s.allPassed);
            checks.push({
              name: `solutions/naive_stage${n}.py fails a hidden test in a later stage`,
              ok: failsLater,
              detail: failsLater
                ? failureSummary(laterStages)
                : "it passes every later stage: the later stages don't force a design change",
            });
          }
          return checks;
        })().then((c) => ({
          name: c.map((x) => x.name).join(" | "),
          ok: c.every((x) => x.ok),
          detail: c.filter((x) => !x.ok).map((x) => `${x.name}: ${x.detail}`).join("\n") ||
            c.map((x) => x.detail).filter(Boolean).join("; "),
        })),
      );
    }
    return list;
  });
  return Promise.all(jobs);
}

async function main() {
  const bank = problemBankDir();
  const requested = process.argv.slice(2);
  const ids = requested.length ? requested : listProblemIds(bank);
  if (ids.length === 0) {
    console.error(color.red(`No problems found in ${bank}`));
    process.exit(1);
  }

  const runner = new LocalRunner({ concurrency: Number(process.env.LOCAL_RUNNER_CONCURRENCY ?? 4) });
  let failed = 0;

  for (const id of ids) {
    console.log(`\n${id}`);
    const dir = path.join(bank, id);
    let problem: Problem;
    try {
      problem = readProblem(id, bank);
      console.log(`  ${color.green("✓")} problem.yaml, prompts and test JSON are well-formed`);
    } catch (err) {
      console.log(`  ${color.red("✗")} ${(err as Error).message}`);
      failed++;
      continue;
    }

    const started = Date.now();
    const checks = [...checkStructure(problem, dir), ...(await checkSolutions(problem, dir, runner))];
    for (const c of checks) {
      if (c.ok) {
        console.log(`  ${color.green("✓")} ${c.name}${c.detail && c.name.includes("fails") ? color.dim(` (${c.detail})`) : ""}`);
      } else {
        failed++;
        console.log(`  ${color.red("✗")} ${c.name}`);
        if (c.detail) console.log(c.detail.split("\n").map((l) => `      ${l}`).join("\n"));
      }
    }
    console.log(color.dim(`  (${((Date.now() - started) / 1000).toFixed(1)}s)`));
  }

  if (failed > 0) {
    console.error(color.red(`\nValidation FAILED: ${failed} check(s) failed.`));
    process.exit(1);
  }
  console.log(color.green(`\nAll ${ids.length} problem(s) valid.`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
