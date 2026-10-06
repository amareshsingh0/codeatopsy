"""
ExecutionProvider interface (section 4 / section 5 of the blueprint).

Every execution backend — Judge0, a self-hosted sandbox, or the local
fallback used for this Week 1 spike — implements this same contract so the
orchestration layer never needs to know which one is behind it.

Judge mode and autopsy mode both go through this interface:
  - judge mode: run(..., collect_trace=False)
  - autopsy mode: run(..., collect_trace=True) against the instrumented build

Design constraints this interface encodes (section 5, section 6):
  - trace artifacts are returned SEPARATELY from stdout — never mixed in.
  - limit violations produce a terminal status, not partial success.
  - the caller never gets raw filesystem paths from inside the sandbox;
    only bytes/text the provider has already collected out of it.
"""

from __future__ import annotations

import abc
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ExecutionStatus(str, Enum):
    OK = "ok"                          # ran to completion within limits
    COMPILE_ERROR = "compile_error"
    RUNTIME_ERROR = "runtime_error"    # nonzero exit / signal (e.g. segfault)
    TIMEOUT = "timeout"                # wall-clock limit hit
    MEMORY_LIMIT = "memory_limit"
    OUTPUT_LIMIT = "output_limit"      # stdout/stderr exceeded cap
    TRACE_LIMIT = "trace_limit"        # trace artifact exceeded cap (partial)
    INTERNAL_ERROR = "internal_error"  # provider/sandbox itself failed


@dataclass
class ResourceLimits:
    cpu_time_seconds: float = 2.0
    wall_time_seconds: float = 5.0
    memory_mb: int = 256
    max_processes: int = 1
    max_output_bytes: int = 1_000_000
    max_trace_bytes: int = 20_000_000


@dataclass
class CompileRequest:
    source_files: dict[str, str]       # filename -> source text
    entry_language: str = "cpp17"
    extra_flags: list[str] = field(default_factory=list)
    instrumented: bool = False         # True => autopsy-mode build


@dataclass
class RunRequest:
    stdin_text: str
    limits: ResourceLimits = field(default_factory=ResourceLimits)
    collect_trace: bool = False        # only meaningful for instrumented builds


@dataclass
class CompileResult:
    status: ExecutionStatus
    diagnostics: str
    binary_ref: Optional[str] = None   # provider-internal handle, opaque to caller


@dataclass
class RunResult:
    status: ExecutionStatus
    stdout: str
    stderr: str
    exit_code: Optional[int]
    cpu_time_seconds: Optional[float]
    wall_time_seconds: Optional[float]
    memory_kb: Optional[int]
    trace_artifact: Optional[bytes] = None      # present only if collect_trace=True and produced
    trace_truncated: bool = False
    instrumentation_mismatch: bool = False       # observable behavior changed vs uninstrumented run


class ExecutionProvider(abc.ABC):
    """Everything the orchestration layer needs from a sandbox backend."""

    @abc.abstractmethod
    def compile(self, request: CompileRequest) -> CompileResult:
        ...

    @abc.abstractmethod
    def run(self, binary_ref: str, request: RunRequest) -> RunResult:
        ...

    @abc.abstractmethod
    def cleanup(self, binary_ref: str) -> None:
        """Release/delete any artifacts tied to binary_ref."""
        ...
