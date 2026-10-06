"""
In-memory store — placeholder ONLY for Week 1 so the API skeleton has
something to respond with. Section 15 requires durable job state, an
idempotent outbox pattern, and PostgreSQL persistence — none of that is
here yet. Do not build on top of this for anything beyond wiring checks.
"""

from __future__ import annotations

import uuid

from app.models.submission import SubmissionDetail, SubmissionStatus

_submissions: dict[str, SubmissionDetail] = {}


def create_submission(problem_id: str) -> SubmissionDetail:
    submission_id = str(uuid.uuid4())
    detail = SubmissionDetail(
        submission_id=submission_id,
        problem_id=problem_id,
        status=SubmissionStatus.QUEUED,
        verdicts=[],
    )
    _submissions[submission_id] = detail
    return detail


def get_submission(submission_id: str) -> SubmissionDetail | None:
    return _submissions.get(submission_id)
