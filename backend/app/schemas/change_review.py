from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


Text = Annotated[str, Field(min_length=1, max_length=2000)]
ObjectId = Annotated[str, Field(min_length=1, max_length=100)]
ReviewStatus = Literal['pending', 'assigned', 'awaiting_review', 'closed']
Disposition = Literal['reference_withdrawn', 'reference_replaced', 'task_terminal', 'no_current_difference']


class StrictRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class ChangeScanRequest(StrictRequest):
    elder_id: ObjectId | None = None


class VersionedRequest(StrictRequest):
    expected_revision: int = Field(ge=1)
    expected_fingerprint: Annotated[str, Field(pattern=r'^[0-9a-f]{64}$')]


class ChangeAssignRequest(VersionedRequest):
    assigned_to: ObjectId
    due_at: AwareDatetime | None = None
    reason: Text


class ReviewEvidence(StrictRequest):
    record_id: ObjectId
    revision: int = Field(ge=1)
    field: Literal['raw_text', 'observations'] = 'observations'
    quote: Annotated[str, Field(min_length=1, max_length=1000)]


class ChangeSubmitRequest(VersionedRequest):
    disposition: Disposition
    note: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=5)
    acknowledged_handover_ids: list[ObjectId] = Field(default_factory=list, max_length=100)


class ChangeReviewRequest(VersionedRequest):
    decision: Literal['accept', 'return']
    note: Text


class ChangeReviewResponse(BaseModel):
    id: str
    elder_id: str
    task_id: str
    reference_id: str
    memory_id: str
    status: ReviewStatus
    revision: int
    assigned_to: str | None
    due_at: str | None
    created_by: str
    created_at: str
    updated_at: str
    closed_by: str | None
    closed_at: str | None
    initial_snapshot: dict
    observations: list[dict]
    submissions: list[dict]
    reviews: list[dict]
    current: dict
    fingerprint: str
    overdue: bool


class ChangeScanResponse(BaseModel):
    as_of: str
    created_ids: list[str]
    updated_ids: list[str]
    scanned_tasks: int
