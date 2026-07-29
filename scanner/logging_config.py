import logging
import sys
import json
import time
import secrets
from datetime import datetime, timezone
from typing import Any

class StructuredFormatter(logging.Formatter):
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
        if hasattr(record, 'request_id'):
            log_data['request_id'] = record.request_id
        if hasattr(record, 'user_id'):
            log_data['user_id'] = record.user_id
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        return json.dumps(log_data)

def setup_logging(level: str = 'INFO'):
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredFormatter())
    root_logger = logging.getLogger()
    root_logger.addHandler(handler)
    root_logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    
    logging.getLogger('urllib3').setLevel(logging.WARNING)
    logging.getLogger('requests').setLevel(logging.WARNING)

class RequestContext:
    _request_id = None
    _user_id = None
    
    @classmethod
    def set(cls, request_id: str = None, user_id: str = None):
        cls._request_id = request_id
        cls._user_id = user_id
    
    @classmethod
    def get_request_id(cls) -> str:
        if cls._request_id is None:
            cls._request_id = f"{int(time.time()*1000)}-{secrets.token_hex(4)}"
        return cls._request_id