from typing import List, Literal, Union
from pydantic import constr

Status = Literal["ok", "corrupted"]
TimeoutMode = Literal["wait", "fail"]
ProviderKeys = Union[str, List[str]]

RequestId = constr(
    min_length=1,
    max_length=64,
    pattern=r'^[A-Za-z0-9]+$'
)