from __future__ import annotations

from pydantic import BaseModel, Field

from app.models.entities import AIDraft, CareRecord, CareTask, Elder


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    role: str
    display_name: str


class RecordExtractRequest(BaseModel):
    elder_id: str
    shift_id: str | None = None
    text: str = Field(min_length=1, max_length=5000)


class RecordConfirmRequest(BaseModel):
    observations: list[str] | None = None
    task_candidates: list[dict] | None = None


class TaskCompleteRequest(BaseModel):
    result: str = Field(min_length=1, max_length=2000)


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
