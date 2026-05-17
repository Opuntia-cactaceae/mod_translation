from dataclasses import dataclass
from enum import Enum


class FileCategory(Enum):
    STELLARIS_LOCALISATION = "stellaris_localisation"
    PLAIN_TEXT = "plain_text"
    GENERIC_PLAIN_TEXT = "generic_plain_text"
    GENERIC_JSON = "generic_json"
    GENERIC_YAML = "generic_yaml"
    UNKNOWN = "unknown"


class EntryType(Enum):
    LANGUAGE_HEADER = "language_header"
    TRANSLATION_ENTRY = "translation_entry"
    COMMENT = "comment"
    EMPTY = "empty"
    RAW_UNKNOWN = "raw_unknown"
    DESCRIPTOR_FIELD = "descriptor_field"
    PLAIN_TEXT_LINE = "plain_text_line"


@dataclass(frozen=True)
class FileType:
    category: FileCategory
    extensions: tuple = ()
    mime_type: str = ""

    STELLARIS_LOCALISATION = None  # will be set after class creation
    PLAIN_TEXT = None
    GENERIC_PLAIN_TEXT = None
    GENERIC_JSON = None
    GENERIC_YAML = None
    UNKNOWN = None


FileType.STELLARIS_LOCALISATION = FileType(FileCategory.STELLARIS_LOCALISATION, (".yml", ".yaml"), "text/yaml")
FileType.PLAIN_TEXT = FileType(FileCategory.PLAIN_TEXT, (".txt",), "text/plain")
FileType.GENERIC_PLAIN_TEXT = FileType(FileCategory.GENERIC_PLAIN_TEXT, (".txt",), "text/plain")
FileType.GENERIC_JSON = FileType(FileCategory.GENERIC_JSON, (".json",), "application/json")
FileType.GENERIC_YAML = FileType(FileCategory.GENERIC_YAML, (".yml", ".yaml"), "text/yaml")
FileType.UNKNOWN = FileType(FileCategory.UNKNOWN, (), "application/octet-stream")
