"use client";

import { Check, Lock } from "lucide-react";
import type { ClientStage } from "@/lib/api-types";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

interface Props {
  stages: ClientStage[];
  stageCount: number;
  unlockedStage: number;
  finished: boolean;
  selected: number;
  onSelect: (stage: number) => void;
}

export function StagePanel({ stages, stageCount, unlockedStage, finished, selected, onSelect }: Props) {
  const stage = stages.find((s) => s.number === selected) ?? stages[stages.length - 1];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 border-b px-3 py-2" role="tablist" aria-label="Stages">
        {Array.from({ length: stageCount }, (_, i) => i + 1).map((n) => {
          const locked = n > unlockedStage;
          const passed = n < unlockedStage || finished;
          return (
            <button
              key={n}
              role="tab"
              aria-selected={n === stage.number}
              disabled={locked}
              onClick={() => onSelect(n)}
              title={locked ? "Pass the current stage to unlock" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium transition-colors",
                n === stage.number ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                locked && "cursor-not-allowed opacity-50 hover:text-muted-foreground",
              )}
            >
              {locked ? (
                <Lock className="size-3.5" aria-hidden />
              ) : passed ? (
                <Check className="size-3.5 text-emerald-600" aria-hidden />
              ) : null}
              Stage {n}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" role="tabpanel">
        <Markdown>{stage.prompt}</Markdown>

        <section className="mt-6">
          <h3 className="mb-2 text-sm font-semibold">
            {stage.number === 1 ? "Interface" : `New in stage ${stage.number}`}
          </h3>
          <pre className="overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[0.8rem] leading-relaxed">
            {`class ${stage.className}:\n`}
            {stage.methods.map((m) => `    def ${m.signature}\n`).join("")}
          </pre>
        </section>

        {stage.examples.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-2 text-sm font-semibold">Example tests</h3>
            <p className="mb-2 text-xs text-muted-foreground">
              Run checks these. Submit checks hidden tests for this stage and every earlier one.
            </p>
            <div className="space-y-3">
              {stage.examples.map((ex) => (
                <div key={ex.name} className="rounded-md border">
                  <div className="border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">{ex.name}</div>
                  <pre className="overflow-x-auto p-3 font-mono text-[0.8rem] leading-relaxed">
                    {ex.ops.map((op) => `${op.call}  # -> ${op.expect}`).join("\n")}
                  </pre>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
