import Link from "next/link";
import Image from "next/image";
import { listProblems } from "@/lib/problems";
import { Icon } from "@/components/Icon";
import { TracePreview } from "@/components/TracePreview";
import { SystemStatus } from "@/components/SystemStatus";
export const dynamic = "force-dynamic";
export default function Home() {
  const problems = listProblems();
  return (
    <main className="shell home">
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow">
            <span className="small-dot" />
            THE EXECUTION OBSERVATORY
          </span>
          <h1>
            Your code.
            <br />
            Its hidden story.
            <br />
            <em>Finally, visible.</em>
          </h1>
          <p>
            Go beyond the final answer. Replay what happened, explore changing state, and follow the evidence
            to the first recorded difference.
          </p>
          <div className="hero-actions">
            <Link href="/playground" className="btn btn-primary">
              Open the playground
              <Icon name="arrow" />
            </Link>
            {problems[0] && (
              <Link href={`/problem/${problems[0].slug}`} className="btn">
                Investigate a problem
              </Link>
            )}
          </div>
          <div className="language-strip">
            <span>Run with</span>
            <strong>C++</strong>
            <strong>C</strong>
            <strong>Python</strong>
            <strong>JavaScript</strong>
            <strong>Java</strong>
          </div>
          <SystemStatus />
        </div>
        <div className="hero-art">
          <Image
            src="/visuals/observatory.webp"
            alt="Illustration of two execution paths with a coral divergence point"
            fill
            sizes="(max-width: 800px) 100vw, 50vw"
            preload
            className="observatory-image"
          />
          <div className="art-caption">
            <span className="eyebrow">01 / FOLLOW THE EVIDENCE</span>
            <span className="art-caption-rule" />
            <p>
              Same input.
              <br />
              Two executions.
              <br />
              <strong>One moment that matters.</strong>
            </p>
          </div>
          <span className="art-note">Concept illustration</span>
        </div>
      </section>
      <TracePreview />
      <section className="feature-section">
        <div className="section-intro">
          <span className="eyebrow">FROM OUTPUT TO UNDERSTANDING</span>
          <h2>
            A debugger you can
            <br />
            <em>see and explore.</em>
          </h2>
          <p>Move at your own pace. Inspect real captured values instead of guessing what the program did.</p>
        </div>
        <div className="feature-grid">
          <article className="feature-card panel">
            <div className="feature-image">
              <Image
                src="/visuals/memory-map.webp"
                alt="Illustration of a highlighted cell in a memory grid"
                fill
                sizes="(max-width: 700px) 100vw, 35vw"
              />
            </div>
            <div className="feature-copy">
              <span className="eyebrow">02 / EXPLORE STATE</span>
              <h3>Give values a shape.</h3>
              <p>
                Arrays, matrices, objects and strings become inspectable state. Follow variable history and
                compare captured reference values.
              </p>
              <Link href="/playground">
                Explore your code
                <Icon name="arrow" />
              </Link>
            </div>
          </article>
          <article className="feature-card panel">
            <div className="feature-image">
              <Image
                src="/visuals/trace-steps.webp"
                alt="Illustration of layered execution steps connected by a timeline"
                fill
                sizes="(max-width: 700px) 100vw, 35vw"
              />
            </div>
            <div className="feature-copy">
              <span className="eyebrow">03 / REPLAY THE MOMENT</span>
              <h3>Find the meaningful difference.</h3>
              <p>
                Pause, scrub, search events and investigate a recorded divergence. Compiler and runtime
                diagnostics remain visible alongside trace coverage.
              </p>
              <a href="#problems">
                Choose an investigation
                <Icon name="arrow" />
              </a>
            </div>
          </article>
        </div>
      </section>
      <section id="problems" className="library-section">
        <div className="library-heading">
          <div>
            <span className="eyebrow">THE PROBLEM LIBRARY</span>
            <h2>Start with a curious question.</h2>
          </div>
          <span className="chip">{problems.length} investigations</span>
        </div>
        <div className="problem-grid">
          {problems.map((problem, i) => (
            <Link key={problem.slug} href={`/problem/${problem.slug}`} className="panel problem-card">
              <div className="problem-card-top">
                <span className="problem-number mono">{String(i + 1).padStart(2, "0")}</span>
                <span className={`chip difficulty-${problem.difficulty}`}>{problem.difficulty}</span>
              </div>
              <h3>{problem.title}</h3>
              <p>{problem.blurb}</p>
              <div className="problem-topics">
                {problem.topics.slice(0, 3).map((topic) => (
                  <span key={topic}>{topic}</span>
                ))}
              </div>
              <div className="problem-card-bottom">
                <span>{problem.tests.length} tests · reference comparison</span>
                <Icon name="arrow" />
              </div>
            </Link>
          ))}
        </div>
        {!problems.length && <p className="muted">No investigations are available yet.</p>}
      </section>
      <section className="closing-note">
        <Icon name="layers" size={28} />
        <div>
          <h2>Bring your own code. Follow its own story.</h2>
          <p>
            Execution and verdicts in five languages. Traces for supported C++, Python, JavaScript and
            compatible C code; Java currently provides output and diagnostics.
          </p>
        </div>
        <Link href="/playground" className="btn btn-primary">
          Start exploring
          <Icon name="arrow" />
        </Link>
      </section>
    </main>
  );
}
