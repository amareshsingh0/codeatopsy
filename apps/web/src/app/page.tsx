import Link from "next/link";
import { listProblems } from "@/lib/problems";

export const dynamic = "force-dynamic";

export default async function Home() {
  const problems = listProblems();

  return (
    <main className="mx-auto max-w-7xl px-6">
      <section className="py-14 text-center">
        <div className="chip mx-auto mb-5">evidence-driven debugging</div>
        <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
          Stop guessing why your algorithm is wrong.
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-[15px] leading-relaxed" style={{ color: "var(--muted)" }}>
          CodeAutopsy instruments your C++, records every variable, branch and call,
          then plays your execution side-by-side with a correct reference — and shows
          you the <b style={{ color: "var(--text)" }}>exact moment your logic diverges</b>.
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          {problems[0] && (
            <Link href={`/problem/${problems[0].slug}`} className="btn btn-primary">
              🔬 Try the demo autopsy
            </Link>
          )}
          <Link href="/playground" className="btn">🧪 Playground — trace any code</Link>
        </div>
      </section>

      <section className="grid gap-4 pb-12 sm:grid-cols-3">
        {[
          {
            icon: "🧬",
            title: "Instrumented execution",
            body: "Your source is transformed with lightweight probes that record assignments, conditions, calls and returns — without changing what your program does.",
          },
          {
            icon: "🪞",
            title: "Reference replay",
            body: "The same tests run against a correct solution. Both traces are aligned so you can scrub through two executions in sync.",
          },
          {
            icon: "🔎",
            title: "First-divergence report",
            body: "The autopsy report ranks root-cause hypotheses and points at the line where your state first disagreed with the reference.",
          },
        ].map((f) => (
          <div key={f.title} className="panel p-5">
            <div className="text-2xl">{f.icon}</div>
            <h3 className="mt-2 text-[15px] font-bold">{f.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
              {f.body}
            </p>
          </div>
        ))}
      </section>

      <section id="problems" className="pb-16">
        <h2 className="mb-4 text-lg font-bold">Problem library</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {problems.map((p) => (
            <Link
              key={p.slug}
              href={`/problem/${p.slug}`}
              className="panel group p-5 transition hover:border-[color:var(--accent)]"
            >
              <div className="flex items-center justify-between">
                <span className="chip">{p.difficulty}</span>
                <span className="text-[11px]" style={{ color: "var(--muted)" }}>
                  {p.tests.length} tests
                </span>
              </div>
              <h3 className="mt-3 text-[15px] font-bold group-hover:text-[color:var(--accent)]">
                {p.title}
              </h3>
              <p className="mt-1 line-clamp-3 text-[13px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {p.blurb}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {p.topics.slice(0, 3).map((t) => (
                  <span key={t} className="chip text-[10px]">{t}</span>
                ))}
              </div>
            </Link>
          ))}
          {problems.length === 0 && (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              No problems found. Add one under <code>problems/</code>.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
