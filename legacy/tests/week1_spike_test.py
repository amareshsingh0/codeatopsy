"""
Week 1 spike: proves the ExecutionProvider contract (compile -> run ->
enforce limits -> collect output) works end to end against LocalProvider,
and reproduces the golden failing example from section 11 of the blueprint.

Run: python3 tests/week1_spike_test.py
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from execution.providers import LocalProvider, CompileRequest, RunRequest, ResourceLimits, ExecutionStatus

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROBLEM_DIR = ROOT / "problems" / "binary-search"


def read(name: str) -> str:
    return (PROBLEM_DIR / name).read_text()


def run_case(label: str, student_or_reference: str) -> str:
    provider = LocalProvider()
    compile_result = provider.compile(CompileRequest(
        source_files={
            "solution.cpp": read(student_or_reference),
            "harness.cpp": read("harness.cpp"),
        },
    ))
    assert compile_result.status == ExecutionStatus.OK, (
        f"[{label}] compile failed:\n{compile_result.diagnostics}"
    )
    if compile_result.diagnostics.strip():
        print(f"  ({label} compiler diagnostics: {compile_result.diagnostics.strip()!r})")

    run_result = provider.run(compile_result.binary_ref, RunRequest(
        stdin_text=(PROBLEM_DIR / "input.txt").read_text(),
        limits=ResourceLimits(cpu_time_seconds=2, wall_time_seconds=5, memory_mb=256),
    ))
    provider.cleanup(compile_result.binary_ref)

    assert run_result.status == ExecutionStatus.OK, f"[{label}] run status: {run_result.status}"
    return run_result.stdout.strip()


def test_golden_failing_example():
    print("=== golden failing example (section 11) ===")
    student_output = run_case("student", "student.cpp")
    reference_output = run_case("reference", "reference.cpp")
    print(f"  student   -> {student_output}")
    print(f"  reference -> {reference_output}")

    assert student_output == "-1", f"expected student to return -1, got {student_output}"
    assert reference_output == "6", f"expected reference to return 6, got {reference_output}"
    assert student_output != reference_output, "expected an observable divergence"
    print("  PASS: divergence reproduced exactly as predicted by the worked example.\n")


def test_timeout_is_enforced():
    print("=== timeout enforcement (infinite_loop.cpp) ===")
    provider = LocalProvider()
    infinite_loop_src = (ROOT / "tests" / "security" / "infinite_loop.cpp").read_text()

    compile_result = provider.compile(CompileRequest(source_files={"loop.cpp": infinite_loop_src}))
    assert compile_result.status == ExecutionStatus.OK, compile_result.diagnostics

    import time
    start = time.monotonic()
    run_result = provider.run(compile_result.binary_ref, RunRequest(
        stdin_text="",
        limits=ResourceLimits(cpu_time_seconds=1, wall_time_seconds=2, memory_mb=64),
    ))
    elapsed = time.monotonic() - start
    provider.cleanup(compile_result.binary_ref)

    print(f"  status={run_result.status} elapsed={elapsed:.2f}s (wall_time_seconds limit=2)")
    assert run_result.status == ExecutionStatus.TIMEOUT, f"expected TIMEOUT, got {run_result.status}"
    assert elapsed < 4.0, f"provider took too long to kill the runaway process: {elapsed:.2f}s"
    print("  PASS: runaway process was killed at the wall-clock limit, not left running.\n")


if __name__ == "__main__":
    test_golden_failing_example()
    test_timeout_is_enforced()
    print("All Week 1 spike checks passed.")
