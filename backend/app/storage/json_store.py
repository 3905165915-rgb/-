from __future__ import annotations

import copy
import json
import os
import tempfile
import shutil
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from filelock import FileLock


T = TypeVar("T")
CURRENT_SCHEMA_VERSION = 4


EMPTY_STORE: dict[str, Any] = {
    "schema_version": CURRENT_SCHEMA_VERSION,
    "updated_at": None,
    "users": [],
    "elders": [],
    "beds": [],
    "admissions": [],
    "assessments": [],
    "care_plans": [],
    "care_tasks": [],
    "care_records": [],
    "ai_drafts": [],
    "shifts": [],
    "handovers": [],
    "handover_items": [],
    "family_cases": [],
    "incidents": [],
    "rectifications": [],
    "audit_logs": [],
    "idempotency_keys": [],
    "quality_checks": [],
    "care_memories": [],
    "change_reviews": [],
}


class JsonStore:
    """A small, single-process-friendly JSON repository.

    Every mutation is protected by a file lock and committed through an atomic
    replace. It is intentionally for the demo/single-server deployment, not a
    substitute for a transactional database in production.
    """

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.path = data_dir / "store.json"
        self.lock = FileLock(str(data_dir / "store.lock"), timeout=10)

    def ensure(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            if not self.path.exists():
                self._atomic_write(copy.deepcopy(EMPTY_STORE))

    def backup(self) -> Path:
        self.ensure()
        with self.lock:
            return self._backup_locked()

    def restore(self, source: Path) -> Path:
        """Offline restore: keep current credentials, invalidate sessions and old grants."""
        with source.open(encoding='utf-8') as stream:
            restored = json.load(stream)
        self._validate(restored)
        self.ensure()
        with self.lock:
            with self.path.open(encoding='utf-8') as stream:
                current = json.load(stream)
            self._validate(current)
            restored['users'] = copy.deepcopy(current['users'])
            # Restoring an old business snapshot must not resurrect revoked family
            # grants or replay stale cached responses. Require fresh authorization.
            for user in restored['users']:
                user['token_version'] = user.get('token_version', 0) + 1
            for case in restored['family_cases']:
                if case.get('kind') == 'binding' and case.get('status') == 'active':
                    case.update(status='revoked', revision=case.get('revision', 1) + 1,
                                revoked_at=_utc_now(), revoked_by='system:restore',
                                reason='恢复备份后须重新核实授权')
            restored['idempotency_keys'] = []
            backup = self._backup_locked()
            self._atomic_write(restored)
            return backup

    def _backup_locked(self) -> Path:
        from uuid import uuid4
        destination = self.data_dir / 'backups'
        destination.mkdir(parents=True, exist_ok=True)
        name = _utc_now().replace(':', '').replace('+', '_')
        target = destination / f'store-{name}-{uuid4().hex[:8]}.json'
        shutil.copy2(self.path, target)
        return target

    def migrate(self) -> Path | None:
        """Explicit migration with a backup of the original file under the same lock."""
        self.ensure()
        with self.lock:
            with self.path.open(encoding='utf-8') as stream:
                data = json.load(stream)
            version = data.get('schema_version')
            if version == CURRENT_SCHEMA_VERSION:
                self._validate(data)
                return None
            if version not in {1, 2, 3}:
                raise RuntimeError(f'Unsupported migration source: {version}')
            added = {'change_reviews'}
            if version in {1, 2}:
                added.add('care_memories')
            if version == 1:
                added.update({'idempotency_keys', 'quality_checks'})
            for name in EMPTY_STORE:
                if name in {'schema_version', 'updated_at'}:
                    continue
                if (name not in added or name in data) and not isinstance(data.get(name), list):
                    raise RuntimeError(f'Invalid source collection: {name}')
            upgraded = copy.deepcopy(data)
            for name in added:
                upgraded.setdefault(name, [])
            upgraded['schema_version'] = CURRENT_SCHEMA_VERSION
            self._validate(upgraded)
            backup = self._backup_locked()
            self._atomic_write(upgraded)
            return backup

    def read(self) -> dict[str, Any]:
        self.ensure()
        with self.lock:
            with self.path.open("r", encoding="utf-8") as stream:
                data = json.load(stream)
        self._validate(data)
        return data

    def mutate(self, callback: Callable[[dict[str, Any]], T]) -> T:
        self.ensure()
        with self.lock:
            with self.path.open("r", encoding="utf-8") as stream:
                data = json.load(stream)
            self._validate(data)
            result = callback(data)
            data["updated_at"] = _utc_now()
            self._atomic_write(data)
            return result

    def replace(self, data: dict[str, Any]) -> None:
        self._validate(data)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self.lock:
            self._atomic_write(data)

    def _atomic_write(self, data: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(prefix="store.", suffix=".tmp", dir=self.data_dir)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary_name, self.path)
        finally:
            if os.path.exists(temporary_name):
                os.unlink(temporary_name)

    @staticmethod
    def _validate(data: dict[str, Any]) -> None:
        version = data.get("schema_version")
        if version != CURRENT_SCHEMA_VERSION:
            raise RuntimeError(f"Unsupported JSON schema version: {version}")
        for collection in EMPTY_STORE:
            if collection in {"schema_version", "updated_at"}:
                continue
            if not isinstance(data.get(collection), list):
                raise RuntimeError(f"Invalid JSON store collection: {collection}")


def _utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
