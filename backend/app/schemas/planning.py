from datetime import date
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, StrictInt, model_validator

from app.schemas.change_review import StrictRequest, ReviewEvidence, ObjectId, Text
from app.schemas.memory import MemoryScene


class AssessmentCreate(StrictRequest):
    elder_id: ObjectId
    template_id: Literal['barthel_basic_v1'] = 'barthel_basic_v1'
    scores: dict[str, StrictInt]
    assessed_at: AwareDatetime
    review_due_at: AwareDatetime
    note: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=5)
    supersedes_id: ObjectId | None = None


class AssessmentReview(StrictRequest):
    expected_revision: int = Field(ge=1)
    action: Literal['confirm', 'reject', 'retire']
    reason: Text
    care_level_label: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    care_level_basis: Text | None = None

    @model_validator(mode='after')
    def human_grade(self):
        if self.action == 'confirm' and (not self.care_level_label or not self.care_level_basis):
            raise ValueError('Confirmation requires a human care level label and its institutional basis')
        if self.action != 'confirm' and (self.care_level_label is not None or self.care_level_basis is not None):
            raise ValueError('Only confirmation accepts care level fields')
        return self


class PlanItem(StrictRequest):
    key: Annotated[str, Field(min_length=1, max_length=50, pattern=r'^[a-z0-9_-]+$')]
    title: Annotated[str, Field(min_length=1, max_length=300)]
    scene: MemoryScene
    instruction: Annotated[str, Field(min_length=1, max_length=1500)]
    times: list[Annotated[str, Field(pattern=r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')]] = Field(min_length=1, max_length=6)
    weekdays: list[Annotated[int, Field(strict=True, ge=1, le=7)]] = Field(default_factory=lambda: list(range(1, 8)), min_length=1, max_length=7)
    every_n_days: int = Field(default=1, ge=1, le=30)
    window_minutes: int = Field(default=60, ge=1, le=240)
    condition: Annotated[str, Field(min_length=1, max_length=1000)] | None = None

    @model_validator(mode='after')
    def unique_schedule(self):
        if len(set(self.times)) != len(self.times) or len(set(self.weekdays)) != len(self.weekdays):
            raise ValueError('Times and weekdays must be unique')
        self.times.sort()
        self.weekdays.sort()
        return self


class PlanCreate(StrictRequest):
    elder_id: ObjectId
    assessment_id: ObjectId
    expected_assessment_revision: int = Field(ge=1)
    title: Annotated[str, Field(min_length=1, max_length=200)]
    goal: Text
    starts_on: date
    ends_on: date
    items: list[PlanItem] = Field(min_length=1, max_length=20)
    supersedes_id: ObjectId | None = None

    @model_validator(mode='after')
    def valid_scope(self):
        if not 0 <= (self.ends_on - self.starts_on).days <= 365:
            raise ValueError('Plan duration must be 1 to 366 calendar days')
        if len({row.key for row in self.items}) != len(self.items):
            raise ValueError('Item keys must be unique and kept stable across revisions')
        return self


class PlanReview(StrictRequest):
    expected_revision: int = Field(ge=1)
    action: Literal['approve', 'reject', 'retire']
    reason: Text


class PlanGenerate(StrictRequest):
    expected_revision: int = Field(ge=1)
    service_date: date
    shift_id: ObjectId
    assigned_to: ObjectId


class PlanReissue(StrictRequest):
    expected_revision: int = Field(ge=1)
    previous_task_id: ObjectId
    expected_task_revision: int = Field(ge=1)
    shift_id: ObjectId
    assigned_to: ObjectId
    reason: Text
