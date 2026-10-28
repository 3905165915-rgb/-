from typing import Literal

from pydantic import Field, model_validator

from app.schemas.change_review import StrictRequest, ObjectId, Text


class PhotoReview(StrictRequest):
    expected_revision: int = Field(ge=1)
    decision: Literal['approve', 'reject']
    note: Text
    share_with_family: bool = Field(default=False, strict=True)

    @model_validator(mode='after')
    def only_approved_photos_can_be_shared(self):
        if self.share_with_family and self.decision != 'approve':
            raise ValueError('只有核准的照片可以向家属展示')
        return self


class PhotoFamilyShare(StrictRequest):
    expected_revision: int = Field(ge=1)
    share_with_family: bool = Field(strict=True)
    note: Text


class PhotoLink(StrictRequest):
    target_type: Literal['record', 'incident']
    target_id: ObjectId


class ImageReview(StrictRequest):
    expected_revision: int = Field(ge=1)
    decision: Literal['confirm', 'reject', 'request_management']
    observations: list[Text] = Field(default_factory=list, max_length=20)
    note: Text

    @model_validator(mode='after')
    def require_observation(self):
        if self.decision in {'confirm', 'request_management'} and not self.observations:
            raise ValueError('请填写经人工核对的可见观察')
        return self
