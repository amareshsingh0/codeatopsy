# CodeAutopsy 🩺

**Evidence-driven execution debugger for algorithms.** Submit code in **C++, C,
Python, JavaScript or Java**, and CodeAutopsy records supported
assignments, branches, calls and returns, replays your execution side-by-side against
a correct reference — and shows you the **first recorded difference**,
with a ranked root-cause report.

The visual atlas includes 20 real editable learning programs. Learn mode adds plain-English step explanations; live state views cover arrays, matrices, objects, strings, scalar histories and opt-in tree/linked/graph interpretations. A custom logo and 24 original visual assets form the illustration system.

The visual workspace separates editing, replay and evidence, with synchronized source, before/after changes, optional prediction practice, diagram inspection and phone panel switching. See the [October 2026 visual-learning research](docs/VISUAL-UX-RESEARCH-2026-10.md) and [verification](docs/verification/2026-10-28-visual-workspace.md). Rendering uses bounded local trace data with on-demand panels and language parsers.

Production uses isolated Vercel Sandbox VMs with durable PostgreSQL admission, ownership and launch recovery. See [native cloud execution](docs/VERCEL-NATIVE-EXECUTION.md), [architecture](docs/ARCHITECTURE.md), [production setup](docs/PRODUCTION-SETUP.md), [visual research](docs/VISUAL-RESEARCH.md) and [asset prompts](docs/VISUAL-ASSET-PROMPTS.md).

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

| Language   | Verdicts | Supported tracing | How                                                                   |
| ---------- | -------- | ----------------- | --------------------------------------------------------------------- |
| C++17      | ✅       | ✅                | source-to-source probe injection (`AUTOPSY_*`) + `trace-runtime.hpp`  |
| C          | ✅       | ✅*               | native gcc verdicts; tracing currently requires C++-compatible source |
| Python 3   | ✅       | ✅                | zero instrumentation — `sys.settrace` runner streams events           |
| JavaScript | ✅       | ✅                | acorn-AST instrumenter + JSONL runtime preamble                       |
| Java 17    | ✅       | ⏳                | single-file `java` launch; trace coming soon                          |

1. **Verdicts** — your code runs against every test; outputs, exit codes and
   time limits decide pass/fail.
2. **Autopsy** — if any test failed, _both_ your code and the reference get
   traced (C++: probes compiled in; Python: settrace; JS: AST-instrumented).
   Hard event/time budgets bound trace collection. The first failed library test
   gets a reference comparison; standalone runs collect their own trace.
3. **Divergence** — both traces are aligned semantically (assignments by variable,
   branches by condition with fuzzy matching, so `left < right` vs `left <= right`
   still line up). The first value or control disagreement supplies diagnostic
   evidence. Alignment is a heuristic, not a proof of the root cause.
4. **Report** — rule-based hypotheses ranked by confidence (off-by-one guards,
   wrong updates, non-termination, state deltas), plus an optional free-tier
   LLM narrative (Gemini / OpenRouter) when an API key is configured.
   **Without any API key the app is fully functional** — rules only.

## Monorepo layout (pnpm + Turborepo, TypeScript everywhere)

| Path                    | What it is                                                      |
| ----------------------- | --------------------------------------------------------------- |
| `apps/web`              | Next.js 16 + React 19 · UI, REST API, submit/poll pipeline      |
| `apps/execution-node`   | Fastify 5 worker · compile → instrument → run → trace → explain |
| `packages/schemas`      | Zod single source of truth (traces, jobs, problems, reports)    |
| `packages/instrumenter` | C++ source-to-source probe injection + `trace-runtime.hpp`      |
| `packages/trace-core`   | trace alignment, divergence engine, findings, evidence digest   |
| `packages/explanation`  | rule-based diagnosis + free-tier LLM adapter                    |
| `packages/db`           | Drizzle (Supabase Postgres) **or** zero-config file store       |
| `problems/`             | problem library (`binary-search` ships with the demo bug)       |
| `infra/`                | Dockerfile, docker-compose, deployment notes                    |
| `legacy/`               | the original Python week-1 spike, kept for reference            |

## Quick start (local dev, no infrastructure needed)

Prereqs: Node ≥ 20.9, pnpm 9, and a compiler with a C++17 standard library
(`g++` in PATH; `AUTOPSY_CXX` overrides). C needs `gcc` (`AUTOPSY_CC` overrides).
Python and Java runs require their interpreters in PATH; `AUTOPSY_PYTHON` and
`AUTOPSY_JAVA` can select specific installations. JavaScript uses the worker's Node runtime.

```bash
pnpm install

# start the web app and execution node together
pnpm dev
```

Open the URL printed by `pnpm dev` (normally http://localhost:3000) →
**Binary Search** → 🔬 **Run autopsy**. The launcher selects free ports,
connects both services, and gives development its own Next.js cache.
Restart `pnpm dev` after changing worker code; the web app reloads automatically.
The separate package `dev` commands remain available for manual port/configuration control.
You'll see the failing tests, then scrub through both executions, watch
`left/right/mid` move over the array, and get a report blaming
`while (left < right)` on the exact line.

One command via docker compose (Linux/macOS or Docker Desktop):

```bash
docker compose -f infra/docker-compose.yml up --build
```

## Tests & quality

```bash
pnpm test        # unit, API, persistence, queue and real compile/trace regressions
pnpm typecheck   # strict TS across all 7 packages
pnpm build       # Next.js production build + esbuild worker bundle
pnpm smoke       # HTTP end-to-end checks against the running app, all five languages
# custom URL: pnpm smoke http://127.0.0.1:3001
```

The end-to-end test compiles the instrumented binary-search, runs it, parses the
JSONL trace and asserts the divergence engine pinpoints the off-by-one guard.

## Deployment (Vercel + Supabase, fully online)

The current deployment runs at [codeatopsy.vercel.app](https://codeatopsy.vercel.app). Each submission executes in a separate Vercel Sandbox VM; PostgreSQL stores private submission records and recovery state. A static execution-server address and local Docker installation are not required.

Follow [native cloud setup and limits](docs/VERCEL-NATIVE-EXECUTION.md): Node.js 24, Vercel OIDC, `AUTOPSY_EXECUTION_PROVIDER=vercel`, a verified `AUTOPSY_SANDBOX_SNAPSHOT_ID`, backend `DATABASE_URL` and a strong `AUTOPSY_NODE_SECRET`. Apply the private-schema SQL migration rather than changing another app's public tables. Snapshots contain the trusted execution bundle and toolchains and must be rebuilt after runner changes.

The initial free deployment limits concurrent work and daily/hourly admission. Runs have a 2-GiB aggregate VM budget, finite lifetime and private browser ownership. Completed data becomes eligible for pruning after 24 hours. Free hosting capacity is finite; Java provides output/verdicts only, and other languages have documented trace-coverage limits.

```bash
node scripts/verify-cloud-production.mjs  # five languages, failures and private ownership
AUTOPSY_WEB_URL=https://codeatopsy.vercel.app node scripts/verify-examples.mjs
```

### Alternative: separately hosted Docker worker

The legacy HTTP-worker provider remains available for operators with a Docker-capable server:

| Piece     | Where                         | Notes                                                             |
| --------- | ----------------------------- | ----------------------------------------------------------------- |
| web       | **Vercel**                    | `pnpm --filter @codeautopsy/web build`                            |
| Postgres  | **Supabase**                  | set `DATABASE_URL`; apply the checked-in private-schema migration |
| execution | **Fly.io / Railway / Render** | deploy `infra/execution-node.Dockerfile`                          |

Then set env vars: `EXECUTION_NODE_URL`,
`AUTOPSY_NODE_SECRET` (shared secret both ways),
`AUTOPSY_CALLBACK_URL=https://<your-web>/api/internal/execution-callback`.
Callbacks are optional: polling independently retrieves and persists completed results.
Without a callback or after callback delivery failure, the UI still finishes.

For untrusted traffic build the execution image on the worker's Docker host:

```bash
docker build -f infra/sandbox.Dockerfile -t codeautopsy-sandbox:local .
```

Run the worker on a host with Docker available and set `AUTOPSY_SANDBOX=docker`.
Compilation and execution use non-root containers with no network, dropped
capabilities and memory/CPU/process limits. During execution the work directory
is read-only; trace output has its own writable mount. Timeouts remove the
container as well as terminating its launcher. If the worker itself runs in a
container, configure the Docker client and ensure `AUTOPSY_WORK_DIR` is a shared
absolute path visible at the same location to the worker and Docker daemon.
The supplied compose file is for trusted local development; it does not configure nested Docker isolation.

Production requires `AUTOPSY_NODE_SECRET`. Local execution in production is
rejected unless the operator explicitly sets `AUTOPSY_ALLOW_LOCAL_EXECUTION=true`
for trusted submissions. Production persistence requires `DATABASE_URL`; a
single host with a persistent writable filesystem can explicitly opt into
`AUTOPSY_ALLOW_FILE_STORE=true`. Do not use the file store on ephemeral serverless storage.

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
- The **native VM provider** uses a separate credential-free, network-denied VM per submission, with fresh non-root namespaces for each stage. The alternative **Docker sandbox** uses network-off, memory/cpu/pids caps, non-root execution and a read-only rootfs.
- The reference solution is stripped from every browser payload until a run
  completes; hidden test inputs and expected outputs are also stripped from
  public problem payloads. Worker credentials are not inherited by submitted programs.
- File persistence writes each submission atomically and migrates the legacy
  array store. Corrupt or unwritable storage produces an error instead of silently
  discarding data. Postgres should be used for multiple web replicas.
- Production job state is durable in PostgreSQL. Launch leases recover interrupted requests, terminal writes are fenced and polling persists results before VM cleanup. The legacy worker's in-memory fallback is for trusted local development only.
- Trace coverage varies by source construct. Unsupported instrumentation is
  reported as a warning while verdicts and stdout remain available. Java currently
  provides execution and output, without a step trace. C tracing is best effort.

See [verification notes](docs/VERIFICATION.md) for the checks run and deployment limits.
