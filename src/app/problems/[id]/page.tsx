import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProblemWorkspace } from "@/components/workspace/ProblemWorkspace";
import { getProblem } from "@/server/problems/loader";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/problems/[id]">): Promise<Metadata> {
  const { id } = await params;
  const problem = getProblem(id);
  return { title: problem ? `${problem.title} · RealCode` : "RealCode" };
}

// Only the id is passed to the client; stage content is fetched from the API,
// which returns unlocked stages only.
export default async function ProblemPage({ params }: PageProps<"/problems/[id]">) {
  const { id } = await params;
  if (!getProblem(id)) notFound();
  return <ProblemWorkspace problemId={id} />;
}
