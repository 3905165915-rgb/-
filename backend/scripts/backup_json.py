"""Operator-only backup/restore. Stop the backend before any restore."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.config import settings  # noqa: E402
from app.storage.json_store import JsonStore  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restore', type=Path)
    parser.add_argument('--confirm-service-stopped', action='store_true')
    args = parser.parse_args()
    store = JsonStore(settings.data_dir)
    if args.restore:
        if not args.confirm_service_stopped:
            parser.error('Stop the service and pass --confirm-service-stopped before restoring')
        backup = store.restore(args.restore)
        print(f'Business data restored; current credentials preserved, sessions invalidated, '
              f'family grants require reauthorization. Pre-restore backup: {backup}')
    else:
        store.read()  # Refuse to back up invalid or unmigrated data as a successful backup.
        print(f'Backup created: {store.backup()}')


if __name__ == '__main__':
    main()
