"""translator_app - Local web application package for translating Stellaris mods."""

from translator_app.file_processing.registry import get_default_registry
from translator_app.file_processing.detectors.plain_text import PlainTextDetector
from translator_app.file_processing.detectors.stellaris_localisation import StellarisLocalisationDetector
from translator_app.file_processing.parsers.plain_text import PlainTextParser
from translator_app.file_processing.parsers.stellaris_localisation import StellarisLocalisationParser
from translator_app.file_processing.serializers.plain_text import PlainTextSerializer
from translator_app.file_processing.serializers.stellaris_localisation import StellarisLocalisationSerializer
from translator_app.file_processing.validators.stellaris_localisation import StellarisLocalisationValidator
from translator_app.file_processing.validators.plain_text import PlainTextValidator

_registry = get_default_registry()
_registry.register_detector("plain_text", PlainTextDetector())
_registry.register_detector("stellaris_localisation", StellarisLocalisationDetector())
_registry.register_parser("plain_text", PlainTextParser())
_registry.register_parser("stellaris_localisation", StellarisLocalisationParser())
_registry.register_serializer("plain_text", PlainTextSerializer())
_registry.register_serializer("stellaris_localisation", StellarisLocalisationSerializer())
_registry.register_validator("stellaris_localisation", StellarisLocalisationValidator())
_registry.register_validator("plain_text", PlainTextValidator())

__all__ = []
