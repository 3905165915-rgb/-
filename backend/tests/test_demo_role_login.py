from dataclasses import replace

from app.core import config


ROOT = "/api/v1"


def test_demo_role_login_issues_only_enabled_role_account(api):
    client, store, _ = api
    store.mutate(lambda data: data["users"].append(dict(
        next(user for user in data["users"] if user["id"] == "manager"),
        id="admin", username="admin", role="admin", display_name="测试管理员",
        demo_login_enabled=True,
    )))

    for role, user_id in (("caregiver", "staff"), ("supervisor", "manager"), ("admin", "admin"), ("family", "family")):
        response = client.post(ROOT + "/auth/demo-login", json={"role": role})
        assert response.status_code == 200
        body = response.json()
        assert body["role"] == role
        assert body["user_id"] == user_id
        if role != "family":
            authorized = client.get(ROOT + "/elders", headers={"Authorization": "Bearer " + body["access_token"]})
            assert authorized.status_code == 200


def test_demo_role_login_requires_demo_environment(api, monkeypatch):
    client, _, _ = api
    monkeypatch.setattr(config, "settings", replace(config.settings, app_env="production"))

    assert client.post(ROOT + "/auth/demo-login", json={"role": "admin"}).status_code == 404


def test_demo_role_login_requires_explicitly_enabled_active_account(api):
    client, store, _ = api
    store.mutate(lambda data: data["users"].__setitem__(
        slice(None),
        [dict(user, demo_login_enabled=False) if user["id"] == "staff" else user for user in data["users"]],
    ))
    assert client.post(ROOT + "/auth/demo-login", json={"role": "caregiver"}).status_code == 404


def test_demo_role_login_rejects_inactive_account(api):
    client, store, _ = api
    store.mutate(lambda data: data["users"].__setitem__(
        slice(None),
        [dict(user, active=False) if user["id"] == "staff" else user for user in data["users"]],
    ))
    assert client.post(ROOT + "/auth/demo-login", json={"role": "caregiver"}).status_code == 404
