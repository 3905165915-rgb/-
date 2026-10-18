from fastapi import APIRouter, HTTPException, status

from app.api.deps import Store
from app.core.security import create_access_token
from app.schemas.api import LoginRequest, LoginResponse
from app.services.store_service import authenticate


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, store: Store) -> LoginResponse:
    user = authenticate(store, payload.username, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    return LoginResponse(access_token=create_access_token(user.id, user.role), user_id=user.id, role=user.role, display_name=user.display_name)
