import { Playground } from "@/components/Playground";
import { getExample } from "@/lib/examples";

export const dynamic = "force-dynamic";

export default async function PlaygroundPage({
  searchParams,
}: {
  searchParams: Promise<{ example?: string }>;
}) {
  const example = getExample((await searchParams).example);
  return (
    <main className="shell py-8">
      <Playground key={example?.slug ?? "custom"} example={example} />
    </main>
  );
}
