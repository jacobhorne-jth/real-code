"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { FinishStats } from "@/lib/api-types";
import { api, ApiRequestError } from "@/lib/client-api";
import { formatDuration } from "@/lib/format";

interface Props {
  problemId: string;
  problemTitle: string;
  sessionId: string;
  stats: FinishStats;
  onBack: () => void;
}

export function FinishScreen({ problemId, problemTitle, sessionId, stats, onBack }: Props) {
  const [feedback, setFeedback] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const totalSubmits = stats.submitsPerStage.reduce((n, s) => n + s.submits, 0);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!feedback.trim() && !email.trim()) {
      setError("Write some feedback or leave an email.");
      return;
    }
    setStatus("sending");
    setError(null);
    try {
      await api.feedback(problemId, sessionId, feedback.trim(), email.trim());
      setStatus("sent");
    } catch (err) {
      setStatus("idle");
      setError(err instanceof ApiRequestError ? err.message : "Could not send. Try again.");
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-14">
      <div className="mb-8 flex items-start gap-3">
        <CheckCircle2 className="mt-1 size-7 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">All stages complete</h1>
          <p className="mt-1 text-muted-foreground">{problemTitle}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Total time</CardDescription>
            <CardTitle className="font-mono text-2xl tabular-nums">{formatDuration(stats.totalTimeMs)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Submits</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{totalSubmits}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Regressions hit</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{stats.regressionsHit}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="mt-3">
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-normal">Stage</th>
                <th className="py-1 text-right font-normal">Submits</th>
              </tr>
            </thead>
            <tbody>
              {stats.submitsPerStage.map((s) => (
                <tr key={s.stage} className="border-t">
                  <td className="py-1.5">Stage {s.stage}</td>
                  <td className="py-1.5 text-right tabular-nums">{s.submits}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardContent>
          {status === "sent" ? (
            <p className="text-sm">Thanks, that helps a lot.</p>
          ) : (
            <form onSubmit={send} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="feedback">Did this feel like a real interview round? Anything off?</Label>
                <Textarea
                  id="feedback"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  maxLength={5000}
                  rows={5}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Get notified when the next problem drops</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com (optional)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  autoComplete="email"
                />
              </div>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <Button type="submit" disabled={status === "sending"}>
                {status === "sending" ? "Sending…" : "Send"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="mt-6">
        <Button variant="link" className="px-0" onClick={onBack}>
          Back to the editor
        </Button>
      </div>
    </main>
  );
}
