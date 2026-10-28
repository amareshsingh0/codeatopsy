# Visual learning and interface research

Research cutoff: **28 October 2026**. Findings below were checked against official documentation or primary provider announcements. This is a product-design comparison, not a measured model ranking or a claim that CodeAutopsy is universally better.

## What the current products establish

| Source                                                                                                                                                                            | Verified direction                                                                                                                                                                                                 | Application to CodeAutopsy                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpenAI: Visualizations](https://learn.chatgpt.com/docs/visualizations)                                                                                                           | Interactive diagrams, charts and simulations support exploration of relationships and changes. The documentation recommends the smallest visual format that fits the task; availability varies by surface/account. | Use small inspectable diagrams and replay controls; retain a durable website and actual run evidence.                                          |
| [OpenAI: UI guidelines](https://developers.openai.com/plugins/concepts/ui-guidelines)                                                                                             | Rich editing and interactive diagrams benefit from a larger focused surface; familiar controls, typography and accessible components matter.                                                                       | Give replay its own workspace, with optional visual focus and consistent controls.                                                             |
| [Anthropic: interactive visuals, March 12](https://claude.com/resources/articles/claude-builds-visuals)                                                                           | Inline charts and diagrams can evolve during a conversation. These explanatory visuals differ from persistent, shareable Artifacts.                                                                                | Let learners inspect the current event and change views without losing their source or replay position.                                        |
| [Google: Gemini simulations, August 24](https://workspaceupdates.googleblog.com/2026/08/generate-interactive-simulations-and-models-in-the-Gemini-app.html)                       | Gemini can produce functional simulations, grids and tables tailored to the question.                                                                                                                              | Choose a representation appropriate to captured arrays, matrices, scalars and structures. Avoid using one sorting animation for every concept. |
| [Google Research: learning interactives, September 17](https://research.google/blog/the-future-of-practice-enabling-teachers-to-create-learning-interactives-with-generative-ui/) | Research emphasizes learning objectives, guided inquiry, factual accuracy, scaffolded hints/feedback and iterative interaction testing. It does not establish that decorative animation alone improves learning.   | Add optional prediction checks against recorded values, short explanations and visible before/after changes; test actual interactions.         |

The opportunity here is a narrow, testable workflow: **submitted source → actual execution → captured state → synchronized visual explanation → edit and rerun**. Generated illustrations help discovery and branding. They are not evidence of what an arbitrary program did. No extra GPT/Gemini/Claude API call is needed for stepping through an existing run.

## Problems found in the previous interface

- Editor, transport, explanation, state, history and source were stacked. Important evidence was separated by scrolling.
- Long serialized values overwhelmed the explanation. Merely observing the same value could be described as a change.
- Extra history/table work happened even when those details were closed. History scans repeated on every selected event.
- Graph nodes were visible but could not be clicked; narrow screens needed explicit code/visual modes.
- The home-page interactive preview represented only binary search, despite the broader program catalog.

## Implemented design

1. Separate **Code & input**, **Visual replay**, and **Run evidence**. Preserve source and replay state when switching views. Stop playback when the replay is hidden or the browser is backgrounded.
2. Show a compact, synchronized nine-line source window beside the visual state. Full source/reference editors remain an explicit action.
3. Explain actual captured changes with previous/current values. First observation, unchanged observation and changed value have different wording. Cell inspection works by click/keyboard and includes the previous value.
4. Add **Next value**, layout/spacing preferences and optional **Pause & predict**. Prediction feedback comes from a real future trace event, with bounded small-value questions, rather than an inferred answer.
5. Add responsive Code/Visual switching, zoom/fit and keyboard-selectable structure nodes. Ambiguous adjacency-list interpretations still require user confirmation.
6. Add a guided atlas entry path, results counts and a clear-filter recovery action. Home previews cover list mutation, graph exploration and DP tables, explicitly labelled as teaching simulations.

## Performance boundaries

- No rendering framework, animation dependency, physics engine or per-step network request was added.
- Index each received trace once. Binary search supplies event navigation and bounded history windows. Value parsing is memoized when captured text stays the same.
- Render at most 24 array cells, 24 history points, 30 event rows and nine compact source lines at once. Existing structural limits remain 60 nodes and 150 edges.
- Mount history, the complete variable table, raw values, event log and the full replay editor only when requested. The replay component itself is loaded after a run produces trace data.
- Keep playback user-initiated. Use short color/height transitions for state changes and respect [reduced motion](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion). No infinite decorative motion is needed to understand a result.
- Prefer 44-pixel primary controls; [WCAG 2.2 target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) defines the lower minimum and exceptions. This implementation is not a blanket accessibility certification.
- Display preferences store only approved layout/spacing values locally, never submitted code or credentials.

`node scripts/benchmark-replay.mjs` measures indexing and 1,000 lookups over 20,000 synthetic events. It explicitly reports helper CPU timings; those are not browser FPS, low-end-phone performance or learning-outcome measurements. Real viewport, interaction, execution and production checks are recorded separately.

## Validation standard

Use actual browser runs to verify source sync, cell changes, graph inspection, display preferences, evidence navigation and edited-program reruns. Check phone/tablet/desktop widths and horizontal overflow. Verify compilation/runtime failures and timeouts still expose original evidence. Repeat full typechecks and meaningful regressions after dependency changes.

Plain English and familiar metaphors are intended to make the interface approachable. No usability study with children was performed; effectiveness for any age or a numerical advantage over another product remains unmeasured.
