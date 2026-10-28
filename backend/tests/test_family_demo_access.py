"""The demo family entry can switch elders without creating formal grants."""
import copy
from dataclasses import replace

import pytest

from app.core import config
from test_facility import ROOT, action, post
from test_family import get, publish
from test_family_timeline import journey


@pytest.fixture
def all_elders(api, monkeypatch):
    monkeypatch.setattr(config, 'settings', replace(config.settings, app_env='demo', demo_family_all_elders=True))
    return api


def test_all_elders_visible_without_grants_and_new_elders_appear(all_elders):
    _, store, _ = all_elders
    before = store.path.read_bytes()
    first = get(all_elders, '/family/me/bindings')
    assert len(first) == 1 and first[0]['elder_id'] == 'E1'
    assert first[0]['demo_access'] is True and first[0]['admission_id'] is None
    assert store.path.read_bytes() == before
    store.mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'pending'}))
    before = store.path.read_bytes()
    second = get(all_elders, '/family/me/bindings')
    assert {row['elder_id'] for row in second} == {'E1', 'E2'}
    assert second[0]['id'] == first[0]['id']
    for member in second:
        prefix = '/family/me/bindings/' + member['id']
        assert get(all_elders, prefix + '/timeline') == {
            'elder_id': member['elder_id'], 'elder_name': member['elder_name'], 'items': [], 'total': 0}
        result = post(all_elders, prefix + '/insights', {}, actor='family', expected=200)
        assert result['model_status'] == 'no_public_updates'
    assert store.path.read_bytes() == before
    assert store.read()['family_cases'] == [] and store.read()['admissions'] == []


def test_demo_feed_photos_and_insights_still_use_only_published_content(all_elders):
    _, _, record, summary, photo = journey(all_elders)
    member = get(all_elders, '/family/me/bindings')[0]
    path = '/family/me/bindings/' + member['id']
    event = get(all_elders, path + '/timeline')['items'][0]
    assert event['id'] == summary['id'] and event['photos'][0]['id'] == photo['id']
    assert 'evidence' not in event and record['id'] not in str(event)
    client, _, headers = all_elders
    assert client.get(ROOT + event['photos'][0]['content_path'], headers=headers('family')).status_code == 200
    insight = post(all_elders, path + '/insights', {}, actor='family', expected=200)
    assert insight['points'][0]['citations'][0]['source_id'] == summary['id']
    publish(all_elders, summary, 'withdraw')
    assert get(all_elders, path + '/timeline')['total'] == 0
    get(all_elders, path + f'/photos/{photo["id"]}/content', expected=404)


def test_demo_can_select_former_resident_and_read_published_history(all_elders):
    state, _, _, summary, _ = journey(all_elders)
    member = get(all_elders, '/family/me/bindings')[0]
    action(all_elders, state, 'discharge')
    members = get(all_elders, '/family/me/bindings')
    assert members[0]['id'] == member['id']
    assert get(all_elders, '/family/me/bindings/' + member['id'] + '/timeline')['items'][0]['id'] == summary['id']


def test_messages_remain_separate_per_elder_and_idempotent(all_elders):
    all_elders[1].mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'pending'}))
    first, second = get(all_elders, '/family/me/bindings')
    body = {'binding_id': first['id'], 'text': '下次想带一本相册。'}
    sent = post(all_elders, '/family/me/feedback', body, actor='family', key='demo-message')
    assert post(all_elders, '/family/me/feedback', body, actor='family', key='demo-message') == sent
    assert get(all_elders, '/family/me/bindings/' + first['id'] + '/feedback')[0]['id'] == sent['id']
    assert get(all_elders, '/family/me/bindings/' + second['id'] + '/feedback') == []
    assert len([row for row in all_elders[1].read()['family_cases'] if row.get('kind') == 'feedback']) == 1


@pytest.mark.parametrize('environment', ['production', 'prod'])
def test_production_never_enables_virtual_access(all_elders, monkeypatch, environment):
    member = get(all_elders, '/family/me/bindings')[0]
    monkeypatch.setattr(config, 'settings', replace(config.settings, app_env=environment))
    assert get(all_elders, '/family/me/bindings') == []
    get(all_elders, '/family/me/bindings/' + member['id'] + '/timeline', expected=404)


def test_demo_setting_is_opt_in_and_removal_is_immediate(all_elders, monkeypatch):
    member = get(all_elders, '/family/me/bindings')[0]
    monkeypatch.setattr(config, 'settings', replace(config.settings, demo_family_all_elders=False))
    assert get(all_elders, '/family/me/bindings') == []
    post(all_elders, '/family/me/feedback', {'binding_id': member['id'], 'text': '核对'}, actor='family', expected=404)


def test_ordinary_family_has_no_implicit_access_and_cannot_borrow_demo_ids(all_elders):
    _, store, _ = all_elders
    member = get(all_elders, '/family/me/bindings')[0]
    def add(data):
        user = copy.deepcopy(next(row for row in data['users'] if row['id'] == 'family'))
        user.update(id='relative', username='relative', demo_login_enabled=False)
        data['users'].append(user)
    store.mutate(add)
    assert get(all_elders, '/family/me/bindings', actor='relative') == []
    get(all_elders, '/family/me/bindings/' + member['id'] + '/timeline', actor='relative', expected=404)
    for endpoint in ['/records', '/tasks', '/elders', '/items/E1/timeline']:
        get(all_elders, endpoint, expected=403)


def test_switching_does_not_mix_elders_or_implicitly_publish_records(all_elders):
    _, _, _, summary, photo = journey(all_elders)
    all_elders[1].mutate(lambda data: data['elders'].append({'id': 'E2', 'name': '李爷爷', 'status': 'pending'}))
    first, second = get(all_elders, '/family/me/bindings')
    a = get(all_elders, '/family/me/bindings/' + first['id'] + '/timeline')
    b = get(all_elders, '/family/me/bindings/' + second['id'] + '/timeline')
    assert a['items'][0]['id'] == summary['id'] and b['items'] == []
    get(all_elders, '/family/me/bindings/' + second['id'] + f'/photos/{photo["id"]}/content', expected=404)
