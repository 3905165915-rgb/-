from fastapi import APIRouter, HTTPException

from app.api.deps import StaffUser, Store
from app.schemas.api import Elder
from app.services.store_service import get_elder, list_elders


router = APIRouter(prefix="/elders", tags=["elders"])


@router.get("", response_model=list[Elder])
def elders(_: StaffUser, store: Store) -> list[Elder]:
    return list_elders(store)


@router.get("/{elder_id}", response_model=Elder)
def elder(elder_id: str, _: StaffUser, store: Store) -> Elder:
    item = get_elder(store, elder_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Elder not found")
    return item
