# Repair and verification

Verified locally on Windows with Node 20.20, pnpm 9.15.9, MinGW GCC 6.3,
Python and Java. The old GCC installation handles the tested programs but may
need upgrading for modern C++17 library features.

## Failures repaired

- Production worker startup targeted a nonexistent `server.js` instead of the built `server.cjs`.
- Submissions stayed queued when no callback URL was configured. Polling now recovers worker results and persists them; callback delivery also checks responses and retries.
- Repeated development launches collided on ports and shared Next.js cache locks. The coordinated launcher chooses free ports and a separate development cache.
- C++ unbraced control bodies lost variable updates; loop post-increments recorded the old value. Bracing preserves dangling-else binding and source lines, and probes record updated state.
- Python snapshots missed in-place mutation and attributed changes to the next line. Snapshots now compare bounded serialized values and use the executed line.
- JavaScript probes could break unbraced branches, automatic semicolons and loop bindings. Return probes were placed outside functions; runtime names collided with user code. Probes now preserve those constructs and use a private namespace.
- JavaScript module execution used a CommonJS filename; module detection now uses syntax, including top-level await.
- Missing tools, output floods and timeouts now produce bounded results. Submitted processes receive a minimal environment instead of worker credentials.
- File persistence cached stale data across instances and silently swallowed corruption/write failures. Records now use atomic per-submission files and surface storage errors.
- Invalid JSON shapes, languages and paths now produce client errors; callback payloads are validated. Hidden test contents are stripped before browser delivery.
- Production file tracing and Docker build context exclude secret files and runtime artifacts. Broad dynamic filesystem tracing was removed.
- Docker commands no longer use shell interpolation. Header and trace paths are mapped into the container, runtime mounts are read-only, and timeout cleanup removes containers.

## Checks

- Fresh TypeScript checks: all seven packages passed.
- Regression suite: 73 ordinary tests passed across packages, including real C/C++ compilation, Python, JavaScript and Java execution, web route handlers, persistence, diagnostics, structure interpretation and replay indexing. Two additional Postgres integration tests passed against native Postgres 18. Two Docker containment tests passed on the Linux CI host.
- Production worker and Next.js builds passed without the earlier broad filesystem-tracing warnings.
- Browser demo completed through submission, polling, verdicts, traces and report. At the divergence, the variable panel correctly showed `left = 6`, `right = 6`, and the report identified the `<` versus `<=` boundary.
- `pnpm smoke <url>` checks real HTTP submission/polling with all five languages, reference diagnosis, hidden-test privacy, compiler errors and runtime errors.
- Production startup and the complete HTTP smoke suite passed on isolated localhost ports with synthetic test authentication, no callback, and an explicitly enabled file store. CI now runs this smoke suite after building.

## Verification boundaries

Docker is not installed on this Windows machine. Live containment was verified in Linux GitHub CI: native compilation, read-only execution mounts, writable traces, non-root identity, absent worker credentials/network interfaces and timeout cleanup. External production Postgres and optional LLM providers were not exercised. Native Postgres tests verified concurrent queue admission/claims, expired-lease recovery, Unicode preservation and fenced terminal writes. No user secret files were opened. Local subprocess execution is for trusted code.

Java tracing and unrestricted language-level trace coverage remain unavailable. The durable shared Postgres queue is now implemented; production infrastructure still needs configuration before online execution can be enabled.

## Visual and learning verification

- 24 imagegen assets generated independently and optimized to WebP (about 1.2 MB combined). Original PNGs retained outside Git; prompts/provenance documented.
- 20 editable Python learning examples verified through real HTTP submission, polling, verdicts and traces. The diagnostic example intentionally returns a runtime error; the edge-case example intentionally returns a wrong answer. Other examples pass their expected outputs.
- Live tree diagram verified from three captured nodes; browser state confirmed values 4, 2 and 7. Atlas filter produced the six structure topics.
- Desktop layout and 320px mobile reflow checked. The workspace and atlas stayed within the viewport; large diagrams/data scroll inside their panels. Interface content was English; starter comments and optional narrative instructions were updated to English.
- Tests cover 20,000 unique variables, 5,000 nested calls, backward seeking, recursive variable shadowing, partial structures and malformed values.
- Built production HTTP smoke uses a temporary native Postgres cluster and shared durable worker queue with synthetic authentication and no callbacks. It exercises the real web/worker processes, all five languages, diagnostics and database result persistence. Local subprocess mode is explicitly enabled only for this trusted test; it does not establish Docker containment.
- Mobile/desktop screenshots are saved under `docs/verification/`. Classroom comprehension and universal arbitrary-program semantic animation are not claimed by these checks.

## Release status

- Git pull/rebase completed cleanly; implementation and CI fixes pushed to `main`.
- [Verified Linux CI run](https://github.com/amareshsingh0/codeatopsy/actions/runs/38492615406) passed all checks, including Docker containment and production HTTP smoke.
- [Existing Vercel production site](https://codeatopsy.vercel.app) deployed successfully. Home, atlas, playground and public problem API returned HTTP 200; reference source was stripped from the initial problem payload.
- Production health and submission APIs return HTTP 503 with an explicit missing-database configuration message. This is an outstanding infrastructure requirement, not a working online execution claim. See `PRODUCTION-SETUP.md`.
