from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.core import store
from app.models.submission import (
    SubmissionCreateRequest,
    SubmissionCreateResponse,
    SubmissionDetail,
    SubmissionStatus,
)

router = APIRouter(prefix="/submissions", tags=["submissions"])


@router.post("", response_model=SubmissionCreateResponse, status_code=202)
def create_submission(body: SubmissionCreateRequest) -> SubmissionCreateResponse:
    # Week 2 scope: enqueue a real Celery job here instead of returning
    # a synthetic job id, and persist submission+job in one transaction
    # with an outbox record (section 15's job reliability requirements).
    detail = store.create_submission(body.problem_id)
    job_id = str(uuid.uuid4())
    return SubmissionCreateResponse(
        submission_id=detail.submission_id,
        job_id=job_id,
        status=detail.status,
    )


@router.get("/{submission_id}", response_model=SubmissionDetail)
def get_submission(submission_id: str) -> SubmissionDetail:
    detail = store.get_submission(submission_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="submission not found")
    return detail


@router.get("/{submission_id}/tests")
def get_submission_tests(submission_id: str):
    detail = store.get_submission(submission_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="submission not found")
    return detail.verdicts
