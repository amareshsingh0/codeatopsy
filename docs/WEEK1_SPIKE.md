# Week 1 spike findings

Scope per section 19: "freeze scope, contracts, failing example, and
provider spike; prove isolated compilation, execution, and trace
collection."

## What was actually run (not just described)

1. **Golden failing example (section 11) reproduced exactly.**
   `problems/binary-search/student.cpp` and `reference.cpp`, compiled and
   run against `input.txt` (`a=[2,4,7,9,11,15,18]`, `target=18`):
   - student → `-1`
   - reference → `6`
   - Confirmed identically under both `g++ 13.3.0` and `clang++ 18.1.3` —
     no toolchain-dependent behavior in this example.

2. **Timeout enforcement is real, not asserted.** `tests/security/infinite_loop.cpp`
   run through `LocalProvider` with a 2s wall-clock limit was killed at
   2.00s elapsed (see `tests/week1_spike_test.py` output). Status came
   back `TIMEOUT`, not a hang.

3. **API skeleton boots and round-trips a submission.** `POST /submissions`
   → 202 with a submission_id + job_id, `GET /submissions/{id}` → 200,
   unknown id → 404. In-memory store only (Week 2 replaces with Postgres).

4. **Toolchain check:** `clang++` 18.1.3 is NOT preinstalled on this
   Ubuntu 24.04 base but installs cleanly via
   `apt-get install --no-install-recommends clang` (full `clang` package
   pulls in ~150MB including `libxml2-dev`/`libc6-i386`, which 404'd on
   this mirror — the `--no-install-recommends` install succeeded fine).
   Confirms the pinned-Clang-toolchain decision (section 4) is workable
   on a standard Ubuntu base image.

## What could NOT be run, and why

This dev container's network egress is allowlisted to package registries
(pypi, npm, github release assets, ubuntu archives) only — see the
`network_configuration` for the exact list. It has **no path to
`judge0-ce.p.rapidapi.com` or any self-hosted Judge0 deployment**. So the
actual integration gate (section 5) is only partially closed:

| Gate requirement | Status |
|---|---|
| Compile instrumented C++ with required runtime support/flags | **Not tested against Judge0.** No instrumentation exists yet either (Week 3-4) — this item can't fully close until both exist. |
| Run under restrictions, terminate job on limit violations | **Proven against `LocalProvider`** (timeout case above), **not proven against Judge0.** Judge0 does document `cpu_time_limit`/`wall_time_limit`/`memory_limit` params — client code in `judge0_provider.py` sends them — but nobody has watched a real Judge0 instance actually enforce them here. |
| Return a bounded trace artifact separately from judged stdout | **Open problem, not just untested.** Judge0's submission model has `stdout` / `stderr` / `compile_output` — no first-class channel for "also here's a 2MB trace blob." Three options sketched in `judge0_provider.py`'s docstring (delimiter-encode into stdout, deployment-specific extra-files mechanism, or don't use Judge0 for autopsy-mode runs at all). **This is the highest-priority thing to resolve before Week 3.** |
| Preserve source mapping, compiler diagnostics, exit metadata | Diagnostics/exit code are in the Judge0 response shape (`compile_output`, `exit_code`) — client reads them — but untested live. |
| Handle required trace/output artifact sizes | Not testable without a live instance and a real trace format, neither of which exist yet. |
| Arbitrary compiler extensions / injected libs / extra file descriptors / artifact retrieval | **Likely a hard "no" on hosted (RapidAPI) Judge0.** A self-hosted Judge0 with a custom language definition might allow more, but that's a different deployment decision, not a client-code change. |

## Recommendation

Don't spend Week 2+ effort wiring the *instrumented*-build path through
Judge0 yet — the trace-artifact-retrieval gap above is a real design
question, not a config detail, and section 5 already says: *"If the
integration gate fails, choose an existing sandbox solution with
configurable worker images and artifact collection, or a managed sandbox
that meets those requirements."*

Concretely:
- **Judge-mode (uninstrumented compile+run+checker)** is a reasonable fit
  for Judge0 as-is — single source file, stdout comparison, standard
  limits. Low risk.
- **Autopsy-mode (instrumented build + trace collection)** should be
  spiked against a self-hosted sandbox with real file/artifact access
  (or a self-hosted Judge0 instance, if its worker filesystem/artifact
  model turns out to support pulling a second output file — needs
  checking against actual Judge0 source, not just the public API docs)
  *before* committing Week 3-4 instrumentation work to an execution
  backend that can't get the trace out.
- Someone with real network access should run `judge0_provider.py`
  against an actual deployment this week and fix whatever the response
  shape assumptions get wrong — treat everything in that file as a
  first draft, not a verified client.

## Files this spike produced

```
problems/binary-search/{student,reference,harness}.cpp, input.txt, problem.json
execution/providers/{base,local_provider,judge0_provider}.py
packages/schemas/trace_event.{py,ts}
apps/api/app/  (FastAPI skeleton: /health, /submissions, /submissions/{id})
tests/week1_spike_test.py            (run: python3 tests/week1_spike_test.py)
tests/security/infinite_loop.cpp
```
