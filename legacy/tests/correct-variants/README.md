# tests/correct-variants

Alternate CORRECT binary-search implementations (different midpoint
formula, different loop structure, half-open interval done consistently,
etc.) used to check that the diagnostic engine does not flag valid
variants as bugs (section 16 quality gate: "equivalent correct variants
do not trigger unsupported fault claims"). Not populated yet — needs the
alignment/invariant engine (Week 6-7) to be testable against.
