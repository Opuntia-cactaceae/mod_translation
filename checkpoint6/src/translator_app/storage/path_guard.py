"""Runtime guard to prevent pytest from touching production storage paths.

This module is a safety net.  It works at two levels:

1. **Environment-var guard** (``paths.py`` internal) — every path resolved
   via ``get_storage_paths()`` is checked: if ``PYTEST_CURRENT_TEST`` is
   active and the resolved path is not inside ``TRANSLATOR_APP_DATA_DIR``,
   a ``RuntimeError`` is raised.

2. **Explicit check function** — use ``check_path_safe()`` anywhere you
   programmatically build a path that might touch production data, and
   ``running_under_pytest()`` to skip destructive operations in tests.

Usage in production code::

    from translator_app.storage.path_guard import check_path_safe, running_under_pytest

    if not running_under_pytest():
        shutil.rmtree(some_path)  # only run in production

    check_path_safe("/some/path")  # raises RuntimeError in pytest if unsafe
"""

import os
from pathlib import Path
from typing import Optional


def running_under_pytest() -> bool:
    """Return True if the current process is running under pytest."""
    return bool(os.environ.get("PYTEST_CURRENT_TEST"))


def get_pytest_tmp_dir() -> Optional[str]:
    """Return the pytest tmp dir from the environment, if available.

    This is a best-effort heuristic based on env vars set by conftest.
    """
    # The most reliable indicator: TRANSLATOR_APP_DATA_DIR is set by conftest
    data_dir = os.environ.get("TRANSLATOR_APP_DATA_DIR")
    if data_dir:
        return data_dir

    # Fallback: look for any TRANSLATOR_APP_* env var that points to tmp
    for key, value in os.environ.items():
        if key.startswith("TRANSLATOR_APP_") and "pytest" in value.lower():
            return str(Path(value).parent)

    return None


def check_path_safe(path: str, label: str = "path") -> None:
    """Check that *path* is safe to access under pytest.

    If we are running under pytest and the path is NOT inside the test
    data directory (``TRANSLATOR_APP_DATA_DIR``), raise ``RuntimeError``.

    Parameters
    ----------
    path:
        The file system path to check.
    label:
        A human-readable label for error messages (e.g. ``"output dir"``).

    Raises
    ------
    RuntimeError
        If running under pytest and *path* is outside the permitted area.
    """
    if not running_under_pytest():
        return

    test_dir = get_pytest_tmp_dir()
    if test_dir is None:
        raise RuntimeError(
            f"Cannot verify safety of {label} ``{path}``: "
            f"no test data dir is configured. "
            f"Set TRANSLATOR_APP_DATA_DIR in your conftest.py."
        )

    resolved = Path(path).resolve()
    test_path = Path(test_dir).resolve()

    try:
        resolved.relative_to(test_path)
    except ValueError:
        raise RuntimeError(
            f"Test attempted to access {label} outside the test data dir!\n"
            f"  {label}: {resolved}\n"
            f"  Test data dir: {test_path}\n"
            f"Refusing to touch this location during testing."
        )


MONKEYPATCH_PROTECTED_ATTRS = [
    # Prevent tests from accidentally clearing the env var
    ("os.environ", "TRANSLATOR_APP_DATA_DIR"),
]


def assert_all_env_vars_are_set(expected_vars: list[str]) -> None:
    """Assert that all expected env vars are set.

    Useful in conftest.py to verify that the isolation fixture has
    configured everything.
    """
    missing = [v for v in expected_vars if v not in os.environ]
    if missing:
        raise AssertionError(
            f"Missing environment variables required for test isolation:\n"
            f"  {missing}\n"
            f"Ensure the conftest.py autouse fixture sets every "
            f"TRANSLATOR_APP_* variable."
        )
