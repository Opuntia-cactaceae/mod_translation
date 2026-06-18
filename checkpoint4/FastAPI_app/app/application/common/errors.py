class AppError(Exception):
    pass

class ValidationError(AppError):
    pass

class NotFound(AppError):
    pass

class AuthError(AppError):
    pass

class InvalidCredentials(AuthError):
    pass

class Forbidden(AuthError):
    pass

class GatewayError(AppError):
    pass

class GatewayTimeout(GatewayError):
    pass

class GatewayUnavailable(GatewayError):
    pass
