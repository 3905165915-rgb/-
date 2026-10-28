"""Additive contract for grounded life-care suggestions and human decisions."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator, field_validator
from datetime import date
from app.schemas.care_guidance import ContentType, HintLine, ReminderLine, HintScene, Occasion, calendar_day

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
    content_type: ContentType = 'followup_task'
    task: TaskCreateRequest | None = None
    reason: Text
    title: Annotated[str, Field(min_length=1, max_length=300)] | None = None
    scene: HintScene | None = None
    instruction: Text | None = None
    occasion: Occasion | None = None
    record_what: Text | None = None
    service_date: date | None = None
    condition: Text | None = None

    @field_validator('service_date', mode='before')
    @classmethod
    def day(cls, value):
        return calendar_day(value) if value is not None else value

    @model_validator(mode='after')
    def separate_types(self):
        common = {'expected_revision', 'content_type', 'reason'}
        if self.content_type == 'followup_task':
            allowed = common | {'task'}
            if self.task is None:
                raise ValueError('A follow-up task requires confirmed task fields')
        else:
            allowed = common | {'title', 'condition'}
            line = {'title': self.title, 'condition': self.condition}
            if self.content_type == 'routine_hint':
                allowed |= {'scene', 'instruction'}
                HintLine(**line, scene=self.scene, instruction=self.instruction)
            else:
                allowed |= {'occasion', 'record_what', 'service_date'}
                ReminderLine(**line, occasion=self.occasion, record_what=self.record_what)
                if self.service_date is None:
                    raise ValueError('A one-off reminder requires its service date')
        if self.model_fields_set - allowed:
            raise ValueError('Fields belonging to another content type are not allowed')
        return self


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
