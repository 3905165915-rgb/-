from __future__ import annotations

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.schemas.change_review import ReviewEvidence


Text = Annotated[str, Field(min_length=1, max_length=2000)]


class ConditionVersionRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    expected_task_revision: int = Field(ge=1)


class ConditionConfigureRequest(ConditionVersionRequest):
    criterion: Text
    checker_id: Annotated[str, Field(min_length=1, max_length=100)]
    check_due_at: AwareDatetime | None = None
    reason: Text


class ConditionClaimRequest(ConditionVersionRequest):
    reason: Text


class ConditionCheckRequest(ConditionVersionRequest):
    outcome: Literal['met', 'not_met']
    note: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=5)
    valid_until: AwareDatetime | None = None

    @model_validator(mode='after')
    def met_requires_expiry(self):
        if self.outcome == 'met' and self.valid_until is None:
            raise ValueError('A met condition requires an explicit validity deadline')
        return self


class TaskConditionResponse(BaseModel):
    task_id: str
    task_revision: int
    task_status: str
    condition: str | None
    verification: dict | None
    current: dict
    historical_only: bool
    as_of: str
