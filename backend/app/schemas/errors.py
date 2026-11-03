from pydantic import BaseModel, Field


class FieldError(BaseModel):
    path: str
    error_code: str
    safe_message: str


class ReloadResource(BaseModel):
    id: str
    path: str | None = None
    method: str = 'GET'


class PublicError(BaseModel):
    detail: str | list[dict]
    error_code: str
    safe_message: str
    field_paths: list[str] = Field(default_factory=list)
    field_errors: list[FieldError] = Field(default_factory=list)
    retryable: bool = False
    conflict_type: str | None = None
    reload_resource: ReloadResource | None = None


ERROR_RESPONSES = {status: {'model': PublicError} for status in (400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504)}
