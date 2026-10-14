import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ADMIN_COOKIE, adminPassword, isAdminToken } from "@/server/admin";
import { getFunnel, listFeedback, type FunnelRow } from "@/server/db/store";
import { listProblems } from "@/server/problems/loader";
import { login, logout } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin · RealCode", robots: { index: false, follow: false } };

function LoginForm({ error, disabled }: { error?: string; disabled: boolean }) {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-20">
      <h1 className="mb-6 text-xl font-semibold">Admin</h1>
      {disabled ? (
        <p className="text-sm text-muted-foreground">Admin is disabled. Set ADMIN_PASSWORD to enable it.</p>
      ) : (
        <form action={login} className="space-y-3">
          <Label htmlFor="password">Password</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
          {error && (
            <p className="text-sm text-red-700">
              {error === "rate" ? "Too many attempts. Try again later." : "Wrong password."}
            </p>
          )}
          <Button type="submit">Sign in</Button>
        </form>
      )}
    </main>
  );
}

function Funnel({ row, title }: { row: FunnelRow; title: string }) {
  const steps = [
    { label: "Started", value: row.started },
    ...row.passedStages.map((value, i) => ({ label: `Stage ${i + 1} passed`, value })),
    { label: "Email left", value: row.emailLeft },
  ];
  const max = Math.max(row.started, 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <caption className="sr-only">Funnel for {title}: distinct sessions reaching each step</caption>
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 font-normal">Step</th>
              <th className="w-1/2 pb-2 font-normal">
                <span className="sr-only">Bar</span>
              </th>
              <th className="pb-2 text-right font-normal">Sessions</th>
              <th className="pb-2 text-right font-normal">% of started</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const pct = row.started ? (s.value / row.started) * 100 : 0;
              return (
                <tr key={s.label} className="border-t">
                  <td className="py-2 pr-3 whitespace-nowrap">{s.label}</td>
                  <td className="py-2 pr-3">
                    <div
                      className="h-3 rounded-r bg-foreground/70"
                      style={{ width: `${Math.max((s.value / max) * 100, s.value ? 1 : 0)}%` }}
                      title={`${s.label}: ${s.value} sessions (${pct.toFixed(0)}%)`}
                    />
                  </td>
                  <td className="py-2 text-right tabular-nums">{s.value}</td>
                  <td className="py-2 text-right text-muted-foreground tabular-nums">{pct.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const params = await searchParams;
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!isAdminToken(token)) {
    const error = typeof params.error === "string" ? params.error : undefined;
    return <LoginForm error={error} disabled={adminPassword() === null} />;
  }

  const problems = listProblems();
  const funnels = await Promise.all(problems.map((p) => getFunnel(p.id, p.stageCount)));
  const feedback = await listFeedback();
  const titles = new Map(problems.map((p) => [p.id, p.title]));

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
        <form action={logout}>
          <Button variant="outline" size="sm" type="submit">
            Sign out
          </Button>
        </form>
      </div>

      <h2 className="mb-3 text-lg font-semibold">Funnel</h2>
      <div className="space-y-4">
        {funnels.map((f) => (
          <Funnel key={f.problemId} row={f} title={titles.get(f.problemId) ?? f.problemId} />
        ))}
      </div>

      <h2 className="mt-10 mb-3 text-lg font-semibold">Feedback ({feedback.length})</h2>
      {feedback.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feedback yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-normal">When</th>
                <th className="px-3 py-2 font-normal">Problem</th>
                <th className="px-3 py-2 font-normal">Feedback</th>
                <th className="px-3 py-2 font-normal">Email</th>
              </tr>
            </thead>
            <tbody>
              {feedback.map((f) => (
                <tr key={f.id} className="border-t align-top">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(f.createdAt).toISOString().replace("T", " ").slice(0, 16)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{titles.get(f.problemId) ?? f.problemId}</td>
                  <td className="px-3 py-2 whitespace-pre-wrap break-words">{f.feedback ?? "—"}</td>
                  <td className="px-3 py-2 break-all">{f.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
