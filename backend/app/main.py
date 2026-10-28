from __future__ import annotations

from contextlib import asynccontextmanager
import threading

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import auth, elders, records, tasks, handovers, timeline, quality, staff, speech, memories, change_reviews, beds, admissions, planning
from app.core.config import settings
from app.schemas.api import HealthResponse
from app.storage.json_store import CURRENT_SCHEMA_VERSION, JsonStore
from app.services.workflow import DomainError
from app.api.routes import family, incidents, reports, insights, impressions
from app.api.routes import notifications, photos, governance, care_advice, elder_workspace


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.ai_provider.lower() not in {'mock', 'deepseek'}:
        raise RuntimeError('AI_PROVIDER must be mock or deepseek')
    if settings.app_env.lower() in {'production', 'prod'}:
        if len(settings.secret_key) < 32 or settings.secret_key.startswith('dev-only-'):
            raise RuntimeError('Production requires a unique SECRET_KEY of at least 32 characters')
        if settings.ai_provider.lower() == 'mock' or settings.ai_fallback_mock:
            raise RuntimeError('Production must not silently use Mock AI; use APP_ENV=demo for synthetic demos')
    store = JsonStore(settings.data_dir)
    store.read()  # Fail startup on an unmigrated/corrupt store.
    from app.services.elder_workspace_service import recover_jobs, run_plan_rules, process_next
    from app.services.record_job_service import process_inline_next
    recover_jobs(store)
    stop = threading.Event()
    def organise():
        while not stop.wait(5):
            try:
                run_plan_rules(store)
                process_inline_next(store)
                process_next(store)
            except Exception:
                # Jobs retain a persistent failure state; never echo record text
                # or credentials into process logs.
                pass
    worker = threading.Thread(target=organise, name='elder-organising', daemon=True)
    # Isolated synthetic tests invoke process_next explicitly for deterministic
    # fault/concurrency checks. Live providers run the durable worker by default.
    if settings.background_jobs_enabled:
        worker.start()
    try:
        yield
    finally:
        stop.set()
        if worker.is_alive():
            worker.join(timeout=1)


app = FastAPI(title="护老智交 Backend", version="0.6.0", lifespan=lifespan)


@app.middleware('http')
async def private_api_responses(request: Request, call_next):
    from app.storage.request_context import expected_demo_batch
    token = None
    if request.url.path.startswith('/api/'):
        batch = JsonStore(settings.data_dir).read().get('demo_batch_id')
        supplied = request.headers.get('X-Demo-Batch')
        if batch and supplied and supplied != batch:
            return JSONResponse(status_code=409, content={'detail': 'demo_batch_changed',
                'safe_message': '演示资料已重建，请刷新页面后继续。'}, headers={'X-Demo-Batch': batch})
        token = expected_demo_batch.set(batch or '')
    try:
        response = await call_next(request)
    finally:
        if token is not None:
            expected_demo_batch.reset(token)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if batch:
            response.headers['X-Demo-Batch'] = batch
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Validation errors can echo complete clinical narratives or credentials in
    # input/ctx. Keep field locations and messages; do not return the submitted body.
    errors = [{field: row[field] for field in ('type', 'loc', 'msg')} for row in exc.errors()]
    return JSONResponse(status_code=422, content={'detail': errors, 'error_code': 'invalid_request',
                        'safe_message': '请检查必填内容、字段类型和时间格式', 'retryable': False})


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(_, exc: StarletteHTTPException):
    messages = {
        400: '请求未完成，请检查填写内容后重试。',
        401: '登录已失效，请重新选择身份或登录。',
        403: '当前账号无权办理此事项，请核对身份或联系主管。',
        404: '未找到相关资料，请刷新列表后重试。',
        405: '当前操作方式不可用，请刷新页面后重试。',
        409: '资料或状态已变化，请刷新并核对后重试。',
        413: '文件或录音过大，请缩小后重试。',
        429: '操作较频繁，请稍后重试；已有记录不会因此被删除。',
        503: '服务暂不可用，请稍后重试或使用人工方式办理。',
        504: '处理等待超时，请先核实是否已保存，再重试整理。',
    }
    detail = exc.detail
    safe = detail if isinstance(detail, str) and any('\u4e00' <= c <= '\u9fff' for c in detail) else messages.get(exc.status_code, '操作未完成，请刷新后核对当前状态。')
    return JSONResponse(status_code=exc.status_code, headers=exc.headers,
                        content={'detail': detail, 'error_code': 'http_' + str(exc.status_code),
                                 'safe_message': safe, 'retryable': exc.status_code in {429, 503, 504}})


@app.exception_handler(DomainError)
async def domain_error_handler(_, exc: DomainError):
    messages = {
        'care_assignment_expired': '此分配已过期，不能撤销；如需继续照护，请新建有效分配。',
        'care_assignment_already_revoked': '此分配已撤销，请刷新查看最新状态。',
        'batch_action_not_allowed': '此批量操作不适用于当前事项，请逐项打开办理。',
        'quality_sources_changed_retry_scan': '检查依据已变化，请重新检查后核对。',
        'task_time_change_reason_required': '最终时间与原文建议不同，请补充调整原因后重试',
        'task_service_time_invalid': '执行时间需在班次内且不晚于截止时间',
        'demo_batch_changed': '演示资料已重建，请刷新页面后继续。',
        'arrangement_context_changed': '相关资料或任务已变化，请重新预览安排后确认。',
        'arrangement_no_service_in_shift': '所选日期与班次没有待安排服务，请核对服务日期、时间和班次。',
        'job_claim_changed': '整理任务已恢复或重新领取，请等待最新结果。',
        'elder_not_in_current_work_scope': '该老人不在你的当前照护范围，请主管安排照护分配或临时支援',
        'elder_not_in_care': '该老人当前不在可提供在院照护的状态，请先核对入住或离院信息',
        'attachment_size_invalid': '照片不能为空且不能超过4MB，请压缩后重试',
        'attachment_format_invalid': '仅支持JPEG、PNG和WebP照片，请将其他格式转换后上传',
        'attachment_format_mismatch': '照片格式无法确认，请转换为JPEG、PNG或WebP后上传',
        'attachment_dimensions_invalid': '照片不能超过1600万像素，且不支持动态图片，请缩小或选择静态照片',
        'attachment_normalized_too_large': '转换后的照片超过4MB，请压缩后重试',
        'attachment_pending_review_private': '照片尚未审核，仅上传人和主管可以查看',
        'attachment_image_invalid': '无法读取这张照片，请重新拍摄或选择其他照片',
        'image_analysis_requires_management_review': '此项照片观察需要主管审核，请提交审核',
        'notification_not_authorized': '你不能查看或操作其他人员的通知',
        'summary_public_quotes_need_confirmation': '请先核对并确认选定引文可以向家属公开',
        'dashboard_narrow_range_required': '所选范围数据过多，请缩短日期或选择老人、班次',
        'stale_revision': '内容已被更新，请刷新后核对',
        'record_impact_changed_refresh': '影响范围已变化，请重新预览并核对',
        'not_a_shift_member': '当前账号未加入该班次，请选择正确班次或联系主管',
        'assistant_context_changed': '相关照护资料已更新，请重新整理并核对',
        'advice_insufficient_sources': '暂无足够的正式记录或有效偏好，请先记录实际照护情况',
        'advice_scope_too_large': '本次照护资料过多，请缩短回顾日期后重试',
        'advice_context_changed': '整理期间照护资料已更新，请重新获取建议',
        'advice_requires_refresh': '建议已处理、过期或依据已变化，请刷新后核对',
        'advice_source_changed': '建议引用的资料已变化，请核实依据后重新安排',
        'advice_trial_paused': '主管已要求停止或调整本次尝试，请先核对新的安排',
        'advice_task_object_mismatch': '建议与任务的老人或来源不一致，请核对',
        'advice_condition_must_be_preserved': '请保留建议的前提条件，核实满足后才能执行',
        'advice_not_proposed': '这条建议已处理，请刷新查看',
        'advice_not_adopted': '请先人工采纳并安排任务，再登记执行反馈',
        'advice_feedback_needs_task_result': '请先登记任务完成或未执行结果，再填写反馈',
        'advice_feedback_already_saved': '本次执行已有有效反馈，请查看原记录',
        'advice_feedback_time_invalid': '反馈发生时间应在任务创建之后且不晚于当前时间',
        'advice_followup_needs_assignment': '后续跟进还需明确负责人和期限',
        'advice_followup_not_requested': '未选择后续跟进，请清除跟进负责人和期限',
        'advice_review_needs_feedback': '暂无执行反馈，不能复核本次尝试结果',
        'advice_feedback_changed': '反馈或任务结果已变化，请刷新核对，必要时重新登记反馈',
        'idempotency_key_payload_mismatch': '本次提交标识已用于其他内容，请核对提交状态',
        'impression_no_records': '这位老人还没有已确认记录，请先登记日常照护情况',
        'impression_sources_changed': '历史记录已新增或更正，请重新整理印象后核对',
        'impression_history_too_large': '当前示范版最多整理240条、16万字记录，未截断或忽略历史，请联系管理员分期整理',
        'impression_record_too_long': '单条记录过长，暂无法完整整理，请先核对记录内容',
        'impression_historical_review': '这是历史版本或已到复核时间，请先重新整理当前印象',
        'impression_point_requires_review': '请先由主管核对这条印象，再确认加入照护记忆',
        'impression_not_long_term_preference': '请核对生活偏好或沟通方式；专业照护关注需另行评估，不能直接作为个人偏好',
        'duplicate_memory_requires_individual_review': '仅可整理内容、适用时间及原文版本完全相同的待确认信息，其他信息请逐条核对。',
        'memory_applicability_time_required': '这是一项临时意愿，请核对适用到什么时间后再加入个人印象。',
        'impression_memory_evidence_mismatch': '所选原文或版本与印象依据不一致，请刷新后重新选择',
        'impression_memory_already_created': '这条印象已加入照护记忆，请在记忆管理中查看或修订，不要重复创建',
        'assessment_incomplete': '评估仍有待观察项目，补充并核对后才能确认',
        'assessment_item_evidence_required': '已选择的评估结果需要关联原文依据或填写本次现场观察',
        'invalid_assessment_item': '评估项目不正确，请刷新后重试',
        'assessment_prefill_context_changed': '预填期间资料或入住情况已变化，请重新获取并核对',
        'assessment_prefill_scope_too_large': '近期评估资料过多，请缩短回顾范围或直接补充现场观察',
        'assessment_evidence_admission_changed': '原文不属于本次入住，请补充本次观察依据',
        'assessment_not_editable': '当前评估状态不可修改，请刷新查看最新版本',
    }
    return JSONResponse(status_code=exc.status_code, content={
        'detail': exc.code, 'error_code': exc.code, 'retryable': False,
        'safe_message': messages.get(exc.code, '操作未完成，请核对当前状态、权限和提交内容'),
    })

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    expose_headers=['X-Demo-Batch'],
    allow_headers=["*"],
)


@app.get("/api/v1/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", environment=settings.app_env, schema_version=CURRENT_SCHEMA_VERSION)


app.include_router(auth.router, prefix="/api/v1")
app.include_router(elders.router, prefix="/api/v1")
app.include_router(records.router, prefix="/api/v1")
app.include_router(tasks.router, prefix="/api/v1")
app.include_router(handovers.router, prefix="/api/v1")
app.include_router(timeline.router, prefix="/api/v1")
app.include_router(quality.router, prefix="/api/v1")
app.include_router(staff.router, prefix="/api/v1")
app.include_router(speech.router, prefix="/api/v1")
app.include_router(memories.router, prefix="/api/v1")
app.include_router(change_reviews.router, prefix="/api/v1")
app.include_router(beds.router, prefix="/api/v1")
app.include_router(admissions.router, prefix="/api/v1")
app.include_router(planning.router, prefix="/api/v1")
app.include_router(family.router, prefix="/api/v1")
app.include_router(incidents.router, prefix="/api/v1")
app.include_router(reports.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(impressions.router, prefix="/api/v1")
app.include_router(notifications.router, prefix="/api/v1")
app.include_router(photos.router, prefix="/api/v1")
app.include_router(governance.router, prefix="/api/v1")

app.include_router(care_advice.router, prefix="/api/v1")
app.include_router(elder_workspace.router, prefix="/api/v1")
