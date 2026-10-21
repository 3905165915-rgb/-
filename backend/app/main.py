from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import auth, elders, records, tasks, handovers, timeline, quality, staff, speech, memories, change_reviews, beds, admissions, planning
from app.core.config import settings
from app.schemas.api import HealthResponse
from app.storage.json_store import CURRENT_SCHEMA_VERSION, JsonStore
from app.services.workflow import DomainError
from app.api.routes import family, incidents, reports, insights


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.ai_provider.lower() not in {'mock', 'deepseek'}:
        raise RuntimeError('AI_PROVIDER must be mock or deepseek')
    if settings.app_env.lower() in {'production', 'prod'}:
        if len(settings.secret_key) < 32 or settings.secret_key.startswith('dev-only-'):
            raise RuntimeError('Production requires a unique SECRET_KEY of at least 32 characters')
        if settings.ai_provider.lower() == 'mock' or settings.ai_fallback_mock:
            raise RuntimeError('Production must not silently use Mock AI; use APP_ENV=demo for synthetic demos')
    JsonStore(settings.data_dir).read()  # Fail startup on an unmigrated/corrupt store.
    yield


app = FastAPI(title="护老智交 Backend", version="0.4.2", lifespan=lifespan)


@app.middleware('http')
async def private_api_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith('/api/'):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    if request.url.path.startswith(('/api/v1/staff', '/api/v1/family/accounts', '/api/v1/auth/login')):
        # Pydantic model-level errors can contain the full raw body, including a
        # password, even when the model declares SecretStr. Never echo that input.
        errors = [{field: row[field] for field in ('type', 'loc', 'msg')} for row in exc.errors()]
        return JSONResponse(status_code=422, content={'detail': errors})
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(DomainError)
async def domain_error_handler(_, exc: DomainError):
    return JSONResponse(status_code=exc.status_code, content={'detail': exc.code})

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
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
