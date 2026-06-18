"""API endpoints for managing API keys."""

import socket

from fastapi import APIRouter, Depends

from translator_app.backend.deps import Services, get_services
from translator_app.backend.errors import APIError, NOT_FOUND
from translator_app.backend.schemas.secrets import (
    ApiKeyResponse,
    ApiKeyCreateRequest,
    ApiKeyListResponse,
    DeleteKeyResponse,
    TestKeyRequest,
    TestKeyResponse,
)

router = APIRouter(tags=["secrets"])

_TEST_TIMEOUT_SEC = 10

# Providers that support real network test with their API endpoint details.
_PROVIDER_TEST_URLS: dict[str, dict] = {
    "groq": {
        "url": "https://api.groq.com/openai/v1/models",
        "auth_scheme": "Bearer",
    },
    "deepseek": {
        "url": "https://api.deepseek.com/models",
        "auth_scheme": "Bearer",
    },
}


def _to_response(record) -> ApiKeyResponse:
    """Convert an internal ApiKeyRecord to a public Pydantic response."""
    return ApiKeyResponse(
        id=record.id,
        provider=record.provider,
        label=record.label,
        masked_value=record.masked_value,
        created_at=record.created_at,
        last_used_at=record.last_used_at,
        is_active=record.is_active,
    )


@router.get("/api-keys", response_model=ApiKeyListResponse)
def list_api_keys(svcs: Services = Depends(get_services)):
    """List all stored API keys (values are masked)."""
    records = svcs.secrets.list_keys()
    keys = [_to_response(r) for r in records]
    return ApiKeyListResponse(keys=keys, total=len(keys))


@router.post("/api-keys", response_model=ApiKeyResponse, status_code=201)
def create_api_key(body: ApiKeyCreateRequest, svcs: Services = Depends(get_services)):
    """Store a new API key."""
    record = svcs.secrets.add_key(
        provider=body.provider,
        label=body.label,
        value=body.value,
    )
    return _to_response(record)


@router.delete("/api-keys/{key_id}", response_model=DeleteKeyResponse)
def delete_api_key(key_id: str, svcs: Services = Depends(get_services)):
    """Remove an API key by id."""
    deleted = svcs.secrets.delete_key(key_id)
    if not deleted:
        raise APIError(
            code=NOT_FOUND,
            message=f"API key not found: {key_id}",
            status_code=404,
        )
    return DeleteKeyResponse(deleted=True)


@router.post("/test-key", response_model=TestKeyResponse)
def test_api_key(body: TestKeyRequest, svcs: Services = Depends(get_services)):
    """Test an API key by making a real lightweight network call to the provider.

    Uses the provider's models/list endpoint (minimal token usage, short timeout).
    The key is never logged and is NOT saved automatically.
    """
    test_info = _PROVIDER_TEST_URLS.get(body.provider)
    if not test_info:
        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=False,
            message=f"Unknown or unsupported provider: {body.provider}",
        )

    import requests  # noqa: T100

    try:
        resp = requests.get(
            test_info["url"],
            headers={"Authorization": f"{test_info['auth_scheme']} {body.value}"},
            timeout=_TEST_TIMEOUT_SEC,
        )

        if resp.status_code == 200:
            return TestKeyResponse(
                valid=True,
                auth_ok=True,
                provider_reachable=True,
                message="Authentication succeeded",
            )

        if resp.status_code == 401:
            return TestKeyResponse(
                valid=False,
                auth_ok=False,
                provider_reachable=True,
                message="Authentication failed",
            )

        if resp.status_code == 429:
            return TestKeyResponse(
                valid=False,
                auth_ok=False,
                provider_reachable=True,
                message="Provider reachable, but rate limited",
            )

        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=True,
            message=f"Unexpected response: HTTP {resp.status_code}",
        )

    except requests.ConnectionError:
        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=False,
            message="Provider unreachable",
        )
    except requests.Timeout:
        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=False,
            message="Provider timeout",
        )
    except socket.gaierror:
        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=False,
            message="Provider unreachable (DNS resolution failed)",
        )
    except Exception as exc:
        return TestKeyResponse(
            valid=False,
            auth_ok=False,
            provider_reachable=False,
            message=f"Test failed: {type(exc).__name__}",
        )
