# RealCode

Practice for multi-stage coding interviews where the requirements change as you go.
You open a problem and see only Stage 1. You write one Python class. Each time you
pass a stage, the next prompt appears and you keep editing the same code, while
hidden regression tests check that earlier behaviour still works.

- **Run** runs the visible example tests for the current stage and shows the failing
  operation, expected vs. actual, and printed output.
- **Submit** runs the hidden tests for the current stage plus every earlier stage, e.g.
  `Stage 3: passed 18/20 · Stage 1: regression detected (2 failing)`. Hidden tests
  report counts only, never inputs.
- Passing Submit unlocks the next stage. A timer runs from first load across all
  stages. The finish screen shows total time, submits per stage, regressions hit, a
  feedback question and an optional email field.

For production setup (Modal, Upstash, Supabase, Vercel), see [SETUP.md](SETUP.md).

## Local setup

Requirements: Node.js 20+ (22+ if you want to use the Modal runner locally) and
Python 3.10+ on your `PATH` as `python3`.

```bash
npm install
npm run dev
```

Open http://localhost:3000. No accounts or keys are needed: with no environment
variables set, the app uses

| Service        | Local fallback                                   | Production                     |
| -------------- | ------------------------------------------------ | ------------------------------ |
| Code execution | `LocalRunner`: Python subprocess on this machine | `ModalRunner` (Modal)          |
| Rate limiting  | In-memory sliding window                         | Upstash Redis                  |
| Database       | SQLite file at `.data/realcode.db` (auto-migrated) | Postgres via `DATABASE_URL` |

Each implementation is picked from environment variables; see
[.env.example](.env.example) for every variable. To override anything locally, copy
it to `.env.local`.

The admin page is at http://localhost:3000/admin (password `dev` locally).

### Useful commands

| Command              | What it does                                                    |
| -------------------- | --------------------------------------------------------------- |
| `npm run dev`        | Start the app                                                   |
| `npm test`           | Unit and integration tests (harness, unlock logic, security)    |
| `npm run validate`   | Validate every problem in `problem-bank/` (see below)           |
| `npm run e2e`        | Drive a running server through all stages with the reference solutions |
| `npm run lint` / `npm run typecheck` | Static checks                                   |
| `npm run db:migrate` | Apply migrations (Postgres if `DATABASE_URL` is set, else SQLite) |
| `npm run db:generate`| Regenerate migrations after changing `src/server/db/schema.ts`  |

## Project layout

```
problem-bank/<id>/         problems (pure data; no problem-specific code in the app)
runner/harness.py          runs operation sequences against the user's class
modal_app/runner.py        the Modal function that runs the harness in production
src/server/runner/         CodeRunner interface, LocalRunner, ModalRunner
src/server/grading.ts      compares actual return values with expected ones
src/server/execution.ts    Run (public tests) and Submit (hidden + regression)
src/server/progress.ts     stage-unlock logic, derived from stored submit results
src/server/views.ts        the only code that turns a problem into browser data
src/server/db/             Drizzle schema (SQLite + Postgres), store, migrations in drizzle/
src/server/ratelimit.ts    Upstash and in-memory rate limiters
src/app/                   pages, API routes and /admin
scripts/validate.ts        the problem validator
```

## How code is run and graded

1. The server builds a payload with the user's code and the **operations only**
   (method names and arguments). Expected values never enter the sandbox.
2. `runner/harness.py` loads the code, instantiates a fresh object per test, calls each
   operation in order, and writes the actual return values. A per-test timer (which
   keeps firing even if user code catches it) enforces each test's time limit; a crash,
   timeout or missing method counts as a failure with a clear message.
3. The server compares actual values to expected ones (`grading.ts`). Because grading
   happens outside the sandbox, user code that tampers with the harness can at most
   misreport its own return values.

`LocalRunner` adds a wall-clock limit for the whole process, a temp working directory,
a minimal environment (no server secrets), output caps, a memory limit (`RLIMIT_AS` on
Linux; RSS polling on macOS, which ignores it) and network isolation where the OS
allows it (`sandbox-exec` on macOS, `unshare --net` on Linux when unprivileged user
namespaces are available, plus an in-process socket block). **It is not a security
boundary**: with `NODE_ENV=production` and no Modal tokens, the app refuses to run code
and returns a clear error. In production, each call runs in a fresh single-use Modal
container with networking blocked.

## Adding a problem

Create `problem-bank/<problem-id>/` (lowercase letters, digits and dashes). The app
discovers it automatically.

```
problem.yaml
stage1.md … stage4.md     prompts (Markdown)
starter.py                initial code; must not mention later stages' methods
hints.md                  not shown in the app
tests/stageN_public.json  visible examples for stage N (shown to the user)
tests/stageN_hidden.json  hidden tests for stage N
solutions/stageN.py       reference solution that passes stages 1..N
solutions/naive_stageN.py most obvious solution for stage N that a later stage breaks
```

### problem.yaml

```yaml
title: In-Memory Key-Value Store
difficulty: Medium            # Easy | Medium | Hard
time_estimate_minutes: 90
language: python
class_name: InMemoryDB        # can be overridden per stage with class_name
default_time_limit_ms: 2000   # per test, unless the test sets time_limit_ms
stages:
  - title: Basic records
    methods:                  # methods ADDED in this stage
      - name: set
        signature: "set(self, key: str, field: str, value: str) -> None"
  - title: Scanning fields
    methods:
      - name: scan
        signature: "scan(self, key: str) -> list[str]"
  # ... one entry per stage
```

A stage's interface is its own methods plus every earlier stage's.

### Test files

Each test file is a JSON array of tests. Each test runs against a fresh instance:

```json
[
  {
    "name": "set, get and delete",
    "time_limit_ms": 2000,
    "ops": [
      {"op": "set", "args": ["A", "B", "E"], "expect": null},
      {"op": "get", "args": ["A", "B"], "expect": "E"}
    ]
  }
]
```

`time_limit_ms` is optional. Return values are compared as JSON: tuples equal lists,
`True` does not equal `1`, and values JSON can't represent (sets, objects) never match.
Performance tests are just long operation sequences with a time limit; pick sizes so a
quadratic solution clearly times out and an O(n log n) one passes with a wide margin.
Test names in hidden files are never shown to users, but keep them descriptive for the
validator output.

The sample problem's tests are produced by
`problem-bank/kv-store/tools/generate_tests.py`, which computes expected values with a
deliberately brute-force model written independently of the reference solutions. Any
problem can do the same, or the JSON can be written by hand.

## Validating problems

```bash
npm run validate              # every problem
npm run validate -- kv-store  # one problem
```

For every problem, the validator checks that:

1. `problem.yaml`, the prompts and all test JSON files are well-formed, every operation
   exists in that stage's interface, and argument counts match the signatures.
2. `solutions/stageN.py` passes the public and hidden tests for stages 1 through N.
3. `solutions/naive_stageN.py` passes stage N but fails at least one hidden test in a
   later stage, proving each later stage forces a real design change.
4. The problem has 4 stages, required files exist, and `starter.py` defines the class
   without revealing later stages' method names.

It exits non-zero on any failure and uses `LocalRunner`, so it needs no keys. CI
(`.github/workflows/ci.yml`) runs lint, typecheck, tests and the validator on every push.

## Decisions made where the spec was open

- **Sessions.** The server creates a random session id (`POST /api/session`), the
  browser keeps it in localStorage, and the server stores every submit result. What a
  session has unlocked is derived only from those stored results; the client never says
  which stage it is on. Run and Submit always use the server's current stage, and an
  unknown session id is rejected (the browser then starts a new session).
- **Stage visibility.** The browser receives stages 1..current only (prompt, new
  methods, public examples). Locked stages are shown as numbered, locked tabs with no
  title. The problem page's HTML contains no stage content at all; it is fetched from
  the API after load.
- **Hidden tests include the public examples**, so passing Submit implies the examples
  pass too.
- **After finishing**, Run and Submit keep working against stage 4, and the finish
  screen can be reopened from the header.
- **Timer.** It starts when the server first records the attempt (first load) and keeps
  counting across reloads and closed tabs until the last stage passes; total time on the
  finish screen comes from the server.
- **"Regressions hit"** counts submits in which at least one earlier stage failed.
- **Feedback and email** are accepted only after the problem is finished, and only
  stored (no email is sent).
- **Naive solution for the last stage** is optional, since there is no later stage for
  it to fail. If present, the validator checks that it passes.
- **Stage count.** The app handles any number of stages; the validator requires 4.
- **Sample problem, stage 3.** A test uses either the stage 1–2 methods or the
  timestamped `_at` methods, never both, which keeps "no timestamp" semantics simple.
  Its hidden tests include two 2-second scale tests: the reference solution runs them in
  well under 0.1 s locally, while rescanning the record per prefix scan takes over 20 s
  and sweeping all fields per operation about 4 s.
- **Monaco** is loaded by `@monaco-editor/react` from the jsDelivr CDN.
- **Analytics** are rows in the `events` table: `problem_started`, `run`, `submit`
  (with per-stage results), `stage_unlocked`, `problem_finished`, `feedback_submitted`,
  `email_submitted`. The funnel counts distinct sessions per step.
- **Admin auth** is a password form that sets an HttpOnly cookie derived from
  `ADMIN_PASSWORD`. Without `ADMIN_PASSWORD` in production, `/admin` is disabled.
- **Postgres row-level security** is enabled on every table by a migration (no policies),
  so Supabase's public REST API can't read them; the app connects as the table owner.
