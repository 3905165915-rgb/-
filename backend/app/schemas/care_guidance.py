"""Strict, separate contracts for non-task life-care guidance."""
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import AwareDatetime, Field, field_validator

from app.schemas.change_review import StrictRequest

ContentType = Literal['routine_hint', 'one_off_reminder', 'followup_task']
HintScene = Literal['communication', 'before_activity', 'activity', 'dining', 'rest', 'bathing', 'other']
Occasion = Literal['before_activity', 'after_lunch', 'during_meal', 'during_communication', 'other']
Text = Annotated[str, Field(min_length=1, max_length=2000)]
Title = Annotated[str, Field(min_length=1, max_length=300)]


def calendar_day(value):
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if not isinstance(value, str) or len(value) != 10 or date.fromisoformat(value).isoformat() != value:
        raise ValueError('Use a calendar date in YYYY-MM-DD format')
    return value


class HintLine(StrictRequest):
    content_type: Literal['routine_hint'] = 'routine_hint'
    title: Title
    scene: HintScene
    instruction: Text
    condition: Text | None = None


class ReminderLine(StrictRequest):
    content_type: Literal['one_off_reminder'] = 'one_off_reminder'
    title: Title
    occasion: Occasion
    record_what: Text
    condition: Text | None = None


class HintArrangement(StrictRequest):
    content_type: Literal['routine_hint']
    title: Title
    goal: Annotated[str, Field(max_length=1000)] = ''
    items: list[HintLine] = Field(min_length=1, max_length=20)
    context_token: Annotated[str, Field(max_length=100)] | None = None


class ReminderArrangement(StrictRequest):
    content_type: Literal['one_off_reminder']
    title: Title
    goal: Annotated[str, Field(max_length=1000)] = ''
    service_date: date
    items: list[ReminderLine] = Field(min_length=1, max_length=20)
    context_token: Annotated[str, Field(max_length=100)] | None = None

    _day = field_validator('service_date', mode='before')(calendar_day)


class GuidanceStatus(StrictRequest):
    expected_revision: int = Field(ge=1, strict=True)
    status: Literal['pending', 'enabled', 'needs_adjustment', 'disabled', 'cancelled']
    reason: Text


class GuidanceRecord(StrictRequest):
    expected_revision: int = Field(ge=1, strict=True)
    response: Literal['willing', 'alternative', 'rest', 'declined', 'unclear']
    observation: Text
    happened_at: AwareDatetime
