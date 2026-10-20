from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.memory import MemoryScene


class ContextExtractRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')

    elder_id: Annotated[str, Field(min_length=1, max_length=100)]
    shift_id: Annotated[str, Field(min_length=1, max_length=100)] | None = None
    scene: MemoryScene
    text: Annotated[str, Field(min_length=1, max_length=5000)]
