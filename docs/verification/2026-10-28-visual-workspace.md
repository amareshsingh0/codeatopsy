# Visual workspace verification — 28 October 2026

Research and design rationale: [October review](../VISUAL-UX-RESEARCH-2026-10.md).

## Completed local checks

- Strict TypeScript across all seven packages and the full package regression suite passed after the dependency refresh. The web suite includes four new real-state insight/navigation tests (31 web tests total).
- Six disposable PostgreSQL integration tests passed, including concurrent admission, ownership, launch fencing, expiry and rate limits.
- The patched cloud bundle passed all eleven real native VM cases on the production 1-vCPU/2-GiB profile. Snapshot `snap_Nm98cHavATFW96mDxSWEeBzCryJO` has finite 30-day retention. Bundle SHA-256: `761401F682875A62D6C2894341A19454D395CB44D418D87F100B1BCDAC7C22FF`.
- The production dependency audit reported zero known vulnerabilities after Next.js 16.4.3, sharp 0.35.5, Fastify 5.12.7, Zod 4.6.7 and patched fast-uri resolutions were installed. This is an audit result, not a guarantee of no security defects.
- Actual browser array run returned the expected output. “Next value” showed the real `[1]` update from `1` to `9`. Phone Code/Visual switching preserved step 3 and highlighted source line 2.
- Actual graph run returned `['A', 'B', 'C', 'D']`, with 34 captured events. Explicit graph interpretation, node B selection and zoom worked. The graph viewport remained bounded to 380px high.
- Optional prediction practice correctly accepted `A` for the next captured `vertex` update. Compact spacing and visual-focus selection changed the rendered layout and persisted across a subsequent run.
- Browser viewport checks at 320, 390, 768 and 1440 pixels found no page-level horizontal overflow in the tested workspace states. Measured document widths matched the client widths (305, 375, 753 and 1425 respectively, after the desktop browser's scrollbar). Visible primary transport buttons measured 44px high at the narrowest viewport. These are viewport checks, not tests on physical phones/tablets or every font-size setting.
- A real browser submission with a 3,500-iteration Python loop returned `3500` and **7,004 recorded events**. Jumping to the final event worked. Opening its event log rendered 30 event rows; closed variable history rendered zero history points. The entire page had 669 elements in that inspected state, rather than one row per event.
- `node scripts/benchmark-replay.mjs`: 20,000 synthetic events, 1,000 queries, indexing 14.23ms, lookup p95 0.054ms on the test host. Scope is Node helper CPU only; browser layout, paint, real-device performance and learning outcomes are excluded.

## Release checks

Public production deployment, GitHub CI and public execution smoke results are recorded after promotion. The local checks above do not by themselves establish public deployment success.
