from fastapi import FastAPI
from app.api.routers import auth, translate, history, meta, admin
from app.api.middlewares.correlation_id import CorrelationIdMiddleware
from app.api.middlewares.exception_mapper import ExceptionMapperMiddleware
from app.api.middlewares.ratelimit import RateLimitMiddleware
from app.settings import validate_production_settings

def create_app() -> FastAPI:
    validate_production_settings()

    app = FastAPI(title="Переводчик модов")

    # middlewares
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(ExceptionMapperMiddleware)
    app.add_middleware(RateLimitMiddleware)

    # routers
    app.include_router(auth.router, prefix="/auth", tags=["auth"])
    app.include_router(translate.router, prefix="/translate", tags=["translate"])
    app.include_router(history.router, prefix="/history", tags=["history"])
    app.include_router(meta.router, prefix="/meta", tags=["meta"])
    app.include_router(admin.router, prefix="/admin", tags=["admin"])

    return app

app = create_app()
