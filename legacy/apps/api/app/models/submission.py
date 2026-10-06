from __future__ import annotations

from enum import Enum
from typing import Optional

from pydantic import BaseModel


class SubmissionStatus(str, Enum):
    QUEUED = "queued"
    JUDGING = "judging"
    JUDGED = "judged"
    FAILED = "failed"


class SubmissionCreateRequest(BaseModel):
    problem_id: str
    source_code: str
    language: str = "cpp17"


class SubmissionCreateResponse(BaseModel):
    """Long-running action -> accepted response + job identifier (section 15)."""
    submission_id: str
    job_id: str
    status: SubmissionStatus


class TestVerdict(BaseModel):
    test_id: str
    passed: bool
    stdout_excerpt: Optional[str] = None
    status: str  # mirrors execution.providers.base.ExecutionStatus values


class SubmissionDetail(BaseModel):
    submission_id: str
    problem_id: str
    status: SubmissionStatus
    verdicts: list[TestVerdict] = []
