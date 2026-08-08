import logging
import sys
import json
import time
import secrets
import contextvars
from datetime import datetime, timezone
from typing import Any, Optional

# Async-safe context variables for request tracing
_request_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar('request_id', default=None)
_user_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar('user_id', default=None)
_environment_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar('environment', default=None)
_application_version_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar('application_version', default=None)

class StructuredFormatter(logging.Formatter):
    """JSON structured log formatter with correlation ID support."""
    
    def __init__(self, environment: str = None, application_version: str = None):
        super().__init__()
        self._environment = environment
        self._application_version = application_version
    
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
        }
        
        # Add correlation IDs from context
        request_id = _request_id_var.get()
        if request_id:
            log_data['request_id'] = request_id
        
        user_id = _user_id_var.get()
        if user_id:
            log_data['user_id'] = user_id
        
        # Add environment context
        environment = _environment_var.get() or self._environment
        if environment:
            log_data['environment'] = environment
        
        app_version = _application_version_var.get() or self._application_version
        if app_version:
            log_data['application_version'] = app_version
        
        # Add exception info if present
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        
        return json.dumps(log_data, default=str)

def setup_logging(level: str = 'INFO', environment: str = None, application_version: str = None):
    """Configure structured JSON logging.
    
    Args:
        level: Log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        environment: Deployment environment (development, staging, production)
        application_version: Current application version/commit
    """
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter(environment, application_version))
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    
    # Set environment context for all logs
    if environment:
        _environment_var.set(environment)
    if application_version:
        _application_version_var.set(application_version)
    
    # Suppress noisy third-party loggers
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('requests').setLevel(logging.WARNING)
    logging.getLogger('psycopg').setLevel(logging.WARNING)

def generate_request_id() -> str:
    """Generate a unique request ID for correlation."""
    return f"{int(time.time()*1000)}-{secrets.token_hex(4)}"

def set_request_context(request_id: str = None, user_id: str = None):
    """Set request context for the current execution.
    
    Uses contextvars for async-safe context propagation.
    """
    if request_id is None:
        request_id = generate_request_id()
    _request_id_var.set(request_id)
    if user_id is not None:
        _user_id_var.set(str(user_id))
    return request_id

def get_request_id() -> Optional[str]:
    """Get the current request ID from context."""
    return _request_id_var.get()

def get_user_id() -> Optional[str]:
    """Get the current user ID from context."""
    return _user_id_var.get()

def clear_request_context():
    """Clear request context (call at end of request)."""
    _request_id_var.set(None)
    _user_id_var.set(None)

class RequestContext:
    """Context manager for request-scoped logging context."""
    
    def __init__(self, request_id: str = None, user_id: str = None):
        self.request_id = request_id or generate_request_id()
        self.user_id = user_id
        self._token_request = None
        self._token_user = None
    
    def __enter__(self):
        self._token_request = _request_id_var.set(self.request_id)
        if self.user_id:
            self._token_user = _user_id_var.set(str(self.user_id))
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self._token_request:
            _request_id_var.reset(self._token_request)
        if self._token_user:
            _user_id_var.reset(self._token_user)
        return False