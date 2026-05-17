import json
import os
import tempfile
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from translator_app.secrets.models import ApiKeyRecord


class SecretsService:
    """In-memory API key store with optional JSON persistence.

    * Keys are indexed by ``id`` (UUID hex string).
    * Raw ``value`` is accessible in-process via ``get_key()``.
    * External callers MUST use ``list_keys()`` which returns records
      whose ``__repr__`` / ``masked_value`` never leak the raw value.
    * JSON persistence uses atomic writes (temp file + rename).
    * Corrupted files are backed up before falling back to empty store.
    """

    def __init__(self, store_path: Optional[str] = None):
        # Respect env override for test isolation, otherwise use passed path
        self._store_path = store_path or os.environ.get("TRANSLATOR_APP_SECRETS_PATH")
        self._keys: Dict[str, ApiKeyRecord] = {}
        if self._store_path:
            self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def add_key(
        self,
        provider: str,
        label: str = "",
        value: str = "",
        save: bool = True,
    ) -> ApiKeyRecord:
        """Add a new API key and return the created record."""
        record = ApiKeyRecord(
            provider=provider,
            label=label or provider,
            value=value,
            created_at=datetime.now(),
        )
        self._keys[record.id] = record
        if save:
            self._save()
        return record

    def delete_key(self, key_id: str) -> bool:
        """Remove a key by id. Returns True if the key existed."""
        removed = self._keys.pop(key_id, None) is not None
        if removed:
            self._save()
        return removed

    def list_keys(self) -> List[ApiKeyRecord]:
        """Return all stored keys (safe for external use — raw value is
        accessible but masked property is the public face)."""
        # Return a list — the caller gets ApiKeyRecord objects whose
        # __repr__ and masked_value are safe.  The .value attribute
        # is available but is an explicit programming choice to access.
        return list(self._keys.values())

    def get_key(self, key_id: str) -> Optional[ApiKeyRecord]:
        """Retrieve a key by id.  Returns the raw record (value visible
        in-process).  Intended for runtime layer, NOT for API responses."""
        return self._keys.get(key_id)

    def update_key_label(self, key_id: str, label: str) -> Optional[ApiKeyRecord]:
        """Update the label of an existing key."""
        record = self._keys.get(key_id)
        if record is None:
            return None
        record.label = label
        self._save()
        return record

    def mark_used(self, key_id: str) -> Optional[ApiKeyRecord]:
        """Mark a key as used (update ``last_used_at``)."""
        record = self._keys.get(key_id)
        if record is None:
            return None
        record.last_used_at = datetime.now()
        self._save()
        return record

    def clear(self) -> None:
        """Remove all stored keys."""
        self._keys.clear()
        self._save()

    def get_all_raw_keys(self) -> List[str]:
        """Return all raw key values (for log sanitisation)."""
        return [rec.value for rec in self._keys.values()]

    # ------------------------------------------------------------------
    # Backward-compatible aliases
    # ------------------------------------------------------------------

    def add(self, record: ApiKeyRecord) -> None:
        """Legacy alias — adds a pre-built record."""
        if record.created_at is None:
            record.created_at = datetime.now()
        # Ensure the record has a label
        if not record.label:
            record.label = record.name if hasattr(record, "name") else record.provider
        self._keys[record.id] = record
        self._save()

    def get(self, name: str) -> Optional[ApiKeyRecord]:
        """Legacy alias — get by name (label) instead of id."""
        for rec in self._keys.values():
            if rec.label == name:
                return rec
        return None

    def remove(self, name: str) -> bool:
        """Legacy alias — remove by name (label)."""
        for key_id, rec in list(self._keys.items()):
            if rec.label == name:
                del self._keys[key_id]
                self._save()
                return True
        return False

    def list_names(self) -> list:
        """Legacy alias — return all labels."""
        return [rec.label for rec in self._keys.values()]

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def _serialize(self) -> dict:
        return {
            rec.id: {
                "id": rec.id,
                "provider": rec.provider,
                "label": rec.label,
                "value": rec.value,
                "created_at": rec.created_at.isoformat() if rec.created_at else None,
                "last_used_at": rec.last_used_at.isoformat() if rec.last_used_at else None,
                "is_active": rec.is_active,
            }
            for rec in self._keys.values()
        }

    @staticmethod
    def _deserialize_item(item: dict) -> ApiKeyRecord:
        created = item.get("created_at")
        if created:
            created = datetime.fromisoformat(created)
        last_used = item.get("last_used_at")
        if last_used:
            last_used = datetime.fromisoformat(last_used)
        # Support legacy format where name/key were used
        label = item.get("label", item.get("name", ""))
        value = item.get("value", item.get("key", ""))
        return ApiKeyRecord(
            id=item.get("id", ""),
            provider=item.get("provider", ""),
            label=label,
            value=value,
            created_at=created,
            last_used_at=last_used,
            is_active=item.get("is_active", True),
        )

    def _load(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            for item in data.values():
                rec = self._deserialize_item(item)
                self._keys[rec.id] = rec
        except (json.JSONDecodeError, TypeError, KeyError) as exc:
            # Backup corrupted file
            self._backup_corrupted(str(path))
            self._keys.clear()

    def _save(self) -> None:
        if not self._store_path:
            return
        path = Path(self._store_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        data = self._serialize()
        content = json.dumps(data, indent=2, ensure_ascii=False)

        # Atomic write via temp file + rename
        fd, tmp_path = tempfile.mkstemp(
            suffix=".tmp",
            prefix="secrets_",
            dir=str(path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(content)
            os.replace(tmp_path, str(path))
        except Exception:
            # Cleanup temp file on failure
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            raise

    def _backup_corrupted(self, file_path: str) -> None:
        """Rename a corrupted file so data is not lost."""
        path = Path(file_path)
        if path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{path.name}.corrupt.{timestamp}"
            backup_path = path.with_name(backup_name)
            shutil.copy2(str(path), str(backup_path))
