from enum import Enum, auto


class ValidationStatus(Enum):
    VALID = auto()
    REPAIRED = auto()
    RETRY_REQUIRED = auto()
    FALLBACK_REQUIRED = auto()
    INVALID = auto()


class AttemptStatus(Enum):
    SUCCESS = auto()
    FAILED = auto()
    TIMEOUT = auto()
    RATE_LIMIT = auto()
    PARSE_ERROR = auto()
    VALIDATION_ERROR = auto()


class ResponseOutcomeType(Enum):
    ACCEPTED_WITHOUT_RETRY = auto()
    ACCEPTED_AFTER_RETRY = auto()
    FORMAT_REPAIR_APPLIED = auto()
    FALLBACK_TO_SINGLE = auto()
    TRANSPORT_ERROR = auto()
    TIMEOUT = auto()
    RATE_LIMITED = auto()
    EMPTY_RESPONSE = auto()
    INVALID_JSON = auto()
    INVALID_BATCH_SHAPE = auto()
    WRONG_ITEM_COUNT = auto()
    MISSING_CONTENT = auto()
    UNKNOWN_ERROR = auto()