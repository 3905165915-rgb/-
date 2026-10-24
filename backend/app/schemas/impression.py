from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from app.schemas.memory import MemoryContent


class ImpressionReview(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    expected_revision: int = Field(ge=1)
    decision: Literal['confirmed', 'rejected']
    note: Annotated[str, Field(min_length=1, max_length=1000)]


class ImpressionMemoryRequest(MemoryContent):
    """An explicit supervisor decision, separate from reading/reviewing a summary."""
    expected_revision: int = Field(ge=1)
    reason: Annotated[str, Field(min_length=1, max_length=1000)]


class ImpressionEvidence(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    source_id: str = Field(min_length=1, max_length=100)
    quote: str = Field(min_length=4, max_length=1000)


class ImpressionPoint(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    category: Literal['preference', 'habit', 'routine', 'communication', 'attention']
    kind: Literal['trend', 'temporary', 'conflict', 'observation']
    expressor: Literal['elder', 'family', 'staff', 'varied', 'unclear']
    text: str = Field(min_length=1, max_length=600)
    citations: list[ImpressionEvidence] = Field(min_length=1, max_length=12)


class ImpressionOutput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    points: list[ImpressionPoint] = Field(max_length=20)
