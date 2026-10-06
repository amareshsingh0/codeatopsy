"""
LocalProvider — a subprocess-based ExecutionProvider implementation.

WHY THIS EXISTS
This dev container has no network path to a Judge0 deployment (self-hosted
or RapidAPI) — see docs/WEEK1_SPIKE.md. To still prove out "isolated
compilation, execution, and trace collection" for Week 1, this provider
implements the same interface against g++/clang++ + subprocess, with
best-effort CPU/memory/wall-clock limits via resource.setrlimit and a
timeout.

WHAT THIS IS NOT
Section 6 of the blueprint requires: no network access by default (incl.
cloud metadata endpoints), unprivileged execution with minimal capabilities,
syscall restrictions, no container-management socket mounts, and an
ephemeral writable directory. A bare subprocess.run() with rlimits gives
none of the namespace/seccomp/cgroup isolation that real untrusted student
code needs. This provider is for exercising the ORCHESTRATION CONTRACT
(compile -> run -> limits -> collect) during local development and CI —
it must never be pointed at actual untrusted submissions in a real
deployment. Judge0Provider (or an equivalent real sandbox) is required
before this system accepts submissions from students.
"""

from __future__ import annotations

import os
import resource
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Optional

from .base import (
    CompileRequest,
    CompileResult,
    ExecutionProvider,
    ExecutionStatus,
    ResourceLimits,
    RunRequest,
    RunResult,
)

_COMPILER = "g++"  # override to "clang++" to match the pinned toolchain decision
_STD_FLAG = "-std=c++17"


class LocalProvider(ExecutionProvider):
    def __init__(self, workdir_root: Optional[str] = None):
        self._root = Path(workdir_root or tempfile.mkdtemp(prefix="codeautopsy_local_"))
        self._binaries: dict[str, Path] = {}
        self._next_id = 0

    def compile(self, request: CompileRequest) -> CompileResult:
        build_dir = self._root / f"build_{self._next_id}"
        self._next_id += 1
        build_dir.mkdir(parents=True, exist_ok=True)

        written = []
        for filename, source in request.source_files.items():
            path = build_dir / filename
            path.write_text(source)
            written.append(str(path))

        binary_path = build_dir / "a.out"
        cmd = [_COMPILER, _STD_FLAG, "-O0", "-Wall", *request.extra_flags,
               *written, "-o", str(binary_path)]

        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)

        if proc.returncode != 0:
            return CompileResult(
                status=ExecutionStatus.COMPILE_ERROR,
                diagnostics=proc.stderr,
            )

        binary_ref = str(binary_path)
        self._binaries[binary_ref] = binary_path
        return CompileResult(
            status=ExecutionStatus.OK,
            diagnostics=proc.stderr,  # warnings, if any, with -Wall
            binary_ref=binary_ref,
        )

    def run(self, binary_ref: str, request: RunRequest) -> RunResult:
        limits = request.limits

        def _apply_rlimits():
            # Best-effort resource caps. Not a security boundary — see
            # module docstring. A determined hostile program can still
            # exhaust descriptors, fork bomb (mitigated weakly by
            # RLIMIT_NPROC), or otherwise misbehave beyond what rlimits
            # alone catch; that is exactly why section 6 requires real
            # sandboxing (namespaces/cgroups/seccomp) before accepting
            # untrusted submissions.
            cpu = int(limits.cpu_time_seconds) + 1
            resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
            mem_bytes = limits.memory_mb * 1024 * 1024
            resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
            resource.setrlimit(resource.RLIMIT_NPROC, (limits.max_processes + 1,
                                                         limits.max_processes + 1))

        start = time.monotonic()
        try:
            proc = subprocess.run(
                [binary_ref],
                input=request.stdin_text,
                capture_output=True,
                text=True,
                timeout=limits.wall_time_seconds,
                preexec_fn=_apply_rlimits,
            )
            wall = time.monotonic() - start

            stdout = proc.stdout[: limits.max_output_bytes]
            stderr = proc.stderr[: limits.max_output_bytes]
            truncated_output = (len(proc.stdout) > limits.max_output_bytes
                                 or len(proc.stderr) > limits.max_output_bytes)

            if proc.returncode < 0:
                # killed by a signal (SIGSEGV, SIGABRT, SIGKILL from rlimit, ...)
                status = (ExecutionStatus.MEMORY_LIMIT
                          if proc.returncode == -9 else ExecutionStatus.RUNTIME_ERROR)
            elif proc.returncode != 0:
                status = ExecutionStatus.RUNTIME_ERROR
            elif truncated_output:
                status = ExecutionStatus.OUTPUT_LIMIT
            else:
                status = ExecutionStatus.OK

            return RunResult(
                status=status,
                stdout=stdout,
                stderr=stderr,
                exit_code=proc.returncode,
                cpu_time_seconds=None,  # not captured without a resource.wait4 wrapper
                wall_time_seconds=wall,
                memory_kb=None,         # not captured without /usr/bin/time -v or cgroup accounting
            )
        except subprocess.TimeoutExpired as e:
            wall = time.monotonic() - start
            return RunResult(
                status=ExecutionStatus.TIMEOUT,
                stdout=(e.stdout or ""),
                stderr=(e.stderr or ""),
                exit_code=None,
                cpu_time_seconds=None,
                wall_time_seconds=wall,
                memory_kb=None,
            )

    def cleanup(self, binary_ref: str) -> None:
        path = self._binaries.pop(binary_ref, None)
        if path and path.exists():
            path.unlink()
