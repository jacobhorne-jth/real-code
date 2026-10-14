"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { formatDuration } from "@/lib/format";

/** Elapsed time since the problem was first opened; stops once finished. */
export function Timer({ startedAt, finishedAt }: { startedAt: number; finishedAt: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (finishedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [finishedAt]);
  const elapsed = (finishedAt ?? now) - startedAt;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-sm tabular-nums"
      aria-label="Elapsed time"
      title="Time since you opened this problem"
    >
      <Clock className="size-3.5 text-muted-foreground" aria-hidden />
      {formatDuration(elapsed)}
    </span>
  );
}
