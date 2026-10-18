"""Controlled JSON store schema upgrades.

The current schema is version 1. Future changes should add an explicit,
backward-compatible step here instead of silently changing data at startup.
"""

from __future__ import annotations

import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.storage.json_store import CURRENT_SCHEMA_VERSION, JsonStore  # noqa: E402


def main() -> None:
    store = JsonStore(settings.data_dir)
    store.ensure()
    data = store.read()
    version = data["schema_version"]
    if version == CURRENT_SCHEMA_VERSION:
        print(f"JSON store is already at schema version {version}")
        return
    if version > CURRENT_SCHEMA_VERSION:
        raise RuntimeError(f"Store version {version} is newer than supported version {CURRENT_SCHEMA_VERSION}")

    backup_dir = settings.data_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_name = datetime.now(timezone.utc).strftime("store-before-migration-%Y%m%dT%H%M%SZ.json")
    shutil.copy2(store.path, backup_dir / backup_name)

    # Add explicit version steps here when the schema changes.
    raise RuntimeError(f"No migration path is defined from schema version {version}")


if __name__ == "__main__":
    main()
