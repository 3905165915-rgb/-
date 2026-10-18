from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


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


class Elder(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    name: str
    bed_id: str | None = None
    status: Literal["active", "out", "discharged"] = "active"
    contact_name: str | None = None
    contact_phone: str | None = None
    notes: str | None = None


class AIDraft(BaseModel):
    id: str
    elder_id: str
    shift_id: str | None = None
    raw_text: str
    status: Literal["pending_review", "confirmed", "rejected", "failed"] = "pending_review"
    observations: list[str] = Field(default_factory=list)
    task_candidates: list[dict] = Field(default_factory=list)
    evidence: list[dict] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    provider: str = "mock"
    created_at: str


class CareRecord(BaseModel):
    id: str
    elder_id: str
    shift_id: str | None = None
    raw_text: str
    observations: list[str] = Field(default_factory=list)
    created_by: str
    status: RecordStatus = "confirmed"
    source_draft_id: str | None = None
    created_at: str


class CareTask(BaseModel):
    id: str
    elder_id: str
    title: str
    due_at: str | None = None
    assigned_to: str | None = None
    status: TaskStatus = "pending"
    source_record_id: str | None = None
    continuity_key: str | None = None
    result: str | None = None
    updated_at: str
