"""Append fictional longitudinal observations for one EXISTING elder; never reset data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings
from app.schemas.api import ManualRecordRequest
from app.services import record_service
from app.services.impression_service import DEMO_MARKER
from app.storage.json_store import JsonStore


def append_demo(store, elder_id, user_id, role):
    start = datetime(2026, 7, 27, 14, 0, tzinfo=timezone(timedelta(hours=8)))
    existing = {r['id'] for r in store.read()['care_records']}
    for index in range(84):
        day = start + timedelta(days=index)
        kind = index % 7
        texts = [
            '张阿姨说：“我喜欢听吕剧，午睡醒来听一会儿就好，声音别太大。”本人选择下午15点左右听戏20分钟，表示满意。',
            '早餐前张阿姨说习惯先洗脸梳头，再去吃饭；今天按本人选择先整理仪容，随后自行选择小米粥。没有提出其他饮食要求。',
            '沟通时张阿姨说：“叫我张阿姨就行，慢慢说，一次说一件，我想一想再答。”护理员先告知下一步、等本人回应后协助，交流顺利。',
            '张阿姨午饭后选择在房间休息。本人说：“中午一点到两点我想睡一会儿，没急事等我醒来再聊。”护理员将非紧急聊天放在午睡后。',
            '散步前张阿姨表示希望有人陪着慢慢走，遇到门口台阶先提醒她，再询问是否需要搀扶；今天经本人同意后陪行，未提出其他要求。',
            '整理房间前张阿姨说：“相册放床头右边抽屉，挪东西先告诉我。”护理员征求同意后整理，并告知相册位置，张阿姨表示认可。',
            '张阿姨选择与女儿在晚饭后通电话约10分钟，说：“你帮我拨好，让我自己跟她说就行。”通话结束后表示下次还想自己聊。',
        ]
        text = texts[kind]
        if kind == 4:
            text += ('本人今天选择上午9点散步。' if index < 63 else
                     '本人近来提出把散步改到下午15点半：“上午不想赶，下午再走。”今天按本次意愿调整，后续时间仍需逐次询问。')
        if index in {18, 46}:
            text = '张阿姨今天说：“昨晚没睡好，今天不听戏也不散步，我想安静休息。”护理员尊重本次意愿，未据此修改长期喜好；本人未说明以后都不参加。'
        if index == 70:
            text = '女儿说希望母亲多参加集体合唱。张阿姨当面说：“我不爱热闹，听吕剧就行。”双方表达不一致，尚未就集体活动达成一致，未替本人作长期选择。'
        narrative = f'{DEMO_MARKER} {day.date().isoformat()}，以下为虚构教学演示，不是真实服务事实。{text}'
        payload = ManualRecordRequest(elder_id=elder_id, raw_text=narrative,
                                      observations=[narrative], happened_at=day, task_candidates=[])
        record_service.manual(store, payload, user_id, role,
                              key=f'impression-demo-20261024:{elder_id}:{index}')
    added = [r for r in store.read()['care_records'] if r['id'] not in existing]
    return {'added': len(added), 'simulated_records': 84, 'from': start.date().isoformat(),
            'to': (start + timedelta(days=83)).date().isoformat()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Append data after backing up the existing store')
    args = parser.parse_args()
    if not args.apply:
        parser.error('Use --apply to append clearly marked fictional records; existing records are preserved.')
    if settings.app_env.lower() != 'demo':
        raise RuntimeError('Fictional records may only be seeded in APP_ENV=demo')
    store = JsonStore(settings.data_dir)
    data = store.read()
    elders = [e for e in data['elders'] if e['name'] == '张阿姨' and e.get('status') == 'active']
    actors = [u for u in data['users'] if u.get('active', True) and u.get('role') == 'admin']
    if len(elders) != 1 or not actors:
        raise RuntimeError('Expected one active 张阿姨 and an existing administrator; nothing was changed')
    backup = store.backup()
    result = append_demo(store, elders[0]['id'], actors[0]['id'], actors[0]['role'])
    print({**result, 'backup': str(backup)})


if __name__ == '__main__':
    main()
