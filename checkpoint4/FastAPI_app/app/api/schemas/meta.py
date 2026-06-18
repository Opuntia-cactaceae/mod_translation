from pydantic import BaseModel
from typing import List, Optional

class ModelInfo(BaseModel):
    id: str
    title: Optional[str] = None

class LanguagesOut(BaseModel):
    languages: List[str]

class ModelsOut(BaseModel):
    models: List[ModelInfo]
