"""Explicit management commands; identity/status/occupancy cannot be patched together."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

Name = Annotated[str, Field(min_length=1, max_length=100)]
Note = Annotated[str, Field(min_length=1, max_length=2000)]
StaffRole = Literal['admin', 'supervisor', 'caregiver']


class Command(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class VersionCommand(Command):
    expected_revision: int = Field(ge=1)
    reason: Note


class ElderCreate(Command):
    name: Name
    contact_name: Name | None = None
    contact_phone: Annotated[str, Field(max_length=50)] | None = None
    notes: Note | None = None


class ElderUpdate(VersionCommand):
    name: Name | None = None
    contact_name: Name | None = None
    contact_phone: Annotated[str, Field(max_length=50)] | None = None
    notes: Note | None = None

    @model_validator(mode='after')
    def name_not_null(self):
        if 'name' in self.model_fields_set and self.name is None:
            raise ValueError('Name cannot be null')
        return self


class BedCreate(Command):
    room: Name
    label: Name


class BedUpdate(VersionCommand):
    room: Name | None = None
    label: Name | None = None
    enabled: bool | None = None

    @model_validator(mode='after')
    def no_null_changes(self):
        if any(getattr(self, field) is None for field in ('room', 'label', 'enabled') if field in self.model_fields_set):
            raise ValueError('Bed fields cannot be null')
        return self


class AdmissionCreate(Command):
    expected_elder_revision: int = Field(ge=1)
    bed_id: Name
    expected_bed_revision: int = Field(ge=1)
    kind: Literal['admit', 'legacy_registration'] = 'admit'
    reason: Note


class AdmissionAction(Command):
    expected_revision: int = Field(ge=1)
    expected_elder_revision: int = Field(ge=1)
    action: Literal['transfer', 'out', 'return', 'discharge']
    reason: Note
    bed_id: Name | None = None
    expected_bed_revision: int | None = Field(default=None, ge=1)

    @model_validator(mode='after')
    def transfer_requires_destination(self):
        if self.action == 'transfer':
            if not self.bed_id or self.expected_bed_revision is None:
                raise ValueError('Transfer requires destination bed and its revision')
        elif self.bed_id is not None or self.expected_bed_revision is not None:
            raise ValueError('Only transfer accepts a destination bed')
        return self


class StaffCreate(Command):
    username: Annotated[str, Field(min_length=3, max_length=64, pattern=r'^[a-z0-9][a-z0-9_.-]*$')]
    display_name: Name
    role: StaffRole = 'caregiver'
    password: SecretStr

    @model_validator(mode='after')
    def password_length(self):
        if not 12 <= len(self.password.get_secret_value()) <= 128:
            raise ValueError('Password must contain 12 to 128 characters')
        return self


class StaffUpdate(VersionCommand):
    display_name: Name | None = None
    role: StaffRole | None = None
    active: bool | None = None

    @model_validator(mode='after')
    def no_null_changes(self):
        if any(getattr(self, field) is None for field in ('display_name', 'role', 'active') if field in self.model_fields_set):
            raise ValueError('Staff fields cannot be null')
        return self


class StaffPasswordReset(VersionCommand):
    password: SecretStr

    @model_validator(mode='after')
    def password_length(self):
        if not 12 <= len(self.password.get_secret_value()) <= 128:
            raise ValueError('Password must contain 12 to 128 characters')
        return self
