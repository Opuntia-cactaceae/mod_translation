from fastapi import APIRouter, Depends, Request
from app.api.schemas.auth import LoginIn, TokenPairOut, RegisterIn, RegisterOut
from app.application.auth.use_cases import LoginUser, RegisterUser
from app.api.deps import get_uow, get_password_hasher, get_jwt_service
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

bearer_scheme = HTTPBearer(auto_error=False)
router = APIRouter()

@router.post("/login", response_model=TokenPairOut)
async def login(payload: LoginIn, request: Request, uow=Depends(get_uow),
                hasher=Depends(get_password_hasher), jwt_service=Depends(get_jwt_service)):
    uc = LoginUser(uow=uow, hasher=hasher, jwt_service=jwt_service)
    return await uc.execute(
        email=payload.email,
        password=payload.password,
        ip=request.client.host if request.client else None,
        user_agent=request.headers.get("User-Agent"),
    )

@router.post("/register", response_model=RegisterOut)
async def register(
    payload: RegisterIn,
    uow=Depends(get_uow),
    password_hasher=Depends(get_password_hasher),
):
    print(password_hasher)
    uc = RegisterUser(uow=uow, password_hasher=password_hasher)
    user = await uc.execute(email=payload.email, password=payload.password)
    return RegisterOut(id=user.id, email=user.email)