"""Contracts for the elder-centred workflow. Permissions are server controlled."""
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field
from app.schemas.change_review import StrictRequest
from app.schemas.planning import AssessmentCreate
from app.schemas.memory import MemoryScene


class UnderstandingDecision(StrictRequest):
    expected_revision: int = Field(ge=1)
    decision: Literal['adopt', 'reject']
    content: Annotated[str, Field(min_length=1, max_length=1000)] | None = None
    note: Annotated[str, Field(min_length=1, max_length=1000)] = '主管核对原文后确认，本人当次意愿优先'


class AutomationRule(StrictRequest):
    expected_revision: int = Field(ge=0)
    enabled: bool
    permitted_actions: list[Literal['activity_invitation', 'preference_check']] = Field(max_length=2)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class RecordSave(StrictRequest):
    text: Annotated[str, Field(min_length=1, max_length=5000)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    happened_at: AwareDatetime | None = None
    scene: MemoryScene | None = None
    attachment_ids: list[Annotated[str, Field(min_length=1, max_length=100)]] = Field(default_factory=list, max_length=10)


class PreferenceDecision(StrictRequest):
    suggestion_id: Annotated[str, Field(min_length=1, max_length=100)]
    decision: Literal['adopt', 'reject']
    content: Annotated[str, Field(min_length=1, max_length=1000)] | None = None


class AcceptedRecordTask(StrictRequest):
    suggestion_id: Annotated[str, Field(min_length=1, max_length=100)]
    title: Annotated[str, Field(min_length=1, max_length=300)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)]
    assigned_to: Annotated[str, Field(min_length=1, max_length=100)]
    due_at: AwareDatetime
    completion_criteria: Annotated[str, Field(min_length=1, max_length=1000)]


class RecordAnalysisConfirm(StrictRequest):
    expected_revision: int = Field(ge=1)
    preference_decisions: list[PreferenceDecision] = Field(default_factory=list, max_length=10)
    accepted_tasks: list[AcceptedRecordTask] = Field(default_factory=list, max_length=50)


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
