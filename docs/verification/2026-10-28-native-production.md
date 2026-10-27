# Native cloud production verification — 28 October 2026

Runtime release: `c237dae25622fe3d5ceebdf4ca67f9ccd1646bf8`.
Production: https://codeatopsy.vercel.app
Deployment: `dpl_7ALeGMLo3roAp1AHfmpdW96a1iDo`.

## Verified

- Production build/typecheck completed and the main public alias was updated.
- GitHub CI [40581786474](https://github.com/amareshsingh0/codeatopsy/actions/runs/40581786474) passed: typecheck, all package tests, real PostgreSQL integration, build, Docker containment and production HTTP smoke tests.
- Native toolchain passed eleven public execution/isolation cases on a prepared cloud VM and again after restoring to the production one-vCPU/2-GiB profile.
- `node scripts/verify-cloud-production.mjs` passed nine real public API cases: accepted C++, C, Python, JavaScript and Java; wrong answer; compilation error; runtime error; timeout. Supported languages returned trace events. Every submission rejected anonymous access with 404. Java intentionally has no trace.
- All twenty real learning examples completed through the public production API. Eighteen returned accepted, the diagnostics example returned runtime_error, and the divergence example returned wrong_answer, as intended. All twenty returned captured traces.
- Actual browser Run & inspect: default C++ maximum-subarray program returned `6`, with 72 captured events. Next/previous/last replay controls worked, including an array state diagram and control-flow outcome.
- Actual browser Run autopsy: the original binary-search demonstration completed six tests, correctly flagged its intentional wrong answers and identified the first reference difference at line 8 (`left < right` versus `left <= right`).
- Editing that guard in the live editor and rerunning completed successfully: **6/6 tests passed**. The library intentionally collects comparison traces for failing tests; an all-accepted library run reports verdicts without an unnecessary reference trace.
- Main page, atlas, playground and binary-search route returned 200. Readiness returned ready. The temporary release database-setup endpoint returned 404 and its protected candidate deployment was removed.
- No local Docker installation, payment method or new hosting account was required. No secret files or values were inspected. Production database configuration was used only by protected hosting-side code; the migration created four private `codeautopsy` tables.

## Limits

These checks establish the tested workflows, not perfect animation for every arbitrary program or unlimited hosting capacity. Java returns verdict/output only; C tracing is best effort. Trace/output previews are bounded. Free-tier admission, ownership, pruning and finite snapshot retention are documented in [native execution](../VERCEL-NATIVE-EXECUTION.md).

The example verification script now loads the actual TypeScript export rather than relying on source-formatting-sensitive regex extraction.
