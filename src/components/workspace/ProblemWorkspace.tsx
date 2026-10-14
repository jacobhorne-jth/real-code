"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Play, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ClientProblemState, FinishStats } from "@/lib/api-types";
import { api, ApiRequestError } from "@/lib/client-api";
import {
  clearSessionId,
  loadProblemProgress,
  loadSessionId,
  saveProblemProgress,
  saveSessionId,
  type LocalProblemProgress,
} from "@/lib/storage";
import { CodeEditor } from "./CodeEditor";
import { FinishScreen } from "./FinishScreen";
import { ResultsPanel, type ResultState } from "./ResultsPanel";
import { StagePanel } from "./StagePanel";
import { Timer } from "./Timer";

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

async function ensureSession(): Promise<string> {
  const existing = loadSessionId();
  if (existing) return existing;
  const { sessionId } = await api.createSession();
  saveSessionId(sessionId);
  return sessionId;
}

/** Open the problem, replacing a stale session (e.g. after a database reset) once. */
async function openProblem(problemId: string): Promise<{ sessionId: string; state: ClientProblemState }> {
  let sessionId = await ensureSession();
  try {
    return { sessionId, state: (await api.start(problemId, sessionId)).state };
  } catch (err) {
    if (!(err instanceof ApiRequestError && err.body.code === "invalid_session")) throw err;
    clearSessionId();
    sessionId = await ensureSession();
    return { sessionId, state: (await api.start(problemId, sessionId)).state };
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.body.code === "execution_unavailable") {
      return `Code execution is unavailable on this server. ${err.message}`;
    }
    return err.message;
  }
  return "Something went wrong. Please try again.";
}

export function ProblemWorkspace({ problemId }: { problemId: string }) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [state, setState] = useState<ClientProblemState | null>(null);
  const [code, setCode] = useState("");
  const [selectedStage, setSelectedStage] = useState(1);
  const [result, setResult] = useState<ResultState>({ type: "idle" });
  const [showFinish, setShowFinish] = useState(false);
  const [local, setLocal] = useState<LocalProblemProgress | null>(null);

  // Mirror browser-side progress into localStorage whenever it changes.
  useEffect(() => {
    if (local) saveProblemProgress(problemId, local);
  }, [local, problemId]);

  useEffect(() => {
    let cancelled = false;
    openProblem(problemId)
      .then(({ sessionId, state }) => {
        if (cancelled) return;
        const saved = loadProblemProgress(problemId);
        const sameSession = saved?.sessionId === sessionId;
        const initial: LocalProblemProgress = {
          sessionId,
          code: sameSession ? saved.code : state.starterCode,
          startedAt: state.startedAt,
          finishedAt: state.finishedAt,
          unlockedStage: state.unlockedStage,
          submitsPerStage: sameSession ? saved.submitsPerStage : {},
          regressionsHit: sameSession ? saved.regressionsHit : 0,
          updatedAt: Date.now(),
        };
        setLocal(initial);
        setSessionId(sessionId);
        setState(state);
        setCode(initial.code);
        setSelectedStage(state.unlockedStage);
        setShowFinish(state.finished);
        setStatus({ kind: "ready" });
      })
      .catch((err) => {
        if (!cancelled) setStatus({ kind: "error", message: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [problemId]);

  // Save code as the user types (debounced).
  useEffect(() => {
    if (status.kind !== "ready") return;
    const id = setTimeout(
      () => setLocal((prev) => (prev && prev.code !== code ? { ...prev, code, updatedAt: Date.now() } : prev)),
      300,
    );
    return () => clearTimeout(id);
  }, [code, status.kind]);

  const busy = result.type === "running";

  async function run() {
    if (!sessionId || busy) return;
    setResult({ type: "running", action: "run" });
    try {
      const body = await api.run(problemId, sessionId, code);
      setResult({ type: "run", body });
    } catch (err) {
      setResult({ type: "error", message: errorMessage(err) });
    }
  }

  async function submit() {
    if (!sessionId || busy || !state) return;
    setResult({ type: "running", action: "submit" });
    try {
      const body = await api.submit(problemId, sessionId, code);
      const stage = String(body.report.stage);
      setLocal((prev) =>
        prev && {
          ...prev,
          code,
          submitsPerStage: { ...prev.submitsPerStage, [stage]: (prev.submitsPerStage[stage] ?? 0) + 1 },
          regressionsHit: prev.regressionsHit + (body.report.regressions.length > 0 ? 1 : 0),
          unlockedStage: body.state.unlockedStage,
          finishedAt: body.state.finishedAt,
          updatedAt: Date.now(),
        },
      );
      setState(body.state);
      setResult({ type: "submit", body });
      if (body.unlocked) setSelectedStage(body.unlocked);
      if (body.finished) setShowFinish(true);
    } catch (err) {
      setResult({ type: "error", message: errorMessage(err) });
    }
  }

  if (status.kind === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Loading problem…
      </div>
    );
  }
  if (status.kind === "error" || !state || !sessionId) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <p className="text-sm text-red-700">{status.kind === "error" ? status.message : "Could not load."}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }

  if (showFinish && state.finished) {
    // The server's numbers are authoritative; the local copy is a fallback.
    const stats: FinishStats = state.stats ?? {
      totalTimeMs: (state.finishedAt ?? state.startedAt) - state.startedAt,
      submitsPerStage: Array.from({ length: state.problem.stageCount }, (_, i) => ({
        stage: i + 1,
        submits: local?.submitsPerStage[String(i + 1)] ?? 0,
      })),
      regressionsHit: local?.regressionsHit ?? 0,
    };
    return (
      <FinishScreen
        problemId={problemId}
        problemTitle={state.problem.title}
        sessionId={sessionId}
        stats={stats}
        onBack={() => setShowFinish(false)}
      />
    );
  }

  return (
    <div className="flex min-h-dvh flex-col lg:h-dvh">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          RealCode
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="truncate text-sm font-medium">{state.problem.title}</h1>
        <Badge variant="outline" className="hidden sm:inline-flex">
          {state.problem.difficulty}
        </Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {state.finished
            ? "All stages passed"
            : `Stage ${state.unlockedStage} of ${state.problem.stageCount}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {state.finished && (
            <Button size="sm" variant="outline" onClick={() => setShowFinish(true)}>
              Results
            </Button>
          )}
          <Timer startedAt={state.startedAt} finishedAt={state.finishedAt} />
        </div>
      </header>

      <div className="grid flex-1 grid-cols-1 lg:min-h-0 lg:grid-cols-[minmax(340px,2fr)_3fr]">
        <aside className="border-b lg:min-h-0 lg:border-r lg:border-b-0">
          <StagePanel
            stages={state.stages}
            stageCount={state.problem.stageCount}
            unlockedStage={state.unlockedStage}
            finished={state.finished}
            selected={selectedStage}
            onSelect={setSelectedStage}
          />
        </aside>

        <section className="flex h-[90dvh] flex-col lg:h-auto lg:min-h-0">
          <div className="min-h-0 flex-1">
            <CodeEditor value={code} onChange={setCode} />
          </div>
          <div className="flex items-center gap-2 border-y px-3 py-2">
            <span className="text-xs text-muted-foreground">Python 3</span>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" onClick={run} disabled={busy}>
                {busy && result.action === "run" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Play aria-hidden />
                )}
                Run
              </Button>
              <Button onClick={submit} disabled={busy}>
                {busy && result.action === "submit" ? (
                  <Loader2 className="animate-spin" aria-hidden />
                ) : (
                  <Send aria-hidden />
                )}
                Submit
              </Button>
            </div>
          </div>
          <div className="h-[38%] min-h-40">
            <ResultsPanel result={result} />
          </div>
        </section>
      </div>
    </div>
  );
}
