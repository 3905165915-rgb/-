from __future__ import annotations

import copy
import json
import os
import tempfile
from collections.abc import Callable
from pathlib import Path
from typing import Any, TypeVar

from filelock import FileLock


T = TypeVar("T")
CURRENT_SCHEMA_VERSION = 1


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
        if not self.path.exists():
            self._atomic_write(copy.deepcopy(EMPTY_STORE))

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
