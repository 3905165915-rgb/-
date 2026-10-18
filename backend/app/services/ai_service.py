from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

import httpx

from app.core.config import settings
from app.models.entities import AIDraft


class MockAIProvider:
    """Deterministic provider for demos; it never claims clinical judgment."""

    name = "mock"

    def extract(self, elder_id: str, shift_id: str | None, text: str) -> AIDraft:
        observations = [text.strip()]
        warnings: list[str] = []
        candidates: list[dict] = []
        evidence: list[dict] = [{"text": text.strip(), "type": "raw_observation"}]
        lowered = text.lower()
        if any(word in lowered for word in ("联系家属", "联系女儿", "联系儿子", "反馈")):
            candidates.append({"title": "联系家属反馈", "due_text": "待人工确认"})
            evidence.append({"text": text.strip(), "type": "family_contact_candidate"})
        if any(word in text for word in ("晚上", "晚间", "尽快", "晚点")):
            warnings.append("时间表达需要人工确认")
        warnings.append("当前使用演示AI结果，请人工核对后提交")
        return AIDraft(
            id=f"AI-{uuid4().hex[:12]}",
            elder_id=elder_id,
            shift_id=shift_id,
            raw_text=text,
            observations=observations,
            task_candidates=candidates,
            evidence=evidence,
            warnings=warnings,
            provider=self.name,
            created_at=datetime.now(timezone.utc).isoformat(),
        )


class AIProviderError(RuntimeError):
    pass


class DeepSeekAIProvider:
    name = "deepseek"

    def __init__(self, api_key: str, base_url: str, model: str, timeout_seconds: float):
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.timeout_seconds = timeout_seconds

    def extract(self, elder_id: str, shift_id: str | None, text: str) -> AIDraft:
        if not self.api_key:
            raise AIProviderError("DEEPSEEK_API_KEY is not configured")
        request = {
            "model": self.model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是养老护理记录结构化助手。只能提取原文明确出现的信息，不能诊断、"
                        "确定护理等级、判断责任或补写事实。必须保留否定和条件关系。返回JSON对象，"
                        "字段为 observations(string[]), task_candidates(object[]), evidence(object[]), "
                        "warnings(string[])。每个evidence对象包含text和type。不确定字段留空。"
                    ),
                },
                {"role": "user", "content": text},
            ],
        }
        try:
            response = httpx.post(
                f"{self.base_url}/chat/completions",
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=request,
                timeout=self.timeout_seconds,
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            parsed = _parse_json_content(content)
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
            raise AIProviderError(f"DeepSeek extraction failed: {exc}") from exc

        return AIDraft(
            id=f"AI-{uuid4().hex[:12]}",
            elder_id=elder_id,
            shift_id=shift_id,
            raw_text=text,
            observations=_strings(parsed.get("observations")),
            task_candidates=_objects(parsed.get("task_candidates")),
            evidence=_objects(parsed.get("evidence")),
            warnings=_strings(parsed.get("warnings")),
            provider=f"deepseek:{self.model}",
            created_at=datetime.now(timezone.utc).isoformat(),
        )


def _parse_json_content(content: str) -> dict:
    cleaned = content.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise ValueError("AI response is not a JSON object")
    return parsed


def _strings(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _objects(value: object) -> list[dict]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict)]


def get_ai_provider() -> MockAIProvider | DeepSeekAIProvider:
    if settings.ai_provider.lower() == "deepseek":
        return DeepSeekAIProvider(
            api_key=settings.deepseek_api_key,
            base_url=settings.deepseek_base_url,
            model=settings.deepseek_model,
            timeout_seconds=settings.deepseek_timeout_seconds,
        )
    return MockAIProvider()
