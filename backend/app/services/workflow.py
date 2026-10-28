from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4


class DomainError(ValueError):
    def __init__(self, code: str, status_code: int = 409):
        self.code = code
        self.status_code = status_code
        super().__init__(code)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_time(value: str) -> datetime:
    # Python 3.10 does not accept the ISO 8601 UTC suffix emitted by Pydantic.
    return datetime.fromisoformat(value[:-1] + '+00:00' if value.endswith('Z') else value)


def identifier(prefix: str) -> str:
    return f'{prefix}-{uuid4().hex[:12]}'


def find(data: dict, collection: str, object_id: str, code: str) -> dict:
    item = next((item for item in data[collection] if item['id'] == object_id), None)
    if item is None:
        raise DomainError(code, 404)
    return item


def audit(data: dict, action: str, object_id: str, user_id: str, *, queue_record_job: bool = True, **details: Any) -> None:
    actor = next((row for row in data['users'] if row['id'] == user_id), None)
    details.setdefault('actor_role', actor.get('role') if actor else 'system')
    event = {
        'id': identifier('AUDIT'), 'action': action, 'object_id': object_id,
        'user_id': user_id, 'created_at': now(), **details,
    }
    data['audit_logs'].append(event)
    from app.services.notification_service import project
    project(data, event)
    if queue_record_job and action in {'create_manual_record', 'confirm_ai_draft', 'correct_record'}:
        from app.services.elder_workspace_service import enqueue_record
        record_id = details.get('record_id', object_id)
        enqueue_record(data, record_id, user_id)


def active_staff(data: dict, user_id: str | None) -> None:
    if user_id is None:
        return
    user = find(data, 'users', user_id, 'assignee_not_found')
    if not user.get('active', True) or user.get('role') not in {'admin', 'supervisor', 'caregiver', 'nurse'}:
        raise DomainError('assignee_is_not_active_staff', 422)


def current_staff(data: dict, user_id: str, role: str | None = None, management: bool = False) -> dict:
    """Recheck the acting account in the same snapshot/transaction as the operation."""
    user = find(data, 'users', user_id, 'staff_not_found')
    allowed = {'admin', 'supervisor'} if management else {'admin', 'supervisor', 'caregiver', 'nurse'}
    if (not user.get('active', True) or user.get('role') not in allowed or
            (role is not None and user.get('role') != role)):
        raise DomainError('staff_permissions_changed', 403)
    return user


def open_shift(data: dict, shift_id: str | None, user_id: str, role: str) -> None:
    if shift_id is None:
        return
    shift = find(data, 'shifts', shift_id, 'shift_not_found')
    if shift.get('status') == 'closed':
        raise DomainError('shift_closed')
    if role in {'caregiver', 'nurse'} and user_id not in shift['caregiver_ids']:
        raise DomainError('not_a_shift_member', 403)


def editable(data: dict, item: dict, user_id: str, role: str) -> None:
    if role in {'caregiver', 'nurse'} and item.get('elder_id'):
        from app.services.care_scope_service import require_elder_access
        require_elder_access(data, item['elder_id'], user_id, role)
    if role not in {'admin', 'supervisor'} and item.get('created_by') != user_id:
        raise DomainError('only_author_or_management_can_edit', 403)


def replayable(data: dict, user_id: str, action: str, key: str | None, payload: dict, operation: Callable[[], dict]) -> dict:
    """Called inside the store transaction so retries cannot create a second object."""
    if key is None:
        return operation()
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    existing = next((item for item in data['idempotency_keys'] if
                     item['user_id'] == user_id and item['action'] == action and item['key'] == key), None)
    if existing:
        if existing['fingerprint'] != fingerprint:
            raise DomainError('idempotency_key_payload_mismatch')
        return existing['response']
    response = operation()
    data['idempotency_keys'].append({
        'user_id': user_id, 'action': action, 'key': key, 'fingerprint': fingerprint,
        'response': response, 'created_at': now(),
    })
    return response
