"""Output Naming Module — data models.

OutputNameResult — result of a naming operation.
OutputNamingOptions — configuration for generating a name.
"""

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class OutputNameResult:
    """Result of an output naming operation.

    Attributes:
        output_path: Full output file path (directory + final_name).
        final_name: The generated file name (no directory).
        conflict: Whether a file already exists at output_path.
        will_overwrite: Whether the existing file will be overwritten.
        backup_path: Path to a backup copy of the existing file (if created).
        warnings: Human-readable warning messages.
    """
    output_path: str
    final_name: str
    conflict: bool = False
    will_overwrite: bool = False
    backup_path: Optional[str] = None
    warnings: List[str] = field(default_factory=list)


@dataclass
class OutputNamingOptions:
    """Configuration for output file name generation.

    Attributes:
        mode: "auto" | "custom"
        custom_name: Explicit file name (used when mode="custom").
        suffix: Suffix appended to base name (e.g. "_translated").
        prefix: Prefix prepended to base name (e.g. "ru_").
        include_lang: Include source and destination language codes.
        overwrite: Allow overwrite if file exists.
        backup: Create a backup before overwriting.
    """
    mode: str = "auto"
    custom_name: Optional[str] = None
    suffix: Optional[str] = None
    prefix: Optional[str] = None
    include_lang: bool = False
    overwrite: bool = False
    backup: bool = True
