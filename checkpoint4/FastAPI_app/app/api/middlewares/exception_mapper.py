from __future__ import annotations

import logging

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.application.common.errors import (
    AppError,
    AuthError,
    ValidationError,
    NotFound,
    GatewayTimeout,
    GatewayUnavailable,
)

logger = logging.getLogger(__name__)


class ExceptionMapperMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)

        except GatewayTimeout as e:
            return JSONResponse({"detail": str(e)}, status_code=504)

        except GatewayUnavailable as e:
            return JSONResponse({"detail": str(e)}, status_code=503)

        except ValidationError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)

        except AuthError as e:
            return JSONResponse({"detail": str(e)}, status_code=401)

        except NotFound as e:
            return JSONResponse({"detail": str(e)}, status_code=404)

        except AppError as e:
            return JSONResponse({"detail": str(e)}, status_code=400)

        except Exception:
            logger.exception("Unhandled exception")
            return JSONResponse(
                {"detail": "Internal server error"},
                status_code=500,
            )