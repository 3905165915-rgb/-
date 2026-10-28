"""Compatible list envelopes. Count and page always use the same filtered snapshot."""
from typing import Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar('T')


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
    filters: dict = Field(default_factory=dict)
    timezone: str = 'Asia/Shanghai'


def page(rows, limit=100, offset=0, filters=None, envelope=True):
    items = rows[offset:offset + limit]
    return {'items': items, 'total': len(rows), 'limit': limit, 'offset': offset,
            'filters': filters or {}, 'timezone': 'Asia/Shanghai'} if envelope else items
