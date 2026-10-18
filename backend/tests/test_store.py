from pathlib import Path

from app.storage.json_store import JsonStore
from app.services.store_service import confirm_draft


def test_store_round_trip(tmp_path: Path) -> None:
    store = JsonStore(tmp_path)
    store.ensure()
    store.mutate(lambda data: data["elders"].append({"id": "ELDER-1", "name": "演示老人"}))
    assert store.read()["elders"] == [{"id": "ELDER-1", "name": "演示老人"}]


def test_confirm_draft_is_idempotent(tmp_path: Path) -> None:
    store = JsonStore(tmp_path)
    store.ensure()
    store.mutate(
        lambda data: data["ai_drafts"].append(
            {
                "id": "AI-1",
                "elder_id": "ELDER-1",
                "shift_id": "SHIFT-1",
                "raw_text": "需要联系家属",
                "status": "pending_review",
                "observations": ["需要联系家属"],
                "task_candidates": [{"title": "联系家属反馈"}],
                "evidence": [{"text": "需要联系家属"}],
                "warnings": [],
                "provider": "mock",
                "created_at": "2026-01-01T00:00:00+00:00",
            }
        )
    )
    first_record, first_tasks = confirm_draft(store, "AI-1", "USER-1", None, None)
    second_record, second_tasks = confirm_draft(store, "AI-1", "USER-1", None, None)
    assert first_record.id == second_record.id
    assert first_tasks[0].id == second_tasks[0].id
    assert len(store.read()["care_records"]) == 1
    assert len(store.read()["care_tasks"]) == 1
