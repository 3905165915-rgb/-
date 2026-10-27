"""Offline single-elder rebuild. Keeps every account and password hash; never calls AI.

Stop the backend before --apply. Preparation is isolated; final compare/backup/replace
is one locked transaction. Attachment files remain archived, with no live links.
"""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.storage.json_store import EMPTY_STORE, JsonStore
from app.schemas.api import ManualRecordRequest, ShiftCreateRequest, TaskCreateRequest, HandoverCreateRequest, TaskTransitionRequest, CorrectRecordRequest
from app.schemas.facility import ElderCreate, BedCreate, AdmissionCreate
from app.schemas.care_scope import CareAssignment
from app.schemas.memory import MemoryCreateRequest, MemoryReviewRequest
from app.schemas.planning import AssessmentCreate, AssessmentReview, PlanCreate, PlanReview, PlanGenerate
from app.schemas.family import BindingCreate, SummaryCreate, SummaryReview
from app.schemas.task_memory import TaskMemoryAdoptRequest
from app.services import task_memory_service
from app.services.workflow import audit
from app.services import facility_service as facility, handover_service as handover, record_service as records
from app.services import care_scope_service, memory_service, assessment_service, plan_service, task_service, family_service


def build_demo(previous):
    data = copy.deepcopy(EMPTY_STORE)
    data['demo_batch_id'] = uuid.uuid4().hex
    data['demo_mode'] = True
    data['audit_logs'] = [copy.deepcopy(event) for event in previous.get('audit_logs', []) if event.get('action') == 'rebuild_demo']
    data['users'] = copy.deepcopy(previous['users'])
    active = [u for u in data['users'] if u.get('active', True)]
    manager = next((u for u in active if u['role'] == 'admin'), None) or next((u for u in active if u['role'] == 'supervisor'), None)
    caregiver = next((u for u in active if u['role'] == 'caregiver'), None)
    if not manager or not caregiver:
        raise ValueError('Existing active management and caregiver accounts are required')
    for user in data['users']:
        user['token_version'] = user.get('token_version', 0) + 1
    mid, role, cid = manager['id'], manager['role'], caregiver['id']
    instant = datetime.now(timezone(timedelta(hours=8)))
    stamp = instant.isoformat()
    with TemporaryDirectory(prefix='hulao-wang-stage-') as temporary:
        store = JsonStore(Path(temporary))
        store.replace(data)
        shifts = []
        start = instant.replace(minute=0, second=0, microsecond=0) - timedelta(hours=2)
        for index in range(24):
            begins = start + timedelta(hours=8 * index)
            shifts.append(handover.create_shift(store, ShiftCreateRequest(
                name=('当前班' if index == 0 else '下一班' if index == 1 else begins.strftime('%m月%d日%H时班')),
                start_at=begins, end_at=begins + timedelta(hours=8), caregiver_ids=[cid]), mid))
        elder = facility.create_elder(store, ElderCreate(name='王爷爷', contact_name='王女士',
            notes='喜欢轻声沟通，活动前请先询问本人意愿。'), mid, role)
        eid = elder['id']
        bed = facility.create_bed(store, BedCreate(room='101', label='1床'), mid, role)
        admission = facility.admit(store, eid, AdmissionCreate(expected_elder_revision=elder['revision'],
            bed_id=bed['id'], expected_bed_revision=bed['revision'], reason='演示入住登记'), mid, role)
        admission_id = admission['elder']['current_admission_id']
        care_scope_service.assign(store, CareAssignment(elder_id=eid, caregiver_id=cid,
            kind='explicit_assignment', start_at=start, end_at=instant+timedelta(days=8),
            reason='王爷爷日常照护分配'), mid, role)
        # The fictional history belongs to this admission, whose start precedes it.
        def history_start(d):
            d['admissions'][0]['admitted_at'] = (instant-timedelta(days=31)).isoformat()
            for stay in d['admissions'][0].get('bed_stays', []):
                stay['started_at'] = (instant-timedelta(days=31)).isoformat()
        store.mutate(history_start)
        phrases = [
            '王爷爷说：“我一直喜欢听低音量的京剧，活动前请先问问我。”',
            '王爷爷说：“和我说话请慢一些，一次讲一个步骤，我听得更清楚。”',
            '王爷爷说：“我习惯午后先休息，起床后再安排活动。”',
            '早餐时王爷爷自行使用餐具，护理员在旁提醒慢慢进食。',
            '王爷爷同意在走廊散步，护理员在旁陪同，结束后坐下休息。',
            '下午活动前先征询意愿，王爷爷愿意参加轻声听戏。',
            '晚间沟通时一次说明一个步骤，王爷爷点头后再继续。',
            '午休后王爷爷愿意与邻座聊天，护理员协助调低电视音量。',
            '王女士探望时补充：父亲在家也喜欢轻声听京剧，沟通时请一次说一件事。',
        ]
        saved = []
        for index in range(40):
            day = 29-index if index < 30 else 29-2*(index-30)
            occurred = instant-timedelta(days=day, minutes=60+index)
            text = phrases[index % len(phrases)]
            if index == 39:
                text = '王爷爷说：“今天想休息，这次不参加活动。”护理员尊重本次意愿。'
                occurred = instant-timedelta(minutes=20)
            saved.append(records.manual(store, ManualRecordRequest(elder_id=eid, raw_text=text,
                observations=[text], happened_at=occurred), cid, 'caregiver', queue_analysis=False)['record'])
        memories=[]
        for index, category, scene in [(0,'stable_preference','activity'),(1,'communication','communication'),(2,'stable_preference','rest')]:
            record = saved[index]
            memory = memory_service.create(store, MemoryCreateRequest(elder_id=eid, content=record['observations'][0],
                category=category, scenes=[scene], attributed_to='elder', source_record_id=record['id'],
                source_revision=1, source_quote=record['observations'][0], review_due_at=instant+timedelta(days=14)), cid, 'caregiver')
            memory=memory_service.review(store, memory['id'], MemoryReviewRequest(action='confirm',
                expected_revision=memory['revision'], reason='演示角色核对本人多日表达后确认'), mid, role)
            memories.append(memory)
        scores = {key: options[-1][0] for key, _, options in assessment_service.ITEMS}
        scores.update(mobility=10, transfer=10)
        assessment = assessment_service.create(store, AssessmentCreate(elder_id=eid, scores=scores,
            assessed_at=instant-timedelta(minutes=5), review_due_at=instant+timedelta(days=14),
            direct_observations={key:'演示现场观察：'+label+'表现已逐项核对' for key,label,_ in assessment_service.ITEMS},
            note='演示人员逐项核对生活能力，不用于真实临床判断。'), cid,'caregiver')
        assessment = assessment_service.review(store, assessment['id'], AssessmentReview(action='confirm',
            expected_revision=assessment['revision'], reason='逐项核对生活能力观察',
            care_level_label='日常陪同', care_level_basis='机构演示标签，不用于收费及长护险认定'), mid, role)
        scheduled = instant-timedelta(minutes=10)
        plan = plan_service.create(store, PlanCreate(elder_id=eid, assessment_id=assessment['id'],
            expected_assessment_revision=assessment['revision'], title='王爷爷日常照护安排',
            goal='先询问本人意愿，再安排适合的活动和休息。', starts_on=scheduled.date(), ends_on=(instant+timedelta(days=7)).date(),
            items=[dict(key='daily-activity',title='询问并陪同听戏',scene='activity',times=[scheduled.strftime('%H:%M')],
                instruction='先询问当次意愿，愿意时安排低音量京剧，记录回应。')]), mid,role)
        plan = plan_service.review(store,plan['id'],PlanReview(expected_revision=plan['revision'],action='approve',reason='确认日常安排'),mid,role)
        generated = plan_service.generate(store,plan['id'],PlanGenerate(expected_revision=plan['revision'],
            service_date=scheduled.date(),shift_id=shifts[0]['id'],assigned_to=cid),mid,role)
        task_service.complete(store,generated['created_tasks'][0]['id'],cid,'caregiver','本人愿意，已安排低音量京剧并记录回应。')
        for title, minutes in [('询问下午活动意愿',60),('陪同走廊散步',90),('询问午休时间',120)]:
            task = task_service.create(store,TaskCreateRequest(elder_id=eid,title=title,shift_id=shifts[0]['id'],
                assigned_to=cid,due_at=instant+timedelta(minutes=minutes),completion_criteria='先询问意愿，记录本人回应与实际办理结果。'),mid,role)
            if minutes == 90:
                task_service.transition(store,task.id,TaskTransitionRequest(action='not_done',expected_revision=task.revision,
                    reason_code='elder_refused',note='今天本人想休息，尊重本次意愿，交班时继续关注。'),cid,'caregiver')
            if minutes == 120:
                memory=memories[2]
                task_memory_service.adopt(store,task.id,TaskMemoryAdoptRequest(expected_task_revision=task.revision,
                    memory_id=memory['id'],expected_memory_revision=memory['revision'],scene='rest',
                    reason='安排前核对既有午休习惯，仍以本人当次意愿为准'),cid,'caregiver')
        records.correct(store,saved[2]['id'],CorrectRecordRequest(expected_revision=1,
            observations=['王爷爷说：“午休时间这几天想自己决定，请每天先问我。”'],reason='本人近期表达变化，提请复核午休偏好'),mid,role)
        handover.create(store,HandoverCreateRequest(source_shift_id=shifts[0]['id'],target_shift_id=shifts[1]['id']),cid,'caregiver')
        family = next((u for u in active if u['role']=='family'),None)
        if family:
            family_service.create_binding(store,BindingCreate(elder_id=eid,admission_id=admission_id,family_id=family['id'],
                relationship='女儿',consent_reference='演示本人及家属知情授权',scopes=['summary','feedback'],expires_at=instant+timedelta(days=30)),mid,role)
            record=saved[0]
            summary=family_service.create_summary(store,SummaryCreate(elder_id=eid,admission_id=admission_id,
                period_start=instant-timedelta(days=30),period_end=instant,
                text='王爷爷喜欢低音量的京剧。我们会在每次活动前先询问他的意愿，让安排更合心意。',
                evidence=[dict(record_id=record['id'],revision=1,field='observations',quote=record['observations'][0])]),mid,role)
            family_service.review_summary(store,summary['id'],SummaryReview(expected_revision=summary['revision'],action='publish',reason='已核对家属可见内容'),mid,role)
        result=store.read()
    # No queued model output is fabricated during seeding.
    result['care_jobs']=[]
    audit(result, 'rebuild_demo', result['demo_batch_id'], mid, queue_record_job=False,
          batch_id=result['demo_batch_id'], detail='仅含王爷爷的合成演示批次，不代表真实运营或模型效果')
    assert len(result['elders'])==1 and len(result['care_records'])==40
    assert all(u['password_hash']==next(p['password_hash'] for p in previous['users'] if p['id']==u['id']) for u in result['users'])
    return result


def reset(store):
    previous=store.read()
    candidate=build_demo(previous)
    backup=[]
    owner=store.path.stat()
    def commit(data):
        if data != previous:
            raise RuntimeError('Store changed during preparation; stop writes and retry')
        backup.append(str(store._backup_locked()))
        data.clear()
        data.update(candidate)
    store.mutate(commit)
    current_keys = {item['storage_key'] for item in candidate['attachments']}
    removed = 0
    cleanup_warnings = []
    for item in previous.get('attachments', []):
        if item['storage_key'] in current_keys:
            continue
        try:
            path = store._attachment_path(store.data_dir / 'attachments', item)
            if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == item['sha256']:
                path.unlink()
                removed += 1
        except (OSError, ValueError, KeyError):
            cleanup_warnings.append('部分旧附件待管理员清理，已从新业务数据解除引用')
    if hasattr(os,'chown'):
        try:
            os.chown(store.path,owner.st_uid,owner.st_gid)
        except OSError:
            cleanup_warnings.append('数据已替换，请管理员核对数据文件的运行账号权限')
    return {'backup':backup[0],'elder':'王爷爷','records':40,'batch_id':candidate['demo_batch_id'],
            'removed_verified_attachments':removed, 'cleanup_warnings':cleanup_warnings}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,required=True)
    parser.add_argument('--apply',action='store_true',required=True)
    parser.add_argument('--writes-stopped',action='store_true',required=True)
    args=parser.parse_args()
    print(json.dumps(reset(JsonStore(args.data_dir)),ensure_ascii=False))
