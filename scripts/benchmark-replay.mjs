// Deterministic helper benchmark, not a browser FPS or learning-outcome claim.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
const require = createRequire(new URL("../apps/execution-node/package.json", import.meta.url));
const { build } = require("esbuild");
const bundle = await build({
  stdin: {
    contents:
      "export * from './apps/web/src/lib/replay-insights.ts';export * from './apps/web/src/lib/trace-state.ts';",
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { createTraceIndex, createReplayNavigation, historyWindow } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const events = Array.from({ length: 20000 }, (_, seq) => ({
  seq,
  kind: seq % 5 === 0 ? "branch" : "assign",
  line: (seq % 300) + 1,
  depth: 0,
  name: `value_${seq % 50}`,
  value: String(seq),
  cond: "count < limit",
  taken: true,
}));
const start = performance.now();
const indexed = createTraceIndex(events),
  navigation = createReplayNavigation(events);
const indexingMs = performance.now() - start;
const timings = [];
for (let i = 0; i < 1000; i++) {
  const position = (i * 7919) % events.length;
  const now = performance.now();
  indexed.snapshot(position);
  navigation.next(position, "value");
  historyWindow(indexed.histories.get(`value_${position % 50}`) ?? [], position);
  timings.push(performance.now() - now);
}
timings.sort((a, b) => a - b);
console.log(
  JSON.stringify(
    {
      scope: "Node helper CPU only; excludes browser paint/layout",
      events: events.length,
      queries: timings.length,
      indexingMs: Number(indexingMs.toFixed(2)),
      seekP95Ms: Number(timings[949].toFixed(3)),
      sourceRows: 9,
      historyPoints: 24,
      arrayCellsPerPage: 24,
      eventRowsPerPage: 30,
      diagramNodes: 60,
      diagramEdges: 150,
    },
    null,
    2,
  ),
);
