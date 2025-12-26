from dataclasses import dataclass
import re

_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-_]{1,64}$")

@dataclass(frozen=True)
class RequestId:
    value: str
    def __post_init__(self):
        if not _REQUEST_ID_RE.match(self.value):
            raise ValueError("Invalid request_id format")

@dataclass(frozen=True)
class LanguageCode:
    value: str
    def __post_init__(self):
        if not (2 <= len(self.value) <= 10):
            raise ValueError("Invalid language code length")

@dataclass(frozen=True)
class ModelId:
    value: str
    def __post_init__(self):
        if not (1 <= len(self.value) <= 128):
            raise ValueError("Invalid model_id length")
