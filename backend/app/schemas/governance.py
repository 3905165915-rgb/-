from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.schemas.change_review import StrictRequest, ObjectId, Text

Label = Annotated[str, Field(min_length=1, max_length=200)]


class EvaluationSubmit(StrictRequest):
    dataset_version: ObjectId
    case_id: ObjectId
    sample_sha256: Annotated[str, Field(pattern='^[0-9a-f]{64}$')]
    sample_kind: Literal['synthetic', 'redacted']
    split: Literal['development', 'holdout']
    feature: Literal['extraction', 'context', 'impression', 'summary', 'quality', 'vision', 'care_advice']
    model: ObjectId
    prompt_version: ObjectId
    expected_labels: list[Label] = Field(max_length=100)
    predicted_labels: list[Label] = Field(max_length=100)
    checked_citations: int = Field(ge=0, le=1000)
    incorrect_citations: int = Field(ge=0, le=1000)
    output_valid: bool = Field(strict=True)
    elapsed_ms: int = Field(ge=0, le=600000)
    privacy_confirmed: bool = Field(strict=True)
    note: Text

    @model_validator(mode='after')
    def check_labels(self):
        if not self.privacy_confirmed:
            raise ValueError('必须确认仅使用合成或已脱敏样本')
        if len(set(self.expected_labels)) != len(self.expected_labels) or len(set(self.predicted_labels)) != len(self.predicted_labels):
            raise ValueError('标注项不能重复')
        if self.incorrect_citations > self.checked_citations:
            raise ValueError('错误引用数不能超过核查总数')
        if not self.output_valid and self.predicted_labels:
            raise ValueError('无效输出不能计为有效预测；预期项仍进入漏提分母')
        return self
