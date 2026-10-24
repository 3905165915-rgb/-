"""Validate AI structures and verbatim citations; semantic correctness still needs a human."""
from typing import Annotated
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

from app.schemas.memory import MemoryCategory, MemoryScene

ShortText = Annotated[str, Field(min_length=1, max_length=5000)]


class StrictOutput(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True, str_strip_whitespace=True)


class Evidence(StrictOutput):
    text: ShortText
    type: ShortText


class ExtractedTask(StrictOutput):
    title: Annotated[str, Field(min_length=1, max_length=300)]
    evidence_text: ShortText
    condition: ShortText | None = None
    due_text: ShortText | None = None


class Extraction(StrictOutput):
    observations: list[ShortText] = Field(min_length=1, max_length=50)
    task_candidates: list[ExtractedTask] = Field(max_length=50)
    evidence: list[Evidence] = Field(min_length=1, max_length=100)
    warnings: list[ShortText] = Field(max_length=50)
    missing: list[ShortText] = Field(default_factory=list, max_length=50)
    ambiguity: list[ShortText] = Field(default_factory=list, max_length=50)
    suggestion: list[ShortText] = Field(default_factory=list, max_length=50)
    model_status: Literal['available', 'demo'] = 'available'


class Citation(StrictOutput):
    source_id: ShortText
    quote: ShortText


class SummaryPoint(StrictOutput):
    text: ShortText
    citations: list[Citation] = Field(min_length=1, max_length=10)


class SummaryOutput(StrictOutput):
    points: list[SummaryPoint] = Field(max_length=30)


class QualityFinding(StrictOutput):
    title: Annotated[str, Field(min_length=1, max_length=300)]
    explanation: ShortText
    citations: list[Citation] = Field(min_length=1, max_length=10)


class QualityOutput(StrictOutput):
    findings: list[QualityFinding] = Field(max_length=30)


class ExtractedMemory(StrictOutput):
    content: Annotated[str, Field(min_length=1, max_length=1000)]
    category: MemoryCategory
    scenes: list[MemoryScene] = Field(min_length=1, max_length=6)
    attributed_to: Literal['elder', 'family', 'staff', 'unknown']
    evidence_text: ShortText
    validity_text: ShortText | None = None


class ContextNote(StrictOutput):
    kind: Literal['reminder', 'check_needed']
    text: Annotated[str, Field(min_length=1, max_length=1000)]
    citations: list[Citation] = Field(min_length=1, max_length=10)


class ContextExtraction(Extraction):
    memory_candidates: list[ExtractedMemory] = Field(max_length=10)
    context_notes: list[ContextNote] = Field(max_length=10)


def validate_context_extraction(parsed: dict, text: str, sources: list[dict], scene: str) -> dict:
    output = ContextExtraction.model_validate(parsed)
    # Current facts/tasks may only come from the new input, never historical context.
    validate_extraction({key: value for key, value in output.model_dump().items()
                         if key not in {'memory_candidates', 'context_notes'}}, text)
    for item in output.memory_candidates:
        if item.evidence_text not in text or not any(item.evidence_text in row for row in output.observations):
            raise ValueError('Memory evidence must be present in current input and observations')
        if item.validity_text and item.validity_text not in text:
            raise ValueError('Validity text must be quoted from current input')
        if len(set(item.scenes)) != len(item.scenes) or item.scenes != [scene]:
            raise ValueError('A candidate must stay within the requested service scene')
    lookup = {row['source_id']: row['text'] for row in sources}
    for note in output.context_notes:
        for citation in note.citations:
            if citation.source_id not in lookup or citation.quote not in lookup[citation.source_id]:
                raise ValueError('Unknown context source or fabricated quote')
    return output.model_dump()


def validate_extraction(parsed: dict, text: str) -> dict:
    output = Extraction.model_validate(parsed)
    quotes = [item.text for item in output.evidence] + output.observations
    for task in output.task_candidates:
        quotes.append(task.evidence_text)
        quotes.extend(value for value in (task.condition, task.due_text) if value)
    if any(quote not in text for quote in quotes):
        raise ValueError('Evidence must be a verbatim substring of input')
    return output.model_dump()


def validate_citations(parsed: dict, sources: list[dict], kind: str) -> dict:
    output = (SummaryOutput if kind == 'summary' else QualityOutput).model_validate(parsed)
    lookup = {item['source_id']: item['text'] for item in sources}
    rows = output.points if kind == 'summary' else output.findings
    if kind == 'summary' and sources and not rows:
        raise ValueError('Nonempty sources require a summary')
    for row in rows:
        for citation in row.citations:
            if citation.source_id not in lookup or citation.quote not in lookup[citation.source_id]:
                raise ValueError('Unknown source or fabricated quote')
    return output.model_dump()
