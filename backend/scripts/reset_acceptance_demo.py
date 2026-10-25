"""Rebuild two fictional care journeys while keeping the four account identities.

Run with the backend stopped. Passwords are prompted, never embedded in code.
The normal staff provisioning password policy is deliberately left unchanged.
"""
from __future__ import annotations

import argparse
import copy
import getpass
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.api import (HandoverCreateRequest, ManualRecordRequest, ShiftCreateRequest,
                             TaskCreateRequest)
from app.schemas.facility import AdmissionCreate, BedCreate, ElderCreate
from app.schemas.family import BindingCreate, SummaryCreate, SummaryReview
from app.schemas.memory import MemoryCreateRequest, MemoryReviewRequest
from app.schemas.planning import (AssessmentCreate, AssessmentReview, PlanCreate,
                                 PlanGenerate, PlanReview)
from app.schemas.task_memory import TaskMemoryAdoptRequest
from app.services import (assessment_service, facility_service, family_service,
                         handover_service, memory_service, plan_service,
                         record_service, task_memory_service, task_service)
from app.services.passwords import hash_password
from app.storage.json_store import EMPTY_STORE, JsonStore


ACCOUNT_NAMES = {
    'admin': ('admin', '管理员'),
    'manager': ('supervisor', '护理主管'),
    'nurse': ('caregiver', '护理员'),
    'family': ('family', '张阿姨家属'),
}
PREVIOUS_USERNAMES = {'manager': 'supervisor', 'nurse': 'caregiver'}


def build_demo(previous: dict, password: str) -> dict:
    """Build and validate a separate store before replacing any live data."""
    if not password:
        raise ValueError('A demo password is required')
    data = copy.deepcopy(EMPTY_STORE)
    identities = {}
    for username, (role, display_name) in ACCOUNT_NAMES.items():
        matches = [row for row in previous['users'] if row['username'] == username]
        if not matches and username in PREVIOUS_USERNAMES:
            matches = [row for row in previous['users'] if row['username'] == PREVIOUS_USERNAMES[username]]
        if len(matches) != 1:
            raise ValueError('Expected exactly one existing account: ' + username)
        user = copy.deepcopy(matches[0])
        user.update(username=username, role=role, display_name=display_name, active=True,
                    password_hash=hash_password(password),
                    token_version=user.get('token_version', 0) + 1,
                    revision=user.get('revision', 1) + 1)
        data['users'].append(user)
        identities[username] = user['id']
    admin, supervisor, caregiver, family = (identities[key] for key in ACCOUNT_NAMES)
    local = timezone(timedelta(hours=8))
    instant = datetime.now(local)
    start = instant.replace(minute=0, second=0, microsecond=0) - timedelta(hours=2)
    review_due = instant + timedelta(days=14)
    with TemporaryDirectory(prefix='hulao-acceptance-') as temporary:
        store = JsonStore(Path(temporary))
        store.replace(data)
        shifts = []
        for index, name in enumerate(('当前班', '下一班', '后续班')):
            begins = start + timedelta(hours=8 * index)
            shifts.append(handover_service.create_shift(store, ShiftCreateRequest(
                name=name, start_at=begins, end_at=begins + timedelta(hours=8),
                caregiver_ids=[caregiver]), admin))
        shift_id = shifts[0]['id']
        examples = [
            ('张阿姨', '101床', 'activity', 'stable_preference',
             '我喜欢听京剧，安排活动前请先问问我。',
             '进食时需要少量帮助，走动时需要陪同。',
             '询问并安排听戏活动', '先询问本次意愿；本人愿意时再安排听戏，并记录实际结果。'),
            ('李爷爷', '102床', 'communication', 'communication',
             '和我说话请放慢语速，一次说一件事。',
             '进食基本可自行完成，起身时需要有人在旁陪同。',
             '询问并陪同起身活动', '先说明步骤并征得同意，在旁陪同起身，记录本次意愿和结果。'),
        ]
        for index, (name, bed_label, scene, category, quote, observation, title, instruction) in enumerate(examples):
            elder = facility_service.create_elder(store, ElderCreate(
                name=name, contact_name='家属', notes='虚构测试资料，仅用于比赛演示。'), admin, 'admin')
            bed = facility_service.create_bed(store, BedCreate(room='101', label=bed_label), admin, 'admin')
            admission = facility_service.admit(store, elder['id'], AdmissionCreate(
                expected_elder_revision=elder['revision'], bed_id=bed['id'],
                expected_bed_revision=bed['revision'], reason='虚构测试入住'), admin, 'admin')
            elder_id = elder['id']
            from app.schemas.care_scope import CareAssignment
            from app.services import care_scope_service
            care_scope_service.assign(store, CareAssignment(
                elder_id=elder_id, caregiver_id=caregiver, kind='explicit_assignment',
                start_at=start, end_at=instant + timedelta(days=7),
                reason='虚构演示照护分配，7天后需重新确认'), admin, 'admin')
            current_elder = next(row for row in store.read()['elders'] if row['id'] == elder_id)
            admission_id = current_elder['current_admission_id']
            recorded = instant - timedelta(minutes=5)
            record = record_service.manual(store, ManualRecordRequest(
                elder_id=elder_id, shift_id=shift_id,
                raw_text=f'{name}说：“{quote}”护理观察：{observation}',
                observations=[quote, observation], happened_at=recorded), caregiver, 'caregiver')['record']
            memory = memory_service.create(store, MemoryCreateRequest(
                elder_id=elder_id, content=quote, category=category,
                scenes=[scene], attributed_to='elder', source_record_id=record['id'],
                source_revision=record['revision'], source_quote=quote,
                review_due_at=review_due), caregiver, 'caregiver')
            memory = memory_service.review(store, memory['id'], MemoryReviewRequest(
                action='confirm', expected_revision=memory['revision'],
                reason='演示初始化：人工角色确认虚构偏好，非AI自动生效'), supervisor, 'supervisor')
            evidence = [{'record_id': record['id'], 'revision': record['revision'],
                         'field': 'observations', 'quote': observation}]
            scores = {key: options[-1][0] for key, _, options in assessment_service.ITEMS}
            scores.update(feeding=5 if index == 0 else 10, mobility=10, transfer=10)
            assessment = assessment_service.create(store, AssessmentCreate(
                elder_id=elder_id, scores=scores, assessed_at=instant - timedelta(minutes=1),
                review_due_at=review_due, evidence=evidence,
                note='预置虚构评估，仅验证表单、审批和计划链路，不作为真实护理判断。'), caregiver, 'caregiver')
            assessment = assessment_service.review(store, assessment['id'], AssessmentReview(
                expected_revision=assessment['revision'], action='confirm',
                reason='虚构测试评估审批', care_level_label='演示协助照护',
                care_level_basis='仅为测试机构自定义标签，不用于收费、补贴或长护险认定。'), supervisor, 'supervisor')
            scheduled = instant + timedelta(minutes=-15 if index == 0 else 45)
            plan = plan_service.create(store, PlanCreate(
                elder_id=elder_id, assessment_id=assessment['id'],
                expected_assessment_revision=assessment['revision'], title=name + '照护计划',
                goal='尊重本人意愿，依据已确认的偏好提供个性化服务。',
                starts_on=min(instant.date(), scheduled.date()), ends_on=(instant + timedelta(days=7)).date(),
                items=[{'key':'daily-care', 'title':title, 'scene':scene,
                        'instruction':instruction, 'times':[scheduled.strftime('%H:%M')]}]), supervisor, 'supervisor')
            plan = plan_service.review(store, plan['id'], PlanReview(
                expected_revision=plan['revision'], action='approve',
                reason='虚构计划审批，待护理员实际操作'), supervisor, 'supervisor')
            generated = plan_service.generate(store, plan['id'], PlanGenerate(
                expected_revision=plan['revision'], service_date=scheduled.date(),
                shift_id=shift_id, assigned_to=caregiver), supervisor, 'supervisor')
            assert len(generated['created_tasks']) == 1
            task = generated['created_tasks'][0]
            task_memory_service.adopt(store, task['id'], TaskMemoryAdoptRequest(
                expected_task_revision=task.get('revision', 1), memory_id=memory['id'],
                expected_memory_revision=memory['revision'], scene=scene,
                reason='演示初始化：人工角色明确采用已确认的相关偏好'), caregiver, 'caregiver')
            if index == 0:
                task_service.complete(store, task['id'], caregiver, 'caregiver',
                                      '预置虚构已完成示例：询问后本人愿意听戏，已按本人意愿安排。')
                family_service.create_binding(store, BindingCreate(
                    elder_id=elder_id, admission_id=admission_id, family_id=family,
                    relationship='女儿', consent_reference='虚构授权记录，仅用于测试',
                    scopes=['summary', 'feedback'], expires_at=instant + timedelta(days=30)), admin, 'admin')
                summary = family_service.create_summary(store, SummaryCreate(
                    elder_id=elder_id, admission_id=admission_id,
                    period_start=recorded - timedelta(minutes=1), period_end=instant,
                    text='今天已记录张阿姨的听戏偏好和日常协助需求，具体活动将在征求本人同意后安排。',
                    evidence=evidence), supervisor, 'supervisor')
                family_service.review_summary(store, summary['id'], SummaryReview(
                    expected_revision=summary['revision'], action='publish',
                    reason='虚构简报已人工核对，仅公开必要内容'), supervisor, 'supervisor')
                followup = task_service.create(store, TaskCreateRequest(
                    elder_id=elder_id, title='再次询问本次活动意愿', shift_id=shift_id,
                    assigned_to=caregiver, due_at=instant + timedelta(hours=1),
                    completion_criteria='先轻声询问本次意愿；愿意则安排活动，拒绝则记录原因，不改写长期偏好。'), caregiver, 'caregiver')
                task_memory_service.adopt(store, followup.id, TaskMemoryAdoptRequest(
                    expected_task_revision=followup.revision, memory_id=memory['id'],
                    expected_memory_revision=memory['revision'], scene=scene,
                    reason='后续询问时采用听戏偏好，但仍须核实本次意愿'), caregiver, 'caregiver')
        facility_service.create_bed(store, BedCreate(room='101', label='103床'), admin, 'admin')
        handover_service.create(store, HandoverCreateRequest(
            source_shift_id=shift_id, target_shift_id=shifts[1]['id']), caregiver, 'caregiver')
        result = store.read()
    assert [row['name'] for row in result['elders']] == ['张阿姨', '李爷爷']
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--apply', action='store_true', required=True)
    args = parser.parse_args()
    password = getpass.getpass('New password for the four demo accounts: ')
    store = JsonStore(args.data_dir)
    original = store.read()
    candidate = build_demo(original, password)
    # One locked transaction: a concurrently changed store is never overwritten.
    def replace(data):
        if data != original:
            raise RuntimeError('Store changed during preparation; retry with backend stopped')
        store._backup_locked()
        data.clear()
        data.update(candidate)
    owner = store.path.stat()
    store.mutate(replace)
    if hasattr(os, 'chown'):
        os.chown(store.path, owner.st_uid, owner.st_gid)
    print(json.dumps({'elders':['张阿姨','李爷爷'], 'users':list(ACCOUNT_NAMES),
                      'counts':{key:len(value) for key,value in candidate.items() if isinstance(value,list)}},
                     ensure_ascii=False))


if __name__ == '__main__':
    main()
