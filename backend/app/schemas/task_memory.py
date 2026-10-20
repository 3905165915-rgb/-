from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.memory import MemoryScene


class TaskMemoryAdoptRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    expected_task_revision: int = Field(ge=1)
    memory_id: Annotated[str, Field(min_length=1, max_length=100)]
    expected_memory_revision: int = Field(ge=1)
    scene: MemoryScene
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class TaskMemoryWithdrawRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)

    expected_task_revision: int = Field(ge=1)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class ReferenceCurrentState(BaseModel):
    memory_revision: int | None
    memory_status: str | None
    effective: bool
    source_current: bool
    review_due: bool
    outdated: bool
    reasons: list[str]


class TaskMemoryReference(BaseModel):
    id: str
    memory_id: str
    memory_revision: int
    scene: MemoryScene
    snapshot: dict
    status: Literal['active', 'withdrawn']
    adopted_by: str
    adopted_at: str
    reason: str
    withdrawn_by: str | None = None
    withdrawn_at: str | None = None
    withdrawal_reason: str | None = None
    current: ReferenceCurrentState
    needs_review: bool


class TaskMemoryResponse(BaseModel):
    task_id: str
    task_revision: int
    task_status: str
    historical_only: bool
    as_of: str
    needs_review: bool
    references: list[TaskMemoryReference]
