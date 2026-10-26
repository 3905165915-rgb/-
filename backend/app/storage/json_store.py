from __future__ import annotations

import copy
import json
import os
import tempfile
import shutil
import hashlib
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from filelock import FileLock


T = TypeVar("T")
CURRENT_SCHEMA_VERSION = 8


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
    "elder_impressions": [],
    "notifications": [],
    "attachments": [],
    "image_analyses": [],
    "ai_evaluations": [],
    "care_assignments": [],
    "care_advice": [],
    "care_advice_batches": [],
    "care_jobs": [],
    "automation_rules": [],
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
        self._restore_attachment_files(restored, source)
        with self.lock:
            try:
                with self.path.open(encoding='utf-8') as stream:
                    current = json.load(stream)
                self._validate(current)
            except (OSError, ValueError, TypeError, RuntimeError):
                # A corrupt live file must not prevent an explicitly requested
                # restore. There are no trustworthy current credentials to carry
                # forward, so invalidate the restored snapshot's sessions below.
                current = {'users': []}
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
            restored['notifications'] = []
            # A backup must never resurrect a revoked automation authorization.
            for rule in restored['automation_rules']:
                rule.update(enabled=False, revision=rule.get('revision', 1) + 1,
                            error_code='authorization_required_after_restore')
            for job in restored['care_jobs']:
                if job['status'] in {'queued', 'processing'}:
                    job.update(status='failed', updated_at=_utc_now(), error_code='interrupted_by_restore')
            for assignment in restored['care_assignments']:
                if assignment.get('status') == 'active':
                    assignment.update(status='revoked', revision=assignment.get('revision', 1) + 1,
                                      revoked_at=_utc_now(), revoked_by='system:restore',
                                      revoked_reason='恢复备份后须重新核实照护分配')
            for analysis in restored['image_analyses']:
                if analysis.get('status') == 'processing':
                    analysis.update(status='pending_review', model_status='failed', output=None,
                                    error_code='vision_interrupted_by_restore', revision=analysis['revision'] + 1)
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
        # The JSON and its sibling folder form a backup set. Never report
        # success while referenced images are missing or have changed bytes.
        try:
            snapshot = json.loads(self.path.read_text(encoding='utf-8'))
        except (ValueError, TypeError):
            snapshot = {}  # Still preserve a corrupt live file before restore.
        attachments = snapshot.get('attachments', [])
        if attachments:
            sidecar = target.with_suffix('.attachments')
            sidecar.mkdir()
            for item in attachments:
                path = self._attachment_path(self.data_dir / 'attachments', item)
                if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item['sha256']:
                    raise RuntimeError('Attachment missing or corrupt; backup set is incomplete')
                shutil.copy2(path, sidecar / path.name)
        return target

    @staticmethod
    def _attachment_path(root: Path, item: dict) -> Path:
        root = root.resolve()
        path = (root / item['storage_key']).resolve()
        if path.parent != root or path.suffix != '.jpg':
            raise RuntimeError('Invalid attachment storage reference')
        return path

    def _restore_attachment_files(self, restored: dict, source: Path) -> None:
        pending = []
        for item in restored['attachments']:
            live = self._attachment_path(self.data_dir / 'attachments', item)
            if live.is_file() and hashlib.sha256(live.read_bytes()).hexdigest() == item['sha256']:
                continue
            backup = self._attachment_path(source.with_suffix('.attachments'), item)
            if not backup.is_file() or hashlib.sha256(backup.read_bytes()).hexdigest() != item['sha256']:
                raise RuntimeError('Restore needs the matching attachment backup folder')
            pending.append((backup, live))
        # Validate the whole set before copying anything. Restore is an offline
        # operation; existing credential/session invalidation remains unchanged.
        for backup, live in pending:
            live.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(backup, live)

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
            if version not in {1, 2, 3, 4, 5, 6, 7}:
                raise RuntimeError(f'Unsupported migration source: {version}')
            added = {"care_jobs", "automation_rules"}
            if version <= 6:
                added.update({"care_advice", "care_advice_batches"})
            if version <= 4:
                added.add('elder_impressions')
            if version in {1, 2, 3, 4, 5}:
                added.update({'notifications', 'attachments', 'image_analyses', 'ai_evaluations', 'care_assignments'})
            if version in {1, 2, 3}:
                added.add('change_reviews')
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
            # Reject malformed callback output before it can replace the valid live file.
            self._validate(data)
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
            # Windows indexers/virus scanners may briefly hold a just-closed
            # destination handle. Retain the transaction lock and retry only
            # these OS errors; never truncate/delete the live file to recover.
            for attempt in range(6):
                try:
                    os.replace(temporary_name, self.path)
                    break
                except PermissionError as exc:
                    if getattr(exc, 'winerror', None) not in {5, 32, 33} or attempt == 5:
                        raise
                    time.sleep(0.01 * (2 ** attempt))
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
