from test_facility import legacy, post
from test_family import instant


def test_emergency_report_needs_no_ai_or_existing_record_and_is_idempotent(api, monkeypatch):
    from app.services import ai_service
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: (_ for _ in ()).throw(AssertionError('must not call AI')))
    stay = legacy(api)
    body = {'elder_id': 'E1', 'admission_id': stay['admission']['id'], 'occurred_at': instant(),
            'description': '老人表示刚才险些滑倒，具体情况待核实', 'immediate_action': '已陪同坐下并通知主管'}
    first = post(api, '/incidents', body, actor='staff', key='emergency')
    assert first['status'] == 'reported' and first['evidence'] == []
    assert 'severity' not in first and 'category' not in first
    assert post(api, '/incidents', body, actor='staff', key='emergency') == first
    assert len(api[1].read()['incidents']) == 1


def test_incident_preparation_is_optional_cited_draft_not_a_classification(api):
    result = post(api, '/incidents/prepare', {'elder_id': 'E1', 'description': '发现地面有水，尚需核实发生过程'},
                  actor='staff', expected=200)
    assert result['status'] == 'draft' and result['missing'] == ['发生时间', '已采取措施']
    assert result['facts_draft'][0]['citations'][0]['source_id'] == 'description'
    assert 'severity' not in result and 'category' not in result
    assert api[1].read()['incidents'] == []


def test_invalid_preparation_returns_manual_fallback_not_server_error(api, monkeypatch):
    from app.services import ai_service
    class Provider:
        name = 'test-model'
        def summarize(self, sources):
            return {'points': [{'text': '未经核实', 'citations': [{'source_id': 'description', 'quote': '虚构引文'}]}]}
    monkeypatch.setattr(ai_service, 'get_ai_provider', lambda: Provider())
    post(api, '/incidents/prepare', {'elder_id': 'E1', 'description': '地面有水，待核实'}, actor='staff', expected=503)
    assert api[1].read()['incidents'] == []
