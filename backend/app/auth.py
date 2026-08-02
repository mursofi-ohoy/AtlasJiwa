"""
Verifikasi identitas untuk FastAPI.

PENTING: FastAPI TIDAK punya sistem login sendiri. Node
(server/auth.js) tetap satu-satunya tempat user login & JWT
diterbitkan (disimpan browser sebagai cookie httpOnly `atlas_session`,
lihat server/middleware.js). FastAPI hanya memverifikasi ULANG token
yang sama, memakai secret yang sama (JWT_SECRET di .env, wajib
identik di kedua sisi) -- ini mempertahankan arsitektur auth yang
sudah ada, bukan membuat sistem baru.

Karena browser tidak pernah bicara langsung ke FastAPI (lihat
server/routes/agent.routes.js -- Node yang jadi proxy), token
dikirim sebagai header `Authorization: Bearer <token>` oleh Node,
bukan lewat cookie.
"""

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError

from app.config import JWT_SECRET, JWT_ALGORITHM

security = HTTPBearer()


class CurrentUser:
    def __init__(self, id: str, username: str | None = None, role: str | None = None):
        self.id = id
        self.username = username
        self.role = role


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> CurrentUser:
    token = credentials.credentials

    if not JWT_SECRET:
        # Fail closed, bukan fail open -- jangan sampai backend jalan
        # tanpa secret lalu diam-diam menerima token apa saja.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="JWT_SECRET belum dikonfigurasi di backend."
        )

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak valid atau sudah kedaluwarsa."
        )

    user_id = payload.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token tidak memuat identitas pengguna."
        )

    return CurrentUser(
        id=user_id,
        username=payload.get("username"),
        role=payload.get("role"),
    )
