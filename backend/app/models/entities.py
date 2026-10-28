from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


Role = Literal["admin", "supervisor", "caregiver", "family"]
RecordStatus = Literal["draft", "confirmed", "corrected"]
TaskStatus = Literal["pending", "in_progress", "completed", "not_done", "transferred", "cancelled", "overdue"]


class User(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    username: str
    display_name: str
    role: Role
    password_hash: str
    active: bool = True
    token_version: int = 0
    demo_login_enabled: bool = False


class Elder(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    bed_id: str | None = None
    bed_label: str = ''
    status: Literal["pending", "active", "out", "discharged"] = "active"
    contact_name: str | None = None
    contact_phone: str | None = None
    notes: str | None = None
    revision: int = 1
    current_admission_id: str | None = None
    care_state_version: int = 0
    created_at: str | None = None
    updated_at: str | None = None


class AIDraft(BaseModel):
    id: str
    revision: int = 1
    elder_id: str
    shift_id: str | None = None
    raw_text: str
    status: Literal["pending_review", "confirmed", "rejected", "failed"] = "pending_review"
    observations: list[str] = Field(default_factory=list)
    task_candidates: list[dict] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    ambiguity: list[str] = Field(default_factory=list)
    suggestion: list[str] = Field(default_factory=list)
    model_status: Literal['available', 'demo', 'failed'] = 'available'
    provider: str = "mock"
    created_at: str
    created_by: str | None = None
    rejected_at: str | None = None
    rejected_by: str | None = None
    rejection_reason: str | None = None
    confirmed_at: str | None = None
    confirmed_by: str | None = None
    generation_kind: Literal['record', 'context_record'] = 'record'
    memory_candidates: list[dict] = Field(default_factory=list)
    preference_candidates: list[dict] = Field(default_factory=list)
    context_notes: list[dict] = Field(default_factory=list)
    context_snapshot: dict | None = None
    elder_state_snapshot: dict | None = None


class CareRecord(BaseModel):
    id: str
    elder_id: str
    admission_id: str | None = None
    shift_id: str | None = None
    raw_text: str
    observations: list[str] = Field(default_factory=list)
    created_by: str
    status: RecordStatus = "confirmed"
    source_draft_id: str | None = None
    source_attachment_ids: list[str] = Field(default_factory=list)
    source_image_analysis_id: str | None = None
    source_guidance_id: str | None = None
    source_guidance_revision: int | None = None
    care_response: Literal['willing', 'alternative', 'rest', 'declined', 'unclear'] | None = None
    created_at: str
    recorded_at: str | None = None
    happened_at: str | None = None
    updated_at: str | None = None
    revision: int = 1
    corrections: list[dict] = Field(default_factory=list)

    @field_validator('corrections', mode='before')
    @classmethod
    def hide_management_impact_checklist(cls, value):
        # Full cross-module references are available only through management endpoints.
        return [{key: item for key, item in row.items() if key != 'impact_review'} for row in value]


class CareTask(BaseModel):
    elder_name: str = ''
    bed_label: str = ''
    assignee_name: str = ''
    shift_name: str = ''
    allowed_actions: list[str] = Field(default_factory=list)
    display_snapshot: dict | None = None
    id: str
    elder_id: str
    title: str
    completion_criteria: str | None = None
    due_at: str | None = None
    assigned_to: str | None = None
    status: TaskStatus = "pending"
    source_record_id: str | None = None
    source_advice_id: str | None = None
    source_type: Literal['manual', 'record', 'care_plan', 'handover'] = 'manual'
    source_id: str | None = None
    source_revision: int | None = None
    source_handover_item_id: str | None = None
    continuity_key: str | None = None
    result: str | None = None
    updated_at: str
    shift_id: str | None = None
    condition: str | None = None
    due_text: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    completed_at: str | None = None
    completed_by: str | None = None
    reason_code: str | None = None
    revision: int = 1
    memory_references: list[dict] = Field(default_factory=list)
    condition_verification: dict | None = None
    source_plan_id: str | None = None
    source_plan_revision: int | None = None
    plan_item_key: str | None = None
    service_date: str | None = None
    scheduled_at: str | None = None
    occurrence_key: str | None = None
    source_plan_snapshot: dict | None = None
    time_confirmation: dict | None = None
    replaces_task_id: str | None = None
