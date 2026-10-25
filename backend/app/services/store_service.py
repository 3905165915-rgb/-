from __future__ import annotations

from typing import Any

from app.core.config import settings
from app.models.entities import AIDraft, CareRecord, CareTask, Elder, User
from app.services.ai_service import AIProviderError, MockAIProvider, get_ai_provider
from app.services.passwords import verify_password
from app.storage.json_store import JsonStore


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


def create_draft(store: JsonStore, elder_id: str, shift_id: str | None, text: str, user_id: str | None = None, role: str = 'supervisor') -> AIDraft:
    from app.services.workflow import current_staff, open_shift
    from app.services.facility_service import care_eligible, care_state
    from app.services.workflow import DomainError
    from app.services.workflow import now
    reference_time = now()
    initial = store.read()
    elder_snapshot = care_state(care_eligible(initial, elder_id))
    if user_id:
        current_staff(initial, user_id, role)
        from app.services.care_scope_service import require_elder_access
        require_elder_access(initial, elder_id, user_id, role)
        open_shift(initial, shift_id, user_id, role)
    provider = get_ai_provider()
    try:
        draft = provider.extract(elder_id, shift_id, text)
    except AIProviderError:
        if not settings.ai_fallback_mock or isinstance(provider, MockAIProvider):
            raise
        provider = MockAIProvider()
        draft = provider.extract(elder_id, shift_id, text)
        draft.warnings.insert(0, "真实AI不可用，当前结果来自演示降级，请人工核对")

    draft.created_by = user_id
    draft.created_at = reference_time
    draft.model_status = 'demo' if isinstance(provider, MockAIProvider) else 'available'
    draft.elder_state_snapshot = elder_snapshot
    def mutate(data: dict[str, Any]) -> None:
        from app.services.workflow import open_shift, audit
        if user_id:
            current_staff(data, user_id, role)
            require_elder_access(data, elder_id, user_id, role)
            open_shift(data, shift_id, user_id, role)
        if care_state(care_eligible(data, elder_id)) != elder_snapshot:
            raise DomainError('draft_elder_state_changed')
        from app.services.task_proposals import task_proposals
        draft.task_candidates = task_proposals(
            draft.task_candidates, data, elder_id=elder_id, shift_id=shift_id,
            user_id=user_id, role=role, reference_time=reference_time)
        data["ai_drafts"].append(draft.model_dump())
        audit(data, 'create_ai_draft', draft.id, user_id or 'legacy', elder_id=elder_id, shift_id=shift_id,
              detail='AI生成待人工核对草稿', provider=draft.provider)

    store.mutate(mutate)
    return draft


def confirm_draft(store: JsonStore, draft_id: str, user_id: str, observations: list[str] | None, task_candidates: list[dict] | None) -> tuple[CareRecord, list[CareTask]]:
    from app.services.record_service import confirm
    return confirm(store, draft_id, user_id, observations, task_candidates)


def list_tasks(store: JsonStore, elder_id: str | None = None) -> list[CareTask]:
    from app.services.task_service import list_tasks as listing
    return listing(store, elder_id=elder_id)


def complete_task(store: JsonStore, task_id: str, user_id: str, result_text: str) -> CareTask:
    from app.services.task_service import complete
    return complete(store, task_id, user_id, 'caregiver', result_text)
