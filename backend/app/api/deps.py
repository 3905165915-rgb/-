from typing import Annotated

from fastapi import Depends

from app.core.security import get_token_payload, require_roles
from app.storage.json_store import JsonStore


def get_store() -> JsonStore:
    from app.core.config import settings

    return JsonStore(settings.data_dir)


Store = Annotated[JsonStore, Depends(get_store)]
CurrentUser = Annotated[dict, Depends(get_token_payload)]
StaffUser = Annotated[dict, Depends(require_roles("admin", "supervisor", "caregiver", 'nurse'))]
IncidentReporter = Annotated[dict, Depends(require_roles("caregiver", "nurse"))]
ManagementUser = Annotated[dict, Depends(require_roles("admin", "supervisor"))]
FamilyUser = Annotated[dict, Depends(require_roles("family"))]
