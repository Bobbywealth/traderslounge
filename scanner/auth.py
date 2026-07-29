import os
import jwt
import bcrypt
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional, Tuple
from dataclasses import dataclass

SECRET_KEY = os.environ.get('JWT_SECRET', secrets.token_hex(32))
ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24
REFRESH_TOKEN_EXPIRE_DAYS = 7

@dataclass
class User:
    id: int
    email: str
    name: str
    role: str
    plan: str
    created_at: str

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())

def create_access_token(user: User) -> str:
    payload = {
        'sub': str(user.id),
        'email': user.email,
        'role': user.role,
        'plan': user.plan,
        'exp': datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        'iat': datetime.now(timezone.utc),
        'type': 'access'
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def create_refresh_token(user: User) -> str:
    payload = {
        'sub': str(user.id),
        'exp': datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
        'iat': datetime.now(timezone.utc),
        'type': 'refresh'
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def get_current_user(authorization: str) -> Optional[User]:
    if not authorization.startswith('Bearer '):
        return None
    token = authorization[7:]
    payload = decode_token(token)
    if not payload:
        return None
    if payload.get('type') != 'access':
        return None
    return User(
        id=int(payload['sub']),
        email=payload['email'],
        name='',
        role=payload['role'],
        plan=payload['plan'],
        created_at=''
    )
