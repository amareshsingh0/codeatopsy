# Visual debugging design research

## Applied decisions

1. Runtime state is the primary explanation. [Python Tutor](https://pythontutor.com/visualize.html) demonstrates synchronized source, objects and stack views. CodeAutopsy ties its replay cursor, recorded variables and source markers to the same captured event. It preserves uncertainty where instrumentation is incomplete.
2. The learner controls pacing. [VisuAlgo](https://visualgo.net/en) provides controllable structure and algorithm animations. CodeAutopsy adds pause, exact scrubbing, speed selection, indexed history jumps and independent reference exploration after alignment ends. Generated imagery remains labelled concept art.
3. Progressive disclosure keeps the first task clear. [Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/) recommends exposing primary actions and clearly labelled paths to advanced detail. Replay/state stay prominent; source comparison, raw values, full diagnostics and event search are discoverable expandable sections.
4. Explanations use familiar terms. [W3C clear-content guidance](https://www.w3.org/WAI/WCAG2/supplemental/objectives/o3-clear-content/) and [writing guidance](https://www.w3.org/WAI/tips/writing/) inform Learn mode's labelled boxes, yes/no decisions and short English explanations. This does not establish reading comprehension for every 5–10-year-old; user testing is still needed.
5. Motion follows interaction and respects preferences. [W3C reduced-motion technique](https://www.w3.org/WAI/WCAG22/Techniques/css/C39.html) informs animation/transition suppression. Decoration uses a brief entrance; automatic execution replay begins only when the user presses Play. There is no endless background movement.
6. Reflow and touch access are tested. [W3C reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow) sets the 320-CSS-pixel target. [Target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum) informs spaced controls and generally 44-pixel action targets. Dense visual data scrolls inside labelled panels instead of widening the whole page.
7. Scaling must preserve honesty. [OpenTelemetry](https://opentelemetry.io/docs/concepts/observability-primer/) distinguishes service reliability from mere uptime. The website checks actual worker readiness and returns useful configuration/service failures. [Postgres SKIP LOCKED](https://www.postgresql.org/docs/current/sql-select.html) supports independent durable queue consumers; token-fenced leases handle stale workers.

## Comparison boundary

October ChatGPT visual tools were a user-provided quality reference. No measurable claim of "100x better" is made. The acceptance criteria here are faithful recorded data, understandable interaction, responsiveness, bounded browser work, meaningful execution diagnostics and verified deployment status.

## Asset system

24 independent imagegen outputs form a consistent forest/mint/coral/ivory visual language: three hero/feature pieces, twenty distinct concept covers, one transparent logo. The atlas covers data structures, algorithms and execution diagnostics. Runtime diagrams are SVG/CSS generated from evidence, so they can change with arbitrary supported inputs. Assets are served as small WebP derivatives through Next Image with stable dimensions and responsive sizes.
