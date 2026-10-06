# execution/cpp-instrumenter

The Clang LibTooling instrumentation pass (section 9). This is Week 3-4
scope and the highest-risk item in the whole plan — see
docs/WEEK1_SPIKE.md for why. Not started.

Confirmed in this Week 1 spike: `clang++` 18.1.3 installs cleanly via apt
on the target Ubuntu base (`apt-get install --no-install-recommends
clang`), so the toolchain itself isn't a blocker — writing a LibTooling
pass that evaluates each expression exactly once, preserves short-circuit
behavior, and never double-evaluates a condition (section 9's explicit
constraints) is the actual work.
