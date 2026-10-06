"""
Judge0Provider — ExecutionProvider backed by a Judge0 CE deployment.

STATUS: WRITTEN, NOT LIVE-TESTED.
This dev container's network egress is allowlisted to package registries
(pypi, npm, github, etc.) only — it cannot reach judge0-ce.p.rapidapi.com
or a self-hosted Judge0 instance. This client is written against the
documented Judge0 CE REST contract and is ready to point at a real
deployment, but every item in the "needs live verification" list in
docs/WEEK1_SPIKE.md is still open. Do not treat this file as evidence
that the integration gate (blueprint section 5) has passed.

Known gaps this class does NOT solve yet (tracked in WEEK1_SPIKE.md):
  - Trace artifact retrieval: Judge0's submission model has stdout/stderr/
    compile_output, but no first-class "extra binary artifact" channel.
    Getting a trace file OUT alongside judged stdout likely means either
    (a) base64-encoding the trace into stdout with a delimiter and
    splitting it order-side, which risks colliding with real program
    output, or (b) using Judge0's `additional_files`/callback mechanism
    if the deployment supports it, or (c) not using Judge0 for autopsy-mode
    (instrumented) runs at all and only using it for judge-mode. This is
    the single biggest open question from the integration gate.
  - Compiler/flag control: hosted Judge0 (RapidAPI) does not let you pass
    arbitrary extra compiler flags or inject a LibTooling-built binary as
    the "compiler" for a language_id — this needs either a self-hosted
    Judge0 with a custom language definition, or abandoning Judge0 for the
    instrumented-build path specifically.
  - language_id for C++ varies by Judge0 version and is NOT hardcoded
    below — call list_languages() against the real deployment and pin
    the ID (and compiler version) explicitly before relying on it.
"""

from __future__ import annotations

import base64
import time
from dataclasses import dataclass
from typing import Optional

import requests  # not yet in requirements.txt at time of writing — add it

from .base import (
    CompileRequest,
    CompileResult,
    ExecutionProvider,
    ExecutionStatus,
    RunRequest,
    RunResult,
)

_JUDGE0_STATUS_ACCEPTED = 1
_JUDGE0_STATUS_PROCESSING = 2
# 3 = Accepted (checker match), 4 = Wrong Answer, 5 = Time Limit Exceeded,
# 6 = Compilation Error, 7-12 = various Runtime Errors, 13 = Internal Error,
# 14 = Exec Format Error. Pin the exact table from the live deployment's
# /statuses endpoint — Judge0 has changed these across versions.
_STATUS_MAP_NOTE = (
    "status.id mapping below is from Judge0 CE docs at time of writing; "
    "MUST be re-verified against the actual deployed instance's /statuses "
    "endpoint before trusting it in production."
)


@dataclass
class Judge0Config:
    base_url: str                      # e.g. self-hosted URL, or RapidAPI base
    api_key: Optional[str] = None      # required for RapidAPI-hosted Judge0
    api_key_header: str = "X-RapidAPI-Key"
    language_id: int = 54              # PIN THIS from /languages before use — not verified here
    poll_interval_seconds: float = 0.5
    poll_timeout_seconds: float = 20.0


class Judge0Provider(ExecutionProvider):
    def __init__(self, config: Judge0Config):
        self._config = config
        self._session = requests.Session()
        if config.api_key:
            self._session.headers[config.api_key_header] = config.api_key

    def compile(self, request: CompileRequest) -> CompileResult:
        # Judge0 compiles and runs as a single "submission" — there is no
        # separate compile step in the API. We do a run with empty stdin
        # and treat a compile_output-only failure as CompileResult failure,
        # then hand the *source* forward as the "binary_ref" since Judge0
        # recompiles on every submission (no persisted binary handle).
        if len(request.source_files) != 1:
            # Judge0's single-file submission model doesn't map cleanly onto
            # multi-file builds (student.cpp + harness.cpp). Needs resolving
            # before this can run the actual problem set — see WEEK1_SPIKE.md.
            raise NotImplementedError(
                "Judge0Provider.compile: multi-file source sets (e.g. "
                "solution + harness) are not yet supported — Judge0's "
                "submission model is single-file. Concatenation or a "
                "self-hosted multi-file workaround is needed."
            )

        source = next(iter(request.source_files.values()))
        return CompileResult(
            status=ExecutionStatus.OK,
            diagnostics="",
            binary_ref=source,  # deferred: Judge0 compiles at run() time
        )

    def run(self, binary_ref: str, request: RunRequest) -> RunResult:
        source = binary_ref  # see compile() note above
        payload = {
            "source_code": base64.b64encode(source.encode()).decode(),
            "language_id": self._config.language_id,
            "stdin": base64.b64encode(request.stdin_text.encode()).decode(),
            "cpu_time_limit": request.limits.cpu_time_seconds,
            "wall_time_limit": request.limits.wall_time_seconds,
            "memory_limit": request.limits.memory_mb * 1024,  # Judge0 wants KB
            "enable_network": False,
        }

        submit = self._session.post(
            f"{self._config.base_url}/submissions",
            params={"base64_encoded": "true", "wait": "false"},
            json=payload,
            timeout=10,
        )
        submit.raise_for_status()
        token = submit.json()["token"]

        deadline = time.monotonic() + self._config.poll_timeout_seconds
        result_json = None
        while time.monotonic() < deadline:
            poll = self._session.get(
                f"{self._config.base_url}/submissions/{token}",
                params={"base64_encoded": "true"},
                timeout=10,
            )
            poll.raise_for_status()
            body = poll.json()
            if body.get("status", {}).get("id", _JUDGE0_STATUS_PROCESSING) not in (
                _JUDGE0_STATUS_ACCEPTED, _JUDGE0_STATUS_PROCESSING,
            ):
                result_json = body
                break
            time.sleep(self._config.poll_interval_seconds)

        if result_json is None:
            return RunResult(
                status=ExecutionStatus.INTERNAL_ERROR,
                stdout="", stderr="polling timed out waiting on Judge0",
                exit_code=None, cpu_time_seconds=None,
                wall_time_seconds=None, memory_kb=None,
            )

        def _b64(field: str) -> str:
            val = result_json.get(field)
            return base64.b64decode(val).decode(errors="replace") if val else ""

        status_id = result_json.get("status", {}).get("id")
        status = {
            3: ExecutionStatus.OK,
            5: ExecutionStatus.TIMEOUT,
            6: ExecutionStatus.COMPILE_ERROR,
        }.get(status_id, ExecutionStatus.RUNTIME_ERROR)

        return RunResult(
            status=status,
            stdout=_b64("stdout"),
            stderr=_b64("stderr") or _b64("compile_output"),
            exit_code=result_json.get("exit_code"),
            cpu_time_seconds=float(result_json["time"]) if result_json.get("time") else None,
            wall_time_seconds=float(result_json["wall_time"]) if result_json.get("wall_time") else None,
            memory_kb=result_json.get("memory"),
            # trace_artifact deliberately left None — see module docstring gap list.
        )

    def cleanup(self, binary_ref: str) -> None:
        # No persisted server-side resource to release in this model.
        return None
