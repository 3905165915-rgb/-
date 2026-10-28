"""Additive contract for grounded life-care suggestions and human decisions."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.api import AwareTime, TaskCreateRequest
from app.schemas.memory import MemoryScene

Text = Annotated[str, Field(min_length=1, max_length=2000)]
ObjectId = Annotated[str, Field(min_length=1, max_length=100)]


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class AdviceGenerate(Strict):
    scene: MemoryScene
    shift_id: ObjectId | None = None
    lookback_days: int = Field(default=30, ge=1, le=90, strict=True)


class AdviceCitation(Strict):
    source_id: ObjectId
    quote: Annotated[str, Field(min_length=4, max_length=1000)]


class AdvicePoint(Strict):
    title: Annotated[str, Field(min_length=1, max_length=150)]
    action: Text
    rationale: Text
    uncertainty: Text
    condition: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    citations: list[AdviceCitation] = Field(min_length=1, max_length=10)


class AdviceOutput(Strict):
    suggestions: list[AdvicePoint] = Field(max_length=5)


class AdviceAdopt(Strict):
    expected_revision: int = Field(ge=1, strict=True)
    # The client confirms all scheduling fields. The model never chooses an ID.
    task: TaskCreateRequest
    reason: Text


class AdviceReject(Strict):
    expected_revision: int = Field(ge=1, strict=True)
    reason: Text


class AdviceFeedback(Strict):
    expected_revision: int = Field(ge=1, strict=True)
    expected_task_revision: int = Field(ge=1, strict=True)
    response: Literal['accepted', 'declined', 'unclear', 'not_obtained']
    observation: Text
    happened_at: AwareTime
    shift_id: ObjectId | None = None
    followup: Literal['none', 'observe', 'supervisor_review']
    followup_assigned_to: ObjectId | None = None
    followup_due_at: AwareTime | None = None


class AdviceReview(Strict):
    expected_revision: int = Field(ge=1, strict=True)
    expected_feedback_fingerprint: Annotated[str, Field(pattern='^[0-9a-f]{64}$')]
    decision: Literal['continue_trial', 'adjust', 'stop', 'insufficient_evidence']
    note: Text
