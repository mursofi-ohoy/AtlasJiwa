import json

from psycopg.types.json import Json
from psycopg_pool import AsyncConnectionPool
from app.config import DATABASE_URL


db_pool = AsyncConnectionPool(
    conninfo=DATABASE_URL,
    min_size=2,
    max_size=10,
    open=False
)


async def test_database():
    async with db_pool.connection() as conn:
        result = await conn.execute("SELECT 1")
        return await result.fetchone()


# ---------------------------------------------------------------
# Agent sessions & messages (lihat sql/schema.sql -> agent_sessions,
# agent_messages). Dipakai backend/app/agent_api.py. Query gagal di
# sini TIDAK BOLEH menggagalkan balasan Qwen ke user -- pemanggil
# membungkus dengan try/except supaya riwayat gagal tersimpan bukan
# berarti user kehilangan jawabannya (lihat agent_api.py).
# ---------------------------------------------------------------

async def create_agent_session(user_id: str, screening_type: str | None, context: dict) -> str:
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


async def get_agent_session(session_id: str, user_id: str) -> dict | None:
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


async def touch_agent_session(session_id: str, is_crisis: bool) -> None:
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


async def insert_agent_message(
    session_id: str,
    user_id: str,
    role: str,
    content: str,
    nlp_context: dict | None,
    risk_percent: float | None,
    is_crisis: bool,
) -> None:
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


async def get_recent_messages(session_id: str, limit: int = 8) -> list[dict]:
    """Ambil `limit` pesan TERAKHIR (urut lama->baru untuk dipakai
    langsung sebagai histori prompt), dipakai prompt_builder.py supaya
    Qwen tetap punya konteks percakapan tanpa mengirim seluruh histori
    (hemat token, cukup untuk continuity jangka pendek)."""
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