from typing import Dict, List, Optional

from translator_app.file_processing.detectors.base import FileDetector
from translator_app.file_processing.parsers.base import FileParser
from translator_app.file_processing.serializers.base import FileSerializer
from translator_app.file_processing.validators.base import FileValidator
from translator_app.file_processing.models.file_type import FileCategory


class FileProcessingRegistry:
    """Registry for file detectors, parsers, serializers, and validators."""

    def __init__(self):
        self._detectors: Dict[str, FileDetector] = {}
        self._parsers: Dict[str, FileParser] = {}
        self._serializers: Dict[str, FileSerializer] = {}
        self._validators: Dict[str, FileValidator] = {}

    def register_detector(self, name: str, detector: FileDetector) -> None:
        self._detectors[name] = detector

    def register_parser(self, name: str, parser: FileParser) -> None:
        self._parsers[name] = parser

    def register_serializer(self, name: str, serializer: FileSerializer) -> None:
        self._serializers[name] = serializer

    def register_validator(self, name: str, validator: FileValidator) -> None:
        self._validators[name] = validator

    def get_detector(self, name: str) -> Optional[FileDetector]:
        return self._detectors.get(name)

    def get_parser(self, name: str) -> Optional[FileParser]:
        return self._parsers.get(name)

    def get_serializer(self, name: str) -> Optional[FileSerializer]:
        return self._serializers.get(name)

    def get_validator(self, name: str) -> Optional[FileValidator]:
        return self._validators.get(name)

    @property
    def detector_names(self) -> list:
        return list(self._detectors.keys())

    @property
    def parser_names(self) -> list:
        return list(self._parsers.keys())

    @property
    def serializer_names(self) -> list:
        return list(self._serializers.keys())

    @property
    def validator_names(self) -> list:
        return list(self._validators.keys())

    def list_registered_file_types(self) -> List[str]:
        """Return list of registered file type names (union of all handler keys)."""
        all_keys = set(self._detectors.keys()) | set(self._parsers.keys()) | set(self._serializers.keys()) | set(self._validators.keys())
        return sorted(all_keys)

    def get_detector_for_file_type(self, file_type_name: str) -> Optional[FileDetector]:
        """Get detector by file type category name."""
        return self._detectors.get(file_type_name)

    def get_parser_for_file_type(self, file_type_name: str) -> Optional[FileParser]:
        """Get parser by file type category name."""
        return self._parsers.get(file_type_name)

    def get_serializer_for_file_type(self, file_type_name: str) -> Optional[FileSerializer]:
        """Get serializer by file type category name."""
        return self._serializers.get(file_type_name)

    def get_validator_for_file_type(self, file_type_name: str) -> Optional[FileValidator]:
        """Get validator by file type category name."""
        return self._validators.get(file_type_name)


_default_registry = FileProcessingRegistry()


def get_default_registry() -> FileProcessingRegistry:
    return _default_registry
