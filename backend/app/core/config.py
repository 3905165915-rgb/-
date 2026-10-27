from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


def _csv(value: str) -> tuple[str, ...]:
    return tuple(item.strip() for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    app_env: str
    secret_key: str
    access_token_minutes: int
    data_dir: Path
    ai_provider: str
    deepseek_api_key: str
    deepseek_base_url: str
    deepseek_model: str
    deepseek_timeout_seconds: float
    ai_fallback_mock: bool
    cors_origins: tuple[str, ...]
    siliconflow_api_key: str = ''
    speech_timeout_seconds: float = 45
    vision_api_key: str = ''
    vision_base_url: str = ''
    vision_model: str = ''
    vision_timeout_seconds: float = 45
    background_jobs_enabled: bool = True
    demo_family_all_elders: bool = False


def get_settings() -> Settings:
    raw_data_dir = os.getenv("DATA_DIR", str(BACKEND_DIR / "data"))
    data_dir = Path(raw_data_dir)
    if not data_dir.is_absolute():
        data_dir = (Path.cwd() / data_dir).resolve()
    return Settings(
        app_env=os.getenv("APP_ENV", "demo"),
        secret_key=os.getenv("SECRET_KEY", "dev-only-change-me-please-use-a-long-secret"),
        access_token_minutes=int(os.getenv("ACCESS_TOKEN_MINUTES", "720")),
        data_dir=data_dir,
        ai_provider=os.getenv("AI_PROVIDER", "mock"),
        deepseek_api_key=os.getenv("DEEPSEEK_API_KEY", ""),
        deepseek_base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1").rstrip("/"),
        deepseek_model=os.getenv("DEEPSEEK_MODEL", "deepseek-flash"),
        deepseek_timeout_seconds=float(os.getenv("DEEPSEEK_TIMEOUT_SECONDS", "30")),
        ai_fallback_mock=os.getenv("AI_FALLBACK_MOCK", "false").lower() in {"1", "true", "yes"},
        cors_origins=_csv(
            os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:4173")
        ),
        siliconflow_api_key=os.getenv('SILICONFLOW_API_KEY', '').strip(),
        speech_timeout_seconds=float(os.getenv('SPEECH_TIMEOUT_SECONDS', '45')),
        vision_api_key=os.getenv('VISION_API_KEY', '').strip(),
        vision_base_url=os.getenv('VISION_BASE_URL', '').strip().rstrip('/'),
        vision_model=os.getenv('VISION_MODEL', '').strip(),
        vision_timeout_seconds=float(os.getenv('VISION_TIMEOUT_SECONDS', '45')),
        background_jobs_enabled=os.getenv('BACKGROUND_JOBS_ENABLED', 'true').lower() in {'1', 'true', 'yes'},
        demo_family_all_elders=os.getenv('DEMO_FAMILY_ALL_ELDERS', 'false').lower() in {'1', 'true', 'yes'},
    )


settings = get_settings()
