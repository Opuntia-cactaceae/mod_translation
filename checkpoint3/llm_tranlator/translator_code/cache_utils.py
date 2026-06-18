# localization_translator/cache_utils.py
import hashlib
import json
import os
import pathlib
from typing import Dict

from .logging_utils import write_log


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()


def load_cache(path: str) -> Dict[str, str]:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:  # noqa: BLE001
        write_log(f"load_cache error: {e!r}", "errors.log")
    return {}


def save_cache(path: str, cache: Dict[str, str]):
    tmp = path + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    pathlib.Path(tmp).replace(path)