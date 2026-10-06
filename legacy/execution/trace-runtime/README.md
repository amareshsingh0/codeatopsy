# execution/trace-runtime

Runtime support the instrumented binary links against — buffers trace
events, enforces trace size limits, serializes to the wire format defined
in `packages/schemas/trace_event.py` / `.ts`. Not started; depends on the
instrumentation pass shape (execution/cpp-instrumenter).
