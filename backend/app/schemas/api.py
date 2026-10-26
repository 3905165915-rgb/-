from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, AfterValidator, model_validator

from app.models.entities import AIDraft, CareRecord, CareTask, Elder


def aware_time(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('Timezone offset is required')
    return value


AwareTime = Annotated[datetime, AfterValidator(aware_time)]
Text = Annotated[str, Field(min_length=1, max_length=5000)]


class TaskCandidate(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='allow')
    title: Annotated[str, Field(min_length=1, max_length=300)]
    due_at: AwareTime | None = None
    assigned_to: str | None = None
    condition: str | None = None
    due_text: str | None = None

    @model_validator(mode='after')
    def no_implicit_memory_adoption(self):
        if {'memory_references', 'condition_verification', 'condition_check', 'source_plan_id', 'source_plan_revision',
            'plan_item_key', 'service_date', 'scheduled_at', 'occurrence_key', 'source_plan_snapshot',
            'replaces_task_id'}.intersection(self.model_extra or {}):
            raise ValueError('Use explicit task memory adoption and condition verification endpoints')
        return self


class LoginRequest(BaseModel):
    username: str
    password: str


class DemoLoginRequest(BaseModel):
    role: Literal["admin", "supervisor", "caregiver", "family"]


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    display_name: str


class RecordExtractRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    elder_id: str
    shift_id: str | None = None
    text: str = Field(min_length=1, max_length=5000)


class RecordConfirmRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    expected_revision: int | None = Field(default=None, ge=1)
    observations: list[Text] | None = Field(default=None, min_length=1, max_length=50)
    task_candidates: list[dict] | None = None


class DraftUpdateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    expected_revision: int = Field(ge=1)
    observations: list[Text] | None = Field(default=None, min_length=1, max_length=50)
    task_candidates: list[dict] | None = Field(default=None, max_length=50)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class TaskCompleteRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    result: str = Field(min_length=1, max_length=2000)


class TaskCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

    elder_id: Annotated[str, Field(min_length=1, max_length=100)]
    title: Annotated[str, Field(min_length=1, max_length=300)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)]
    assigned_to: Annotated[str, Field(min_length=1, max_length=100)]
    due_at: AwareTime
    completion_criteria: Annotated[str, Field(min_length=1, max_length=2000)]
    condition: Annotated[str, Field(max_length=1000)] | None = None
    due_text: Annotated[str, Field(max_length=500)] | None = None
    source_type: Literal['manual', 'record'] = 'manual'
    source_id: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    source_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode='after')
    def source_is_explicit(self):
        if self.source_type == 'manual':
            if self.source_id is not None or self.source_revision is not None:
                raise ValueError('Manual tasks cannot include a source object')
        elif not self.source_id or self.source_revision is None:
            raise ValueError('A non-manual task requires source_id and source_revision')
        return self


class ManualRecordRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    elder_id: str
    shift_id: str | None = None
    raw_text: Text
    observations: list[Text] | None = Field(default=None, max_length=50)
    happened_at: AwareTime | None = None
    task_candidates: list[TaskCandidate] = Field(default_factory=list, max_length=50)


class RejectDraftRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    expected_revision: int | None = Field(default=None, ge=1)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class CorrectRecordRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    observations: list[Text] = Field(min_length=1, max_length=50)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]
    expected_revision: int = Field(ge=1)


class VerifiedCorrectionRequest(CorrectRecordRequest):
    expected_impact_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')


class RecordImpactReviewRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    expected_fingerprint: str = Field(pattern=r'^[0-9a-f]{64}$')
    decision: Literal['verified', 'needs_followup']
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class TaskUpdateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=1)
    assigned_to: str | None = None
    due_at: AwareTime | None = None


class TaskTransitionRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    action: Literal['start', 'not_done', 'transfer', 'cancel', 'reopen']
    expected_revision: int = Field(ge=1)
    assigned_to: str | None = None
    reason_code: Literal['elder_refused', 'out', 'unwell', 'staff_shortage', 'equipment', 'family_request', 'other'] | None = None
    note: Annotated[str, Field(max_length=2000)] = ''


class ShiftCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    name: Annotated[str, Field(min_length=1, max_length=100)]
    start_at: AwareTime
    end_at: AwareTime
    caregiver_ids: list[str] = Field(min_length=1, max_length=30)

    @model_validator(mode='after')
    def valid_window(self):
        if self.end_at <= self.start_at or (self.end_at - self.start_at).total_seconds() > 86400:
            raise ValueError('Shift must end after start and last at most 24 hours')
        if len(set(self.caregiver_ids)) != len(self.caregiver_ids):
            raise ValueError('Shift members must be unique')
        return self


class HandoverCreateRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_shift_id: str
    target_shift_id: str


class HandoverSubmitRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    expected_revision: int = Field(ge=1)
    summary: Annotated[str, Field(max_length=5000)] = ''
    approve_ai_summary: bool = False


class HandoverReceiveRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    status: Literal['received', 'clarifying']
    note: Annotated[str, Field(max_length=2000)] = ''
    assigned_to: str | None = None


class ClarificationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class AIReviewRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    expected_revision: int = Field(ge=1)


class QualityScanRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    elder_id: str | None = None
    shift_id: str | None = None
    handover_id: str | None = None
    include_ai: bool = False


class QualityResolveRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    status: Literal['acknowledged', 'not_applicable']
    note: Annotated[str, Field(min_length=1, max_length=2000)]


class MessageResponse(BaseModel):
    message: str


class HealthResponse(BaseModel):
    status: str
    environment: str
    schema_version: int


__all__ = [
    "AIDraft",
    "CareRecord",
    "CareTask",
    "Elder",
    "HealthResponse",
    "LoginRequest",
    "LoginResponse",
    "MessageResponse",
    "RecordConfirmRequest",
    "RecordExtractRequest",
    "TaskCompleteRequest",
]
