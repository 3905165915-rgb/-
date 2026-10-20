from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.api import AwareTime, Text


MemoryCategory = Literal['stable_preference', 'temporary_wish', 'communication', 'observation']
MemoryScene = Literal['bathing', 'dining', 'activity', 'communication', 'rest', 'other']
MemoryStatus = Literal['candidate', 'confirmed', 'review_required', 'rejected', 'retired']


class MemoryContent(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

    content: Annotated[str, Field(min_length=1, max_length=1000)]
    category: MemoryCategory
    scenes: list[MemoryScene] = Field(min_length=1, max_length=6)
    attributed_to: Literal['elder', 'family', 'staff', 'unknown'] = 'unknown'
    source_record_id: Annotated[str, Field(min_length=1, max_length=100)]
    source_revision: int = Field(ge=1)
    source_field: Literal['raw_text', 'observations'] = 'observations'
    source_quote: Text
    valid_from: AwareTime | None = None
    expires_at: AwareTime | None = None
    review_due_at: AwareTime | None = None

    @model_validator(mode='after')
    def valid_scope(self):
        if len(self.scenes) != len(set(self.scenes)):
            raise ValueError('Scenes must be unique')
        if self.category == 'temporary_wish' and self.expires_at is None:
            raise ValueError('A temporary wish requires expires_at')
        if self.valid_from:
            for value in (self.expires_at, self.review_due_at):
                if value is not None and value <= self.valid_from:
                    raise ValueError('End/review time must be after valid_from')
        return self


class MemoryCreateRequest(MemoryContent):
    elder_id: Annotated[str, Field(min_length=1, max_length=100)]


class MemoryRevisionRequest(MemoryContent):
    expected_revision: int = Field(ge=1)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class MemoryReviewRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    action: Literal['confirm', 'request_review', 'reject', 'retire']
    expected_revision: int = Field(ge=1)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class MemoryFromDraftRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

    draft_id: Annotated[str, Field(min_length=1, max_length=100)]
    candidate_index: int = Field(ge=0, le=9)
    expected_record_revision: int = Field(ge=1)
    valid_from: AwareTime | None = None
    expires_at: AwareTime | None = None
    review_due_at: AwareTime | None = None


class MemorySource(BaseModel):
    record_id: str
    revision: int
    field: Literal['raw_text', 'observations']
    quote: str
    snapshot_text: str
    record_status: str
    captured_at: str


class MemoryResponse(BaseModel):
    id: str
    elder_id: str
    content: str
    category: MemoryCategory
    scenes: list[MemoryScene]
    attributed_to: Literal['elder', 'family', 'staff', 'unknown']
    source: MemorySource
    status: MemoryStatus
    revision: int
    valid_from: str
    expires_at: str | None
    review_due_at: str | None
    confirmed_by: str | None
    confirmed_at: str | None
    created_by: str
    created_at: str
    updated_at: str
    effective: bool
    source_current: bool
    review_due: bool
    blocked_reasons: list[str]
    candidate_source: dict | None = None


class MemoryContextResponse(BaseModel):
    elder_id: str
    scene: MemoryScene
    as_of: str
    memories: list[MemoryResponse]
