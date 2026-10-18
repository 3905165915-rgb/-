from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import auth, elders, records, tasks
from app.core.config import settings
from app.schemas.api import HealthResponse
from app.storage.json_store import CURRENT_SCHEMA_VERSION, JsonStore


@asynccontextmanager
async def lifespan(_: FastAPI):
    JsonStore(settings.data_dir).ensure()
    yield


app = FastAPI(title="护老智交 Backend", version="0.1.0", lifespan=lifespan)
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
