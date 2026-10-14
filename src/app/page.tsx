import Link from "next/link";
import { ArrowRight, Clock, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { listProblems } from "@/server/problems/loader";

export const dynamic = "force-dynamic";

export default function Home() {
  const problems = listProblems();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight">RealCode</h1>
      <p className="mt-2 max-w-xl text-muted-foreground">
        Practice the multi-stage coding round: you build one class, and every time you pass, the requirements
        change. Keep your design flexible, and don&apos;t break what already works.
      </p>

      <div className="mt-10 space-y-3">
        {problems.length === 0 && <p className="text-sm text-muted-foreground">No problems yet.</p>}
        {problems.map((p) => (
          <Link key={p.id} href={`/problems/${p.id}`} className="group block">
            <Card className="transition-colors group-hover:bg-muted/40">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {p.title}
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </CardTitle>
                <CardDescription className="flex flex-wrap items-center gap-3 pt-1">
                  <Badge variant="outline">{p.difficulty}</Badge>
                  <span className="inline-flex items-center gap-1">
                    <Layers className="size-3.5" aria-hidden /> {p.stageCount} stages
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock className="size-3.5" aria-hidden /> ~{p.timeEstimateMinutes} min
                  </span>
                  <span>Python</span>
                </CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  );
}
