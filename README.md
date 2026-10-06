# CodeAutopsy 🩺

**Evidence-driven execution debugger for algorithms.** Submit code in **C++, C,
Python, JavaScript or Java**, and CodeAutopsy instruments it, records every
assignment, branch, call and return, replays your execution side-by-side against
a correct reference — and shows you the **exact moment your logic diverges**,
with a ranked root-cause report.

No more `cout`-guessing. Just evidence.

---

## How it works

```
 student code ──► per-language engine ──────────► traced run ──► JSONL trace
                                                  │
 reference code ─► same engine ──► traced run ────┤
                                                  ▼
                                  trace-core: align + find first divergence
                                                  ▼
                                  explanation: ranked hypotheses + narrative
                                                  ▼
                                  visual trace player in the browser
```

| Language | Verdicts | Full trace | How |
|---|---|---|---|
| C++17 | ✅ | ✅ | source-to-source probe injection (`AUTOPSY_*`) + `trace-runtime.hpp` |
| C | ✅ | ✅* | compiled via g++ (most C code builds as C++) |
| Python 3 | ✅ | ✅ | zero instrumentation — `sys.settrace` runner streams events |
| JavaScript | ✅ | ✅ | acorn-AST instrumenter + JSONL runtime preamble |
| Java 17 | ✅ | ⏳ | single-file `java` launch; trace coming soon |

1. **Verdicts** — your code runs against every test; outputs, exit codes and
   time limits decide pass/fail.
2. **Autopsy** — if any test failed, *both* your code and the reference get
   traced (C++: probes compiled in; Python: settrace; JS: AST-instrumented).
   Hard event/time budgets mean runaway loops can't flood the trace.
3. **Divergence** — both traces are aligned semantically (assignments by variable,
   branches by condition with fuzzy matching, so `left < right` vs `left <= right`
   still line up). The first value or control disagreement *is* the bug's moment.
4. **Report** — rule-based hypotheses ranked by confidence (off-by-one guards,
   wrong updates, non-termination, state deltas), plus an optional free-tier
   LLM narrative (Gemini / OpenRouter) when an API key is configured.
   **Without any API key the app is fully functional** — rules only.

## Monorepo layout (pnpm + Turborepo, TypeScript everywhere)

| Path                   | What it is |
|------------------------|------------|
| `apps/web`             | Next.js 16 + React 19 · UI, REST API, submit/poll pipeline |
| `apps/execution-node`  | Fastify 5 worker · compile → instrument → run → trace → explain |
| `packages/schemas`     | Zod single source of truth (traces, jobs, problems, reports) |
| `packages/instrumenter`| C++ source-to-source probe injection + `trace-runtime.hpp` |
| `packages/trace-core`  | trace alignment, divergence engine, findings, evidence digest |
| `packages/explanation` | rule-based diagnosis + free-tier LLM adapter |
| `packages/db`          | Drizzle (Supabase Postgres) **or** zero-config file store |
| `problems/`            | problem library (`binary-search` ships with the demo bug) |
| `infra/`               | Dockerfile, docker-compose, deployment notes |
| `legacy/`              | the original Python week-1 spike, kept for reference |

## Quick start (local dev, no infrastructure needed)

Prereqs: Node ≥ 20.9, pnpm 9, a C++ compiler (`g++` in PATH; `AUTOPSY_CXX` overrides).

```bash
pnpm install

# terminal 1 — execution node (http://127.0.0.1:8787)
pnpm --filter @codeautopsy/execution-node dev

# terminal 2 — web (http://localhost:3000)
pnpm --filter @codeautopsy/web dev
```

Open http://localhost:3000 → **Binary Search** → 🔬 **Run autopsy**.
You'll see the failing tests, then scrub through both executions, watch
`left/right/mid` move over the array, and get a report blaming
`while (left < right)` on the exact line.

One command via docker compose (Linux/macOS or Docker Desktop):

```bash
cp .env.example .env   # optional settings
docker compose -f infra/docker-compose.yml up --build
```

## Tests & quality

```bash
pnpm test        # 23 tests — includes a REAL compile+trace end-to-end run
pnpm typecheck   # strict TS across all 7 packages
pnpm build       # Next.js production build + esbuild worker bundle
```

The end-to-end test compiles the instrumented binary-search, runs it, parses the
JSONL trace and asserts the divergence engine pinpoints the off-by-one guard.

## Deployment (Vercel + Supabase + one container)

Vercel serverless can't compile C++, so execution lives in a dedicated node:

| Piece      | Where                        | Notes |
|------------|------------------------------|-------|
| web        | **Vercel**                   | `pnpm --filter @codeautopsy/web build` |
| Postgres   | **Supabase**                 | set `DATABASE_URL`; `pnpm --filter @codeautopsy/db db:push` |
| execution  | **Fly.io / Railway / Render**| deploy `infra/execution-node.Dockerfile` |

Then set env vars (see `.env.example`): `EXECUTION_NODE_URL`,
`AUTOPSY_NODE_SECRET` (shared secret both ways),
`AUTOPSY_CALLBACK_URL=https://<your-web>/api/internal/execution-callback`.

For untrusted traffic set `AUTOPSY_SANDBOX=docker` so every compile/run executes
inside a locked-down container (no network, memory/CPU/pids caps, non-root).

## Adding a problem

```
problems/<slug>/
├── problem.json      # statement, tests, limits, bug hint
├── student.cpp       # demo (buggy) submission — full stdin/stdout program
└── reference.cpp     # correct solution
```

Test format: `input` and `expectedOutput` are exact strings; trailing
whitespace is normalized. `hidden: true` tests are labeled in the UI.

## Security notes

- The **local sandbox is not a security boundary** — it's for development on
  trusted machines. It enforces wall-clock timeouts only.
- The **Docker sandbox** (network-off, memory/cpu/pids caps, non-root,
  read-only rootfs) is the production path for untrusted submissions.
- The reference solution is stripped from every browser payload until a run
  completes; secrets flow only web ↔ execution-node via a shared header.
