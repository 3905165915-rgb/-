"""Explicit human grants and deliberately separate family-facing content."""
from typing import Literal

from pydantic import AwareDatetime, Field

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


class FeedbackCreate(StrictRequest):
    binding_id: ObjectId
    text: Text


class FeedbackResponse(FamilyDecision):
    reply: Text
