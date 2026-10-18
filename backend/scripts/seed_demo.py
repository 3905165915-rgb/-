from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402
from app.services.passwords import hash_password  # noqa: E402
from app.storage.json_store import EMPTY_STORE, JsonStore  # noqa: E402


def main() -> None:
    store = JsonStore(settings.data_dir)
    data = {key: list(value) if isinstance(value, list) else value for key, value in EMPTY_STORE.items()}
    data["users"] = [
        {"id": "USER-ADMIN", "username": "admin", "display_name": "演示管理员", "role": "admin", "password_hash": hash_password("demo123"), "active": True},
        {"id": "USER-SUPERVISOR", "username": "supervisor", "display_name": "演示主管", "role": "supervisor", "password_hash": hash_password("demo123"), "active": True},
        {"id": "USER-CAREGIVER", "username": "caregiver", "display_name": "演示护理员", "role": "caregiver", "password_hash": hash_password("demo123"), "active": True},
        {"id": "USER-FAMILY", "username": "family", "display_name": "演示家属", "role": "family", "password_hash": hash_password("demo123"), "active": True},
    ]
    data["elders"] = [
        {"id": "ELDER-305", "name": "王阿姨", "bed_id": "BED-305", "status": "active", "contact_name": "王女士女儿", "contact_phone": "13800000000", "notes": "虚构演示数据"}
    ]
    data["beds"] = [{"id": "BED-305", "room": "305", "status": "occupied", "elder_id": "ELDER-305"}]
    store.replace(data)
    print(f"Demo store initialized at {store.path}")
    print("Demo password for all accounts: demo123")


if __name__ == "__main__":
    main()
