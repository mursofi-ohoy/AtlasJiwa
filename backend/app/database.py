"""
ATLAS JIWA — Database Helpers (backend/app/database.py)

PERBAIKAN PENTING: modul ini sekarang OPSIONAL sepenuhnya.

Kalau DATABASE_URL kosong, atau koneksi ke PostgreSQL/CockroachDB
gagal saat startup (lihat app/main.py), SEMUA fungsi di bawah gagal
DENGAN AMAN (fallback) alih-alih melempar exception yang menjatuhkan
endpoint AI:

- create_agent_session() tetap mengembalikan session_id (dibuat lokal
  dengan uuid4 kalau DB mati), supaya alur chat tetap dapat ID sesi
  yang valid untuk dipakai di request berikutnya.
- get_agent_session() / get_recent_messages() mengembalikan None /
  list kosong kalau DB mati -- agent_api.py lalu memperlakukan
  percakapan sebagai stateless (tanpa histori) alih-alih error.
- touch_agent_session() / insert_agent_message() diam-diam no-op
  kalau DB mati.

Efeknya: TANPA database, "Agent Memory" (riwayat percakapan tersimpan
lintas sesi) tidak aktif, tapi endpoint konsultasi Qwen tetap 100%
berfungsi. DENGAN database (DATABASE_URL valid & bisa dihubungi, dan
app/main.py berhasil membuka pool-nya saat startup), semuanya bekerja
persis seperti sebelumnya -- riwayat tetap tersimpan.

Modul lain (app/main.py) yang bertanggung jawab men-set DB_AVAILABLE
= True, HANYA setelah open() pool + query tes sungguh-sungguh sukses.
"""

import logging
import uuid as uuid_lib

from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool

from app.config import DATABASE_URL

logger = logging.getLogger("atlasjiwa")

# Diset True oleh app/main.py (lifespan) setelah open() + test query
# sukses. Semua fungsi di bawah membaca flag ini sebelum menyentuh
# db_pool sama sekali -- kalau False, db_pool bisa saja None/belum
# terbuka dan TIDAK BOLEH dipakai.
DB_AVAILABLE = False

db_pool: AsyncConnectionPool | None = None

if DATABASE_URL:
    db_pool = AsyncConnectionPool(
        conninfo=DATABASE_URL,
        min_size=1,
        max_size=10,
        open=False,
    )
else:
    logger.warning(
        "[DATABASE] DATABASE_URL tidak diisi -- Agent Memory dinonaktifkan "
        "dari awal. Backend tetap berjalan tanpa PostgreSQL/CockroachDB; "
        "fitur konsultasi Qwen tidak terpengaruh."
    )


async def test_database():
    """Dipanggil app/main.py saat startup untuk memverifikasi koneksi
    benar-benar hidup, bukan cuma pool-nya ke-construct."""
    async with db_pool.connection() as conn:
        result = await conn.execute("SELECT 1")
        return await result.fetchone()


# ---------------------------------------------------------------
# Agent sessions & messages (lihat sql/schema.sql -> agent_sessions,
# agent_messages). Dipakai backend/app/agent_api.py.
# ---------------------------------------------------------------

async def create_agent_session(user_id: str, screening_type: str | None, context: dict) -> str:
    if not DB_AVAILABLE:
        return str(uuid_lib.uuid4())
    try:
        async with db_pool.connection() as conn:
            result = await conn.execute(
                """
                INSERT INTO agent_sessions
                    (user_id, screening_type, overall_context_theme,
                     overall_context_risk_percent, overall_context)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    user_id,
                    screening_type,
                    context.get("theme"),
                    context.get("composite_risk_percent"),
                    Json(context),
                ),
            )
            row = await result.fetchone()
            return str(row[0])
    except Exception as exc:  # pragma: no cover - kegagalan infra
        logger.warning("[DATABASE] Gagal membuat agent_session, fallback ke ID lokal: %s", exc)
        return str(uuid_lib.uuid4())


async def get_agent_session(session_id: str, user_id: str) -> dict | None:
    if not DB_AVAILABLE:
        return None
    try:
        async with db_pool.connection() as conn:
            result = await conn.execute(
                """
                SELECT id, user_id, screening_type, overall_context_theme,
                       overall_context_risk_percent, overall_context, is_crisis
                FROM agent_sessions
                WHERE id = %s AND user_id = %s
                """,
                (session_id, user_id),
            )
            row = await result.fetchone()
            if not row:
                return None
            return {
                "id": str(row[0]),
                "user_id": str(row[1]),
                "screening_type": row[2],
                "overall_context_theme": row[3],
                "overall_context_risk_percent": float(row[4]) if row[4] is not None else None,
                "overall_context": row[5],
                "is_crisis": row[6],
            }
    except Exception as exc:  # pragma: no cover
        logger.warning("[DATABASE] Gagal mengambil agent_session: %s", exc)
        return None


async def touch_agent_session(session_id: str, is_crisis: bool) -> None:
    if not DB_AVAILABLE:
        return
    try:
        async with db_pool.connection() as conn:
            await conn.execute(
                """
                UPDATE agent_sessions
                SET last_message_at = now(),
                    is_crisis = is_crisis OR %s
                WHERE id = %s
                """,
                (is_crisis, session_id),
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("[DATABASE] Gagal update agent_session: %s", exc)


async def insert_agent_message(
    session_id: str,
    user_id: str,
    role: str,
    content: str,
    nlp_context: dict | None,
    risk_percent: float | None,
    is_crisis: bool,
) -> None:
    if not DB_AVAILABLE:
        return
    try:
        async with db_pool.connection() as conn:
            await conn.execute(
                """
                INSERT INTO agent_messages
                    (session_id, user_id, role, content, nlp_context, risk_percent, is_crisis)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    session_id,
                    user_id,
                    role,
                    content,
                    Json(nlp_context) if nlp_context is not None else None,
                    risk_percent,
                    is_crisis,
                ),
            )
    except Exception as exc:  # pragma: no cover
        logger.warning("[DATABASE] Gagal menyimpan agent_message: %s", exc)


async def get_recent_messages(session_id: str, limit: int = 8) -> list[dict]:
    """Ambil `limit` pesan TERAKHIR (urut lama->baru untuk dipakai
    langsung sebagai histori prompt), dipakai prompt_builder.py supaya
    Qwen tetap punya konteks percakapan tanpa mengirim seluruh histori
    (hemat token, cukup untuk continuity jangka pendek)."""
    if not DB_AVAILABLE:
        return []
    try:
        async with db_pool.connection() as conn:
            result = await conn.execute(
                """
                SELECT role, content
                FROM agent_messages
                WHERE session_id = %s
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (session_id, limit),
            )
            rows = await result.fetchall()
            rows.reverse()
            return [{"role": r[0], "content": r[1]} for r in rows]
    except Exception as exc:  # pragma: no cover
        logger.warning("[DATABASE] Gagal mengambil histori pesan: %s", exc)
        return []
