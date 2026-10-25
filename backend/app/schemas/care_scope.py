from typing import Literal

from pydantic import AwareDatetime, Field

from app.schemas.change_review import StrictRequest, ObjectId, Text


class CareAssignment(StrictRequest):
    elder_id: ObjectId
    caregiver_id: ObjectId
    kind: Literal['explicit_assignment', 'temporary_support']
    start_at: AwareDatetime
    end_at: AwareDatetime
    reason: Text


class RevokeAssignment(StrictRequest):
    expected_revision: int = Field(ge=1)
    reason: Text
