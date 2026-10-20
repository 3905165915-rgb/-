from typing import Literal

from pydantic import AwareDatetime, Field

from app.schemas.change_review import StrictRequest, Text, ObjectId, ReviewEvidence

Category = Literal['fall', 'choking', 'pressure_injury', 'wandering', 'medication', 'burn',
                   'conflict', 'infection_concern', 'service_omission', 'other']


class IncidentCreate(StrictRequest):
    elder_id: ObjectId
    admission_id: ObjectId
    occurred_at: AwareDatetime
    description: Text
    immediate_action: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=10)


class IncidentTriage(StrictRequest):
    expected_revision: int = Field(ge=1)
    category: Category
    severity: Literal['low', 'medium', 'high']
    classification_basis: Text
    assigned_to: ObjectId
    due_at: AwareDatetime
    corrective_plan: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=10)
    reason: Text


class RectificationAssign(StrictRequest):
    expected_revision: int = Field(ge=1)
    assigned_to: ObjectId
    due_at: AwareDatetime
    reason: Text


class RectificationSubmit(StrictRequest):
    expected_revision: int = Field(ge=1)
    expected_incident_revision: int = Field(ge=1)
    result: Text
    evidence: list[ReviewEvidence] = Field(min_length=1, max_length=10)


class RectificationReview(StrictRequest):
    expected_revision: int = Field(ge=1)
    expected_incident_revision: int = Field(ge=1)
    decision: Literal['accept', 'return']
    note: Text


class IncidentReopen(StrictRequest):
    expected_revision: int = Field(ge=1)
    expected_rectification_revision: int = Field(ge=1)
    assigned_to: ObjectId
    due_at: AwareDatetime
    reason: Text
