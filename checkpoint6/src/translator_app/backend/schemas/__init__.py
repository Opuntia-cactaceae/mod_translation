"""Backend API schemas - Pydantic models for request/response."""

from translator_app.backend.schemas.common import (
    HealthResponse,
    AppStateResponse,
    ErrorDetail,
    ErrorResponse,
)
from translator_app.backend.schemas.settings import (
    SettingsResponse,
    SettingsUpdateRequest,
    ValidatePathRequest,
    ValidatePathResponse,
)
from translator_app.backend.schemas.files import (
    FileInfo,
    FileListResponse,
    FileListRequest,
    FileReadRequest,
    FileReadResponse,
    PreviewOutputPathRequest,
    PreviewOutputPathResponse,
)
from translator_app.backend.schemas.jobs import (
    JobResponse,
    JobSummaryResponse,
    CreateJobRequest,
    JobActionResponse,
)
from translator_app.backend.schemas.translation import (
    TranslationOptionsResponse,
    ValidateConfigRequest,
    ValidateConfigResponse,
    PreviewConfigRequest,
    PreviewConfigResponse,
)
from translator_app.backend.schemas.cache import (
    CacheStatsResponse,
    CacheClearResponse,
)
from translator_app.backend.schemas.install import (
    InstallRequestSchema,
    InstallResultSchema,
    InstallPreviewSchema,
)
from translator_app.backend.schemas.stellaris_cache import (
    StellarisCacheItemSchema,
    StellarisCachePreviewResponse,
    StellarisCacheCleanRequest,
    StellarisCacheCleanResponse,
)
from translator_app.backend.schemas.import_export import (
    ExportRequestSchema,
    ExportResultSchema,
    ImportRequestSchema,
    ImportExportResultSchema,
    PreviewImportResponse,
    DiagnosticSchema,
)
from translator_app.backend.schemas.system import (
    PathInfoRequest,
    PathInfoResponse,
    ListDirectoryRequest,
    ListDirectoryResponse,
    DirectoryItem,
    HomeResponse,
)
from translator_app.backend.schemas.games import (
    FileHandlerOptionSchema,
    GameOptionSchema,
    GamesOptionsResponse,
)
from translator_app.backend.schemas.output_files import (
    OutputFileResponse,
    OutputFileListResponse,
    OutputFileTreeResponse,
    OutputFileAnalysisSummaryResponse,
    OutputFilesSummaryResponse,
    ScanDiagnosticResponse,
    OutputReindexRequest,
    OutputScanResultResponse,
    FileContentsResponse,
)
from translator_app.backend.schemas.provider_models import (
    ProviderModelEntry,
    CreateProviderModelRequest,
    UpdateProviderModelRequest,
    ProviderLink,
    ProviderGroup,
    ProviderModelsResponse,
    ResetDefaultsResponse,
)

__all__ = [
    # common
    "HealthResponse", "AppStateResponse", "ErrorDetail", "ErrorResponse",
    # settings
    "SettingsResponse", "SettingsUpdateRequest", "ValidatePathRequest", "ValidatePathResponse",
    # files
    "FileInfo", "FileListResponse", "FileListRequest", "FileReadRequest",
    "FileReadResponse", "PreviewOutputPathRequest", "PreviewOutputPathResponse",
    # jobs
    "JobResponse", "JobSummaryResponse", "CreateJobRequest", "JobActionResponse",
    # translation
    "TranslationOptionsResponse", "ValidateConfigRequest", "ValidateConfigResponse",
    "PreviewConfigRequest", "PreviewConfigResponse",
    # cache
    "CacheStatsResponse", "CacheClearResponse",
    # install
    "InstallRequestSchema", "InstallResultSchema", "InstallPreviewSchema",
    # stellaris-cache
    "StellarisCacheItemSchema", "StellarisCachePreviewResponse",
    "StellarisCacheCleanRequest", "StellarisCacheCleanResponse",
    # import-export
    "ExportRequestSchema", "ExportResultSchema",
    "ImportRequestSchema", "ImportExportResultSchema",
    "PreviewImportResponse", "DiagnosticSchema",
    # system
    "PathInfoRequest", "PathInfoResponse",
    "ListDirectoryRequest", "ListDirectoryResponse",
    "DirectoryItem", "HomeResponse",
    # games
    "FileHandlerOptionSchema", "GameOptionSchema", "GamesOptionsResponse",
    # output-files
    "OutputFileResponse", "OutputFileListResponse", "OutputFileTreeResponse",
    "OutputFileAnalysisSummaryResponse", "OutputFilesSummaryResponse",
    "ScanDiagnosticResponse", "OutputReindexRequest", "OutputScanResultResponse",
    "FileContentsResponse",
    # provider-models
    "ProviderModelEntry", "CreateProviderModelRequest", "UpdateProviderModelRequest",
    "ProviderLink", "ProviderGroup", "ProviderModelsResponse", "ResetDefaultsResponse",
]
