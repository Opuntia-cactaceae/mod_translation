from __future__ import annotations

from typing import Literal, Sequence, Union

TimeoutMode = Literal["wait", "fail"]
ProviderKeys = Union[str, Sequence[str]]
TranslationStatus = Literal["ok", "corrupted"]