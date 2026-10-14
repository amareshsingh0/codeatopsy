import { notFound } from "next/navigation";
import { getProblem, toPublic } from "@/lib/problems";
import { Workspace } from "@/components/Workspace";

export const dynamic = "force-dynamic";

export default async function ProblemPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = getProblem(slug);
  if (!found) notFound();
  const { problem } = found;

  return (
    <main className="shell py-8">
      <Workspace problem={toPublic(problem)} />
    </main>
  );
}
