"""Service layer for translated output files."""

import logging
from typing import Dict, List, Optional

from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.outputs.models import OutputFilesTree, TranslatedOutputFile
from translator_app.outputs.repository import TranslatedOutputFileRepository
from translator_app.outputs.scanner import (
    TranslatedOutputScanRequest,
    TranslatedOutputScanResult,
    TranslatedOutputScanner,
)

logger = logging.getLogger(__name__)


class TranslatedOutputFileService:
    """Business logic for translated output files."""

    def __init__(
        self,
        repository: TranslatedOutputFileRepository,
        scanner: Optional[TranslatedOutputScanner] = None,
    ):
        self._repo = repository
        self._scanner = scanner

    def list_files(
        self,
        job_id: Optional[str] = None,
        mod_id: Optional[str] = None,
        group_key: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[TranslatedOutputFile]:
        """List output files with filters and pagination.

        Raises ``APIError`` for invalid pagination parameters.
        """
        if limit < 1:
            raise APIError(
                code="INVALID_REQUEST",
                message="limit must be >= 1",
                status_code=400,
            )
        if limit > 1000:
            limit = 1000
        if offset < 0:
            raise APIError(
                code="INVALID_REQUEST",
                message="offset must be >= 0",
                status_code=400,
            )

        return self._repo.list_files(
            job_id=job_id,
            mod_id=mod_id,
            group_key=group_key,
            status=status,
            q=q,
            limit=limit,
            offset=offset,
        )

    def count_files(
        self,
        job_id: Optional[str] = None,
        mod_id: Optional[str] = None,
        group_key: Optional[str] = None,
        status: Optional[str] = None,
        q: Optional[str] = None,
    ) -> int:
        """Count output files matching the given filters."""
        return self._repo.count_files(
            job_id=job_id,
            mod_id=mod_id,
            group_key=group_key,
            status=status,
            q=q,
        )

    def get_file(self, output_file_id: str) -> TranslatedOutputFile:
        """Get a single output file by id.

        Raises ``APIError`` with 404 if not found.
        """
        file = self._repo.get_by_id(output_file_id)
        if not file:
            raise APIError(
                code=NOT_FOUND,
                message=f"Output file not found: {output_file_id}",
                status_code=404,
            )
        return file

    def get_tree(self, job_id: Optional[str] = None) -> OutputFilesTree:
        """Build the output files tree."""
        return self._repo.build_tree(job_id=job_id)

    def get_summary_for_job(self, job_id: str) -> dict:
        """Get summary statistics for a job's output files.

        Returns counts for: files, mods, groups, and analysis statuses.
        """
        return self._repo.get_job_summary(job_id)

    def reindex_job_outputs(
        self, job_id: str, force: bool = False
    ) -> TranslatedOutputScanResult:
        """Reindex translated output files for a job.

        Uses the scanner to walk the job's output directory and upsert
        ``TranslatedOutputFile`` records via the repository.

        Args:
            job_id: The job to scan.
            force: If True, reindex even if the job is not completed.

        Returns:
            A ``TranslatedOutputScanResult`` with counts and diagnostics.

        Raises:
            APIError: If no scanner is configured.
        """
        if self._scanner is None:
            raise APIError(
                code="SCANNER_NOT_CONFIGURED",
                message="Output file scanner is not configured",
                status_code=500,
            )

        request = TranslatedOutputScanRequest(
            job_id=job_id,
            force=force,
            job_scoped=True,
        )

        return self._scanner.scan_job_outputs(request)
