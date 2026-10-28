from fastapi import APIRouter, HTTPException, status

from app.api.deps import Store
from app.core.security import create_access_token
from app.models.entities import User
from app.schemas.api import DemoLoginRequest, LoginRequest, LoginResponse
from app.services.store_service import authenticate


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, store: Store) -> LoginResponse:
    user = authenticate(store, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    return LoginResponse(access_token=create_access_token(user.id, user.role, user.token_version), user_id=user.id, role=user.role, display_name=user.display_name)


@router.post("/demo-login", response_model=LoginResponse)
def demo_login(payload: DemoLoginRequest, store: Store) -> LoginResponse:
    from app.core.config import settings

    if settings.app_env.lower() not in {"demo", "development", "test"}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    user = next(
        (
            User.model_validate(item)
            for item in store.read()["users"]
            if item.get("role") == payload.role
            and item.get("active", True)
            and item.get("demo_login_enabled") is True
        ),
        None,
    )
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Demo role unavailable")
    return LoginResponse(
        access_token=create_access_token(user.id, user.role, user.token_version),
        user_id=user.id,
        role=user.role,
        display_name=user.display_name,
    )
