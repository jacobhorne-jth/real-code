# Going to production

Locally, RealCode needs no accounts. For production you need four: **Modal** (runs
user code), **Upstash** (rate limits shared across server instances), **Supabase**
(Postgres) and **Vercel** (hosting). Do them in this order; each step gives you
environment variables for the last one.

| Variable | From | Required in production |
| --- | --- | --- |
| `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Modal | Yes. Without them the app refuses to run code |
| `MODAL_APP_NAME`, `MODAL_FUNCTION_NAME` | Modal | No (defaults `realcode-runner`, `run_tests`) |
| `MODAL_ENVIRONMENT` | Modal | Only if you deploy to a non-default Modal environment |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash | Strongly recommended (in-memory limits are per instance) |
| `DATABASE_URL` | Supabase | Yes (SQLite can't persist on Vercel) |
| `DATABASE_POOL_MAX` | you | No (default 5) |
| `ADMIN_PASSWORD` | you | Yes, to use `/admin` (disabled without it) |

`.env.example` documents every variable, including the local-only ones.

## 1. Modal (code execution)

1. Create an account at https://modal.com.
2. Install the CLI and log in (Python 3.10+):
   ```bash
   pip install modal
   modal setup
   ```
3. Deploy the runner from the repository root:
   ```bash
   modal deploy modal_app/runner.py
   ```
   This creates the app `realcode-runner` with the function `run_tests`. It bundles
   `runner/harness.py`, so **redeploy whenever the harness changes**. Each call runs in
   a fresh single-use container with networking blocked, no access to the Modal API,
   1 CPU and a 1 GB memory limit (see the decorator in `modal_app/runner.py`).
   `max_containers=50` caps concurrency and therefore spend; adjust it there.
4. Create an API token: Modal dashboard → Settings → API Tokens → New token (or
   `modal token new`). Keep the token id (`ak-…`) and secret (`as-…`) for
   `MODAL_TOKEN_ID` / `MODAL_TOKEN_SECRET`.
5. Optional local check: put both values in `.env.local`, run `npm run dev` on Node 22+
   (the Modal JavaScript SDK requires it) and press Run in the app. The first call can
   take a few seconds while a container starts.
6. In the Modal dashboard, set a workspace spend limit.

## 2. Upstash (rate limiting)

1. Create an account at https://upstash.com.
2. Create a Redis database (pick the region closest to your Vercel functions).
3. On the database page, under **REST API**, copy `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`.

Limits are defined in `src/server/ratelimit.ts` (`RULES`): Run 20/min per session and
60/min per IP, Submit 8/min per session and 30/min per IP, plus limits on session
creation, feedback and admin login.

## 3. Supabase (Postgres)

1. Create an account and a project at https://supabase.com. Save the database password.
2. Click **Connect** on the project page and copy two connection strings:
   - **Transaction pooler** (port 6543): this is `DATABASE_URL` for Vercel. The app
     already disables prepared statements, which the transaction pooler requires.
   - **Session pooler** or **direct connection** (port 5432): use this one to run
     migrations.
3. Run the migrations from your machine:
   ```bash
   DATABASE_URL="postgresql://postgres.<ref>:<password>@<host>:5432/postgres" npm run db:migrate
   ```
   This creates the tables (`sessions`, `attempts`, `submissions`, `events`, `feedback`)
   and enables row-level security on all of them, so Supabase's public REST API can't
   read them. Re-run it after any schema change (migrations live in `drizzle/pg/`;
   regenerate them with `npm run db:generate` after editing `src/server/db/schema.ts`).
4. Check in Supabase → Table Editor that the five tables exist and show "RLS enabled".

## 4. Vercel (hosting)

1. Make sure the GitHub repository is **private**: hidden tests and reference solutions
   live in `problem-bank/`.
2. Create an account at https://vercel.com and import the repository (framework preset:
   Next.js; no build settings to change).
3. Project → Settings → General → Node.js Version: **22.x** or newer.
4. Project → Settings → Environment Variables: add the variables from the table above
   for Production (and Preview if you want previews to work):
   `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`, `UPSTASH_REDIS_REST_URL`,
   `UPSTASH_REDIS_REST_TOKEN`, `DATABASE_URL` (transaction pooler) and a long random
   `ADMIN_PASSWORD`.
5. Function duration: Submit runs every hidden test for the current and earlier stages
   in one sandbox call; the worst case (many timeouts plus a cold start) is about two
   minutes. The submit route sets `maxDuration = 300` and run sets 60. Keep Fluid
   Compute enabled (the default) so these limits are allowed on your plan.
6. Deploy. The build bundles prompts, test files and the harness; reference solutions,
   hints and the test generator are excluded.

## Pre-launch checklist

- [ ] Repository is private.
- [ ] `modal deploy modal_app/runner.py` done from the commit you are launching.
- [ ] All production variables set in Vercel; `ADMIN_PASSWORD` is long and random.
- [ ] `npm run db:migrate` ran against Supabase; tables show RLS enabled.
- [ ] `npm run validate` and `npm test` pass (CI is green on `main`).
- [ ] End-to-end check against the deployment:
      `BASE_URL=https://<your-deployment> npm run e2e` passes all four stages, detects
      the stage-1 regression and finishes. (It creates one session and one feedback row.)
- [ ] In the browser: Run shows example results, an infinite loop shows a timeout, and
      Submit unlocks the next stage. If Run says code execution is unavailable, the
      Modal variables are missing in that environment.
- [ ] `/admin` asks for a password, rejects a wrong one, and shows the funnel and the
      feedback from the e2e run.
- [ ] Rate limits work across instances: rapid repeated Submits return "Too many
      requests" (needs Upstash).
- [ ] Spend limits set on Modal, Upstash and Vercel.
- [ ] Decide how long to keep feedback emails, and mention their use on the page or in a
      privacy note before collecting them.
