"use client";

import { AlertTriangle, CheckCircle2, CircleX, Loader2, Unlock } from "lucide-react";
import type { RunResponseBody, StageSubmitReport, SubmitResponseBody } from "@/lib/api-types";
import { cn } from "@/lib/utils";

export type ResultState =
  | { type: "idle" }
  | { type: "running"; action: "run" | "submit" }
  | { type: "run"; body: RunResponseBody }
  | { type: "submit"; body: SubmitResponseBody }
  | { type: "error"; message: string };

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 className="size-4 shrink-0 text-emerald-600" aria-label="passed" />
  ) : (
    <CircleX className="size-4 shrink-0 text-red-600" aria-label="failed" />
  );
}

function Pre({ children, className }: { children: string; className?: string }) {
  return (
    <pre
      className={cn(
        "mt-1 max-h-48 overflow-auto rounded border bg-muted/40 px-2 py-1.5 font-mono text-xs whitespace-pre-wrap break-words",
        className,
      )}
    >
      {children}
    </pre>
  );
}

function RunResults({ body }: { body: RunResponseBody }) {
  const { report } = body;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <StatusIcon ok={report.passed === report.total} />
        Stage {report.stage} examples: {report.passed}/{report.total} passed
      </div>
      {report.loadError && <Pre className="text-red-700">{report.loadError}</Pre>}
      {!report.loadError && (
        <ul className="space-y-2">
          {report.tests.map((t) => (
            <li key={t.name} className="rounded-md border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <StatusIcon ok={t.passed} />
                <span className="font-medium">{t.name}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{t.elapsedMs} ms</span>
              </div>
              {!t.passed && t.message && <p className="mt-1.5 font-mono text-xs text-red-700">{t.message}</p>}
              {t.expected !== null && (
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Expected</div>
                    <Pre>{t.expected}</Pre>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Your output</div>
                    <Pre>{t.actual ?? ""}</Pre>
                  </div>
                </div>
              )}
              {t.stdout && (
                <div className="mt-1.5">
                  <div className="text-xs text-muted-foreground">Printed output</div>
                  <Pre>{t.stdout}</Pre>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function failureBreakdown(s: StageSubmitReport): string {
  const parts: string[] = [];
  if (s.wrongAnswers) parts.push(`${s.wrongAnswers} wrong answer${s.wrongAnswers === 1 ? "" : "s"}`);
  if (s.errors) parts.push(`${s.errors} raised an error`);
  if (s.timeouts) parts.push(`${s.timeouts} timed out`);
  return parts.join(", ");
}

function SubmitResults({ body }: { body: SubmitResponseBody }) {
  const { report } = body;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <StatusIcon ok={report.passed} />
        {report.passed ? `Stage ${report.stage} passed` : `Stage ${report.stage} not passed yet`}
      </div>

      {body.unlocked && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 px-3 py-2 text-sm">
          <Unlock className="size-4 text-emerald-700" aria-hidden />
          Stage {body.unlocked} unlocked. The requirements changed: read the new prompt, then keep editing the
          same code.
        </div>
      )}

      {report.loadError && <Pre className="text-red-700">{report.loadError}</Pre>}

      <ul className="space-y-1.5">
        {report.stages.map((s) => (
          <li key={s.stage} className="rounded-md border px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              {s.regression ? (
                <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-label="regression" />
              ) : (
                <StatusIcon ok={s.allPassed} />
              )}
              <span className={cn(s.regression && "font-medium text-amber-700")}>{s.message}</span>
            </div>
            {!s.allPassed && (
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                Hidden tests: {failureBreakdown(s)}.{" "}
                {s.regression
                  ? "Something that used to work is now broken."
                  : "Check edge cases and performance against the prompt."}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultsPanel({ result }: { result: ResultState }) {
  return (
    <div className="h-full overflow-y-auto px-4 py-3" aria-live="polite">
      {result.type === "idle" && (
        <p className="text-sm text-muted-foreground">
          Run checks the example tests for the current stage. Submit checks hidden tests for this stage and all
          earlier stages.
        </p>
      )}
      {result.type === "running" && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          {result.action === "run" ? "Running example tests…" : "Running hidden tests…"}
        </p>
      )}
      {result.type === "error" && (
        <div className="flex items-start gap-2 rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-sm text-red-800">
          <CircleX className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{result.message}</span>
        </div>
      )}
      {result.type === "run" && <RunResults body={result.body} />}
      {result.type === "submit" && <SubmitResults body={result.body} />}
    </div>
  );
}
