"""Controlled JSON store schema upgrades.

Run explicitly while the service is stopped. Migration creates a backup and
preserves existing accounts, AI drafts, records and task identities.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.storage.json_store import CURRENT_SCHEMA_VERSION, JsonStore  # noqa: E402


def main() -> None:
    store = JsonStore(settings.data_dir)
    store.ensure()
    backup = store.migrate()
    print(f"JSON schema ready: {CURRENT_SCHEMA_VERSION}")
    print(f"Backup: {backup}" if backup else "No migration required.")


if __name__ == "__main__":
    main()
