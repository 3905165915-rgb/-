"""Bounded, versioned low-risk batch requests."""
from typing import Literal
from pydantic import Field, model_validator
from app.schemas.change_review import StrictRequest


class BatchItem(StrictRequest):
    id: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=1)
    assigned_to: str | None = Field(default=None, min_length=1, max_length=100)


class BatchRequest(StrictRequest):
    action: Literal['read', 'transfer']
    items: list[BatchItem] = Field(min_length=1, max_length=50)
    note: str = Field(default='', max_length=1000)

    @model_validator(mode='after')
    def unique(self):
        if len({i.id for i in self.items}) != len(self.items):
            raise ValueError('Duplicate batch object')
        return self


class NotificationRead(StrictRequest):
    expected_revision: int = Field(ge=1)
    action: Literal['read'] = 'read'
