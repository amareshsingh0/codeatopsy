"""
TraceEvent — Python side of the schema in blueprint section 8.

This is the CONCEPTUAL envelope from the doc, with `payload` still a loose
dict. The doc is explicit that production should replace `payload` with a
discriminated union per `kind` — that's Week 3-4 work once the instrumented
subset (which fields each event kind actually needs) is nailed down. Kept
loose here so Week 1/2 plumbing (API contracts, storage shape) can be built
without blocking on the final instrumentation design.

Source of truth for both sides: this file and trace_event.ts must be
regenerated from one definition once packages/schemas/ has a real
generator wired up (section 18 says as much) — right now they are
hand-mirrored and WILL drift if one is edited without the other.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class TraceEventKind(str, Enum):
    ASSIGN = "ASSIGN"
    READ = "READ"
    WRITE = "WRITE"
    CONDITION = "CONDITION"
    BRANCH = "BRANCH"
    CALL = "CALL"
    RETURN = "RETURN"
    CHECKPOINT = "CHECKPOINT"
    OUTPUT = "OUTPUT"
    DIAGNOSTIC = "DIAGNOSTIC"


class SourceSpan(BaseModel):
    file_id: str = Field(alias="fileId")
    start_line: int = Field(alias="startLine")
    start_column: int = Field(alias="startColumn")
    end_line: Optional[int] = Field(default=None, alias="endLine")
    end_column: Optional[int] = Field(default=None, alias="endColumn")

    model_config = {"populate_by_name": True}


class TraceEvent(BaseModel):
    schema_version: str = Field(default="1", alias="schemaVersion")
    execution_id: str = Field(alias="executionId")
    event_id: str = Field(alias="eventId")
    sequence: int
    frame_id: str = Field(alias="frameId")
    operation_id: str = Field(alias="operationId")
    source: SourceSpan
    kind: TraceEventKind
    payload: dict[str, Any] = Field(default_factory=dict)
    data_dependencies: list[str] = Field(default_factory=list, alias="dataDependencies")
    control_dependencies: list[str] = Field(default_factory=list, alias="controlDependencies")

    model_config = {"populate_by_name": True}
