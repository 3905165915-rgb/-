"""Explicit human grants and deliberately separate family-facing content."""
from typing import Literal

from pydantic import AwareDatetime, Field, model_validator

from app.schemas.change_review import StrictRequest, ObjectId, Text, ReviewEvidence
from app.schemas.facility import StaffCreate, StaffPasswordReset


class FamilyAccountCreate(StaffCreate):
    role: Literal['family'] = 'family'


class FamilyAccountUpdate(StrictRequest):
    expected_revision: int = Field(ge=1)
    active: bool
    reason: Text


class BindingCreate(StrictRequest):
    elder_id: ObjectId
    admission_id: ObjectId
    family_id: ObjectId
    relationship: Text
    consent_reference: Text
    scopes: list[Literal['summary', 'feedback']] = Field(min_length=1, max_length=2)
    expires_at: AwareDatetime


class FamilyDecision(StrictRequest):
    expected_revision: int = Field(ge=1)
    reason: Text


class SummaryCreate(StrictRequest):
    elder_id: ObjectId
    admission_id: ObjectId
    period_start: AwareDatetime
    period_end: AwareDatetime
    text: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=10)


class SummaryReview(FamilyDecision):
    action: Literal['publish', 'reject', 'withdraw']


class SummarySuggest(StrictRequest):
    elder_id: ObjectId
    admission_id: ObjectId
    period_start: AwareDatetime
    period_end: AwareDatetime
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=10)
    public_quotes_confirmed: bool = Field(strict=True)


class SummaryEdit(FamilyDecision):
    text: Text


class FeedbackCreate(StrictRequest):
    binding_id: ObjectId
    text: Text


class FeedbackResponse(FamilyDecision):
    reply: Text


class PublicRecordSelection(StrictRequest):
    record_id: ObjectId
    public_quote: str | None = Field(None, min_length=1, max_length=1000)


class SummarySelection(StrictRequest):
    elder_id: ObjectId
    period_start: AwareDatetime
    period_end: AwareDatetime
    selections: list[PublicRecordSelection] = Field(min_length=1, max_length=10)
    text: str = Field('', max_length=2000)
    public_quotes_confirmed: bool = Field(strict=True)

    @model_validator(mode='after')
    def unique_records(self):
        if len({s.record_id for s in self.selections}) != len(self.selections):
            raise ValueError('Select each record once')
        return self


class SummarySelectionCreate(SummarySelection):
    text: Text
    expected_context_token: str = Field(pattern=r'^[0-9a-f]{64}$')
