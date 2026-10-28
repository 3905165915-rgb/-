"""Contracts for the elder-centred workflow. Permissions are server controlled."""
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, model_validator
from app.schemas.change_review import StrictRequest
from app.schemas.planning import AssessmentCreate, PlanItem
from datetime import date
from app.schemas.memory import MemoryScene


class UnderstandingDecision(StrictRequest):
    expected_revision: int = Field(ge=1)
    decision: Literal['adopt', 'reject']
    content: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    expires_at: AwareDatetime | None = None
    note: Annotated[str, Field(min_length=1, max_length=1000)] = '主管核对原文后确认，本人当次意愿优先'


class DuplicateMemoryItem(StrictRequest):
    id: Annotated[str, Field(min_length=1, max_length=100)]
    expected_revision: int = Field(ge=1)


class DuplicateMemoryRequest(StrictRequest):
    keep: DuplicateMemoryItem
    duplicates: list[DuplicateMemoryItem] = Field(min_length=1, max_length=49)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]

    @model_validator(mode='after')
    def unique(self):
        ids = [self.keep.id, *(i.id for i in self.duplicates)]
        if len(set(ids)) != len(ids):
            raise ValueError('Duplicate memory object')
        return self


class AutomationRule(StrictRequest):
    expected_revision: int = Field(ge=0)
    enabled: bool
    permitted_actions: list[Literal['activity_invitation', 'preference_check']] = Field(max_length=2)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class RecordSave(StrictRequest):
    background: bool = False
    text: Annotated[str, Field(min_length=1, max_length=5000)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    happened_at: AwareDatetime | None = None
    scene: MemoryScene | None = None
    attachment_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=10)


class Arrangement(StrictRequest):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    goal: Annotated[str, Field(min_length=1, max_length=1000)]
    starts_on: date
    ends_on: date
    items: list[PlanItem] = Field(min_length=1, max_length=20)
    service_date: date
    shift_id: Annotated[str, Field(min_length=1, max_length=100)]
    assigned_to: Annotated[str, Field(min_length=1, max_length=100)]
    context_token: str | None = None


class PreferenceDecision(StrictRequest):
    suggestion_id: Annotated[str, Field(min_length=1, max_length=100)]
    decision: Literal['adopt', 'reject']
    content: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    expires_at: AwareDatetime | None = None


class AcceptedRecordTask(StrictRequest):
    suggestion_id: Annotated[str, Field(min_length=1, max_length=100)]
    title: Annotated[str, Field(min_length=1, max_length=300)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)]
    assigned_to: Annotated[str, Field(min_length=1, max_length=100)]
    due_at: AwareDatetime
    completion_criteria: Annotated[str, Field(min_length=1, max_length=1000)]
    scheduled_at: AwareDatetime | None = None
    time_change_reason: Annotated[str, Field(min_length=1, max_length=1000)] | None = None


class RecordAnalysisConfirm(StrictRequest):
    expected_revision: int = Field(ge=1)
    preference_decisions: list[PreferenceDecision] = Field(default_factory=list, max_length=10)
    accepted_tasks: list[AcceptedRecordTask] = Field(default_factory=list, max_length=50)

    @model_validator(mode='after')
    def unique_decisions(self):
        for rows in (self.preference_decisions, self.accepted_tasks):
            if len({r.suggestion_id for r in rows}) != len(rows):
                raise ValueError('Duplicate suggestion decision')
        return self


class FollowupResolution(StrictRequest):
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class PlanAutomation(StrictRequest):
    expected_revision: int = Field(ge=0)
    enabled: bool
    plan_id: Annotated[str, Field(min_length=1, max_length=100)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)]
    assigned_to: Annotated[str, Field(min_length=1, max_length=100)]
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class AssessmentSave(AssessmentCreate):
    action: Literal['save', 'submit', 'confirm'] = 'save'
    assessment_id: str | None = None
    expected_revision: int | None = Field(default=None, ge=1)


class TodayCheckRequest(StrictRequest):
    kinds: list[Literal['quality', 'coverage']] = Field(default_factory=lambda: ['quality', 'coverage'], min_length=1, max_length=2)
