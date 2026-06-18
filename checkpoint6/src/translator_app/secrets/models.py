from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional
from uuid import uuid4

from translator_app.secrets.masking import mask_secret


@dataclass
class ApiKeyRecord:
    """Internal representation of an API key.

    The raw ``value`` is accessible only inside the backend process.
    External callers MUST use ``masked_value``.

    Backward-compat: ``name`` and ``key`` are accepted as constructor
    kwargs (synced to ``label`` / ``value`` in ``__post_init__``),
    but the canonical fields are ``label`` and ``value``.
    """

    provider: str = ""
    value: str = ""
    label: str = ""
    id: str = field(default_factory=lambda: uuid4().hex)
    created_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    is_active: bool = True
    # backward-compat aliases — accepted as constructor kwargs
    # (synced to label/value in __post_init__)
    name: str = ""
    key: str = ""

    def __post_init__(self):
        if self.name and not self.label:
            self.label = self.name
        if self.key and not self.value:
            self.value = self.key

    # ------------------------------------------------------------------
    # safe display
    # ------------------------------------------------------------------
    @property
    def masked_value(self) -> str:
        return mask_secret(self.value)

    def masked(self) -> str:
        return self.masked_value

    @property
    def key_preview(self) -> str:
        return self.masked_value

    def __repr__(self) -> str:
        return (
            f"ApiKeyRecord(id={self.id!r}, provider={self.provider!r}, "
            f"label={self.label!r}, masked_value={self.masked_value!r}, "
            f"is_active={self.is_active})"
        )

    def __str__(self) -> str:
        return self.__repr__()


@dataclass
class ApiKeyCreateRequest:
    """Payload for creating a new API key."""

    provider: str
    value: str
    label: str = ""


@dataclass
class ApiKeyUpdateRequest:
    """Payload for updating an API key's metadata (only label for now)."""

    label: Optional[str] = None
