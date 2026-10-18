from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from app.core.config import settings
from app.models.entities import AIDraft, CareRecord, CareTask, Elder, User
from app.services.ai_service import AIProviderError, MockAIProvider, get_ai_provider
from app.services.passwords import verify_password
from app.storage.json_store import JsonStore


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def find_user(store: JsonStore, username: str) -> User | None:
    for item in store.read()["users"]:
        user = User.model_validate(item)
        if user.username == username and user.active:
            return user
    return None


def authenticate(store: JsonStore, username: str, password: str) -> User | None:
    user = find_user(store, username)
    return user if user and verify_password(password, user.password_hash) else None


def list_elders(store: JsonStore) -> list[Elder]:
    return [Elder.model_validate(item) for item in store.read()["elders"]]


def get_elder(store: JsonStore, elder_id: str) -> Elder | None:
    return next((item for item in list_elders(store) if item.id == elder_id), None)


def create_draft(store: JsonStore, elder_id: str, shift_id: str | None, text: str) -> AIDraft:
    provider = get_ai_provider()
    try:
        draft = provider.extract(elder_id, shift_id, text)
    except AIProviderError:
        if not settings.ai_fallback_mock or isinstance(provider, MockAIProvider):
            raise
        draft = MockAIProvider().extract(elder_id, shift_id, text)
        draft.warnings.insert(0, "真实AI不可用，当前结果来自演示降级，请人工核对")

    def mutate(data: dict[str, Any]) -> None:
        data["ai_drafts"].append(draft.model_dump())

    store.mutate(mutate)
    return draft


def confirm_draft(store: JsonStore, draft_id: str, user_id: str, observations: list[str] | None, task_candidates: list[dict] | None) -> tuple[CareRecord, list[CareTask]]:
    result: dict[str, Any] = {}

    def mutate(data: dict[str, Any]) -> None:
        draft_data = next((item for item in data["ai_drafts"] if item["id"] == draft_id), None)
        if not draft_data:
            raise KeyError("draft_not_found")
        if draft_data["status"] == "confirmed":
            existing = next((item for item in data["care_records"] if item.get("source_draft_id") == draft_id), None)
            if existing:
                result["record"] = CareRecord.model_validate(existing)
                result["tasks"] = [CareTask.model_validate(item) for item in data["care_tasks"] if item.get("source_record_id") == existing["id"]]
                return
        final_observations = observations if observations is not None else draft_data.get("observations", [])
        final_candidates = task_candidates if task_candidates is not None else draft_data.get("task_candidates", [])
        record = CareRecord(
            id=f"REC-{uuid4().hex[:12]}", elder_id=draft_data["elder_id"], shift_id=draft_data.get("shift_id"), raw_text=draft_data["raw_text"], observations=final_observations, created_by=user_id, source_draft_id=draft_id, created_at=now()
        )
        tasks: list[CareTask] = []
        for candidate in final_candidates:
            task = CareTask(id=f"TASK-{uuid4().hex[:12]}", elder_id=record.elder_id, title=str(candidate.get("title", "待处理事项")), source_record_id=record.id, continuity_key=None, updated_at=now())
            tasks.append(task)
        data["care_records"].append(record.model_dump())
        data["care_tasks"].extend(item.model_dump() for item in tasks)
        draft_data["status"] = "confirmed"
        data["audit_logs"].append({"id": f"AUDIT-{uuid4().hex[:12]}", "action": "confirm_ai_draft", "object_id": draft_id, "user_id": user_id, "created_at": now()})
        result["record"] = record
        result["tasks"] = tasks

    try:
        store.mutate(mutate)
    except KeyError as exc:
        if str(exc) == "'draft_not_found'":
            raise ValueError("draft_not_found") from exc
        raise
    return result["record"], result["tasks"]


def list_tasks(store: JsonStore, elder_id: str | None = None) -> list[CareTask]:
    items = [CareTask.model_validate(item) for item in store.read()["care_tasks"]]
    return [item for item in items if elder_id is None or item.elder_id == elder_id]


def complete_task(store: JsonStore, task_id: str, user_id: str, result_text: str) -> CareTask:
    result: dict[str, CareTask] = {}

    def mutate(data: dict[str, Any]) -> None:
        item = next((item for item in data["care_tasks"] if item["id"] == task_id), None)
        if not item:
            raise ValueError("task_not_found")
        item.update({"status": "completed", "result": result_text, "updated_at": now()})
        data["audit_logs"].append({"id": f"AUDIT-{uuid4().hex[:12]}", "action": "complete_task", "object_id": task_id, "user_id": user_id, "created_at": now()})
        result["task"] = CareTask.model_validate(item)

    store.mutate(mutate)
    return result["task"]
