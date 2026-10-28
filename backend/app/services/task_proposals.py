"""Ground scheduling suggestions in quoted text; nothing here creates a task.

The model extracts intent/evidence. Conservative rules resolve explicit dates and
staff names into editable draft values. Formal confirmation still authorizes the
record and tasks in the same transaction, with fresh permission checks.
"""
from __future__ import annotations

import copy
import json
import re
from datetime import datetime, timedelta, timezone

CHINA = timezone(timedelta(hours=8))
_NUM = r'(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})'
_CLOCK = re.compile(
    rf'(?P<day>今天|今日|明天|明日|后天|\d{{4}}-\d{{2}}-\d{{2}}|\d{{4}}年\d{{1,2}}月\d{{1,2}}日)'
    rf'\s*(?P<period>凌晨|早上|上午|中午|下午|傍晚|晚上|晚间)?\s*'
    rf'(?P<hour>{_NUM})(?:(?:[:：])(?P<colon>\d{{2}})|[点时](?:(?P<half>半)|(?P<minute>{_NUM})分?)?)'
    r'(?:之前|以前|前)?'
)


def _number(text: str) -> int:
    if text.isdigit():
        return int(text)
    digits = {'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3,
              '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
    if text in digits:
        return digits[text]
    if re.fullmatch(r'[一二三四五]?十[一二三四五六七八九]?', text):
        left, right = text.split('十')
        return digits.get(left, 1) * 10 + digits.get(right, 0)
    raise ValueError('Unsupported number')


def explicit_due(text: str | None, reference_time: str) -> str | None:
    """Use a fixed extraction timestamp, never a retry time or an assumed meal time."""
    if not isinstance(text, str) or not text:
        return None
    try:
        anchor = datetime.fromisoformat(reference_time.replace('Z', '+00:00'))
        if anchor.tzinfo is None:
            return None
        anchor = anchor.astimezone(CHINA)
        expression = re.sub(r'\s+', '', text)
        for short, full in {'今晚': '今天晚上', '今早': '今天早上', '明晚': '明天晚上', '明早': '明天早上'}.items():
            if expression.startswith(short):
                expression = full + expression[len(short):]
                break
        expression = expression.replace('点钟', '点')
        delay = re.fullmatch(r'(\d{1,3})(分钟|小时)后', expression)
        if delay:
            amount = int(delay[1])
            if not 1 <= amount <= (168 if delay[2] == '小时' else 999):
                return None
            return (anchor + timedelta(**{'hours' if delay[2] == '小时' else 'minutes': amount})).isoformat()
        match = _CLOCK.fullmatch(expression)
        if not match:
            return None
        day = match['day']
        offsets = {'今天': 0, '今日': 0, '明天': 1, '明日': 1, '后天': 2}
        if day in offsets:
            date = (anchor + timedelta(days=offsets[day])).date()
        else:
            date = datetime.strptime(day, '%Y-%m-%d' if '-' in day else '%Y年%m月%d日').date()
        hour = _number(match['hour'])
        minute = 30 if match['half'] else _number(match['colon'] or match['minute'] or '0')
        period = match['period']
        if period is None and match['colon'] is None and hour <= 12:
            # “明天三点” is not enough to distinguish 03:00 from 15:00.
            return None
        if period in {'下午', '傍晚', '晚上', '晚间'}:
            if 1 <= hour < 12:
                hour += 12
            elif hour < 12 or (hour == 12 and period != '下午'):
                return None
            if period == '下午' and hour > 18 or period in {'晚上', '晚间'} and hour < 18:
                return None
            if period == '傍晚' and not 17 <= hour <= 20:
                return None
        elif period == '中午':
            if not 11 <= hour <= 13:
                return None
        elif period in {'凌晨', '早上', '上午'} and not 0 <= hour < 12:
            return None
        return datetime(date.year, date.month, date.day, hour, minute, tzinfo=CHINA).isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def task_proposals(candidates: list[dict], data: dict, *, elder_id: str,
                   shift_id: str | None, user_id: str | None, role: str,
                   reference_time: str) -> list[dict]:
    """Only propose eligible, uniquely named staff. Missing assignments stay missing."""
    rows = []
    seen = set()
    for candidate in candidates:
        # Only literal repeated suggestions are collapsed; distinct dates,
        # quotes and conditions remain independently reviewable.
        key = json.dumps([candidate.get(field) for field in ('title', 'evidence_text', 'due_text', 'condition')], ensure_ascii=False)
        if key not in seen:
            rows.append(copy.deepcopy(candidate))
            seen.add(key)
    shift = next((row for row in data.get('shifts', []) if row['id'] == shift_id), None)
    staff = [row for row in data.get('users', []) if row.get('active', True)
             and row.get('role') in {'admin', 'supervisor', 'caregiver', 'nurse'}]
    for candidate in rows:
        quote = str(candidate.get('evidence_text') or '')
        notes = []
        due_text = candidate.get('due_text')
        # Scheduling values from an adapter are never accepted as AI authority.
        candidate.pop('due_at', None)
        candidate.pop('assigned_to', None)
        due = explicit_due(due_text, reference_time) if quote and isinstance(due_text, str) and due_text in quote else None
        if due:
            candidate['due_at'] = due
            notes.append('时间由原文按北京时间换算，请核对；相对时间以本次录入时刻为准。')
            if datetime.fromisoformat(due) <= datetime.fromisoformat(reference_time.replace('Z', '+00:00')):
                notes.append('换算时刻已早于录入，请核对是否为历史安排；不会自动顺延到明天。')
        else:
            notes.append('原文未给出可确定的日期和时刻，请补充截止时间。')
        named = []
        for person in staff:
            name = person.get('display_name', '')
            if name and quote and re.search(rf'(?:由{re.escape(name)}(?:负责|来|在)|{re.escape(name)}负责)', quote):
                named.append(person)
        # Reported first-person speech can belong to a relative or the elder,
        # not the logged-in author. Leave it unassigned for explicit review.
        reported = re.search(r'(?:说|表示|转述|留言|回复|[“”「」]|(?:家属|儿子|女儿)[：:])', quote)
        if not reported and re.search(r'(?:由我负责|我负责)', quote):
            named.extend(row for row in staff if row['id'] == user_id and row not in named)
        if len(named) == 1:
            person = named[0]
            if (role not in {'caregiver', 'nurse'} or person['id'] == user_id) and (
                not shift or person['id'] in shift.get('caregiver_ids', [])
            ):
                candidate['assigned_to'] = person['id']
                notes.append('负责人由原文明确指派匹配，请核对姓名。')
            else:
                notes.append('原文负责人不在当前可安排范围，请选择本人或交由主管处理。')
        else:
            notes.append('负责人未明确或存在同名，请人工选择；不会默认指派给下一班。')
        if quote and any(row['id'] != elder_id and row.get('name') and row['name'] in quote for row in data.get('elders', [])):
            notes.append('本条原文还提到了其他老人，请拆分记录并核对任务对象。')
            candidate['object_review_required'] = True
        if candidate.get('condition'):
            notes.append('本任务有执行前提，创建任务不代表前提已满足，执行前仍需核验。')
        candidate['review_notes'] = notes
    return rows
