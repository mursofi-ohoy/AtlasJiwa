"""
Endpoint agen konsultasi Atlas Jiwa AI.

Alur integrasi JS NLP -> FastAPI -> Qwen (Ollama):

1. POST /api/v1/agent/session/init
   Dipanggil SEKALI setelah user menyelesaikan screening. Body berisi
   ScreeningContext -- ringkasan dari window.AtlasSummaryEngine
   .buildOverallSummary() sisi klien (theme, axisTotals, compositeRisk,
   addictionComponents, dst). Membuat baris baru di agent_sessions,
   menjalankan risk_engine.assess_session_risk(), lalu meminta Qwen
   membuat pesan pembuka yang relevan dengan hasil screening tsb.

2. POST /api/v1/agent/consult
   Dipanggil setiap kali user mengirim pesan chat. Body berisi
   message + session_id + NarrativeContext opsional (hasil
   window.AtlasNLPEngine.analyzeQualitative(pesanIni) sisi klien).
   Mengambil histori singkat dari DB, menjalankan
   risk_engine.assess_message_risk(), menyusun prompt lewat
   prompt_builder.py, memanggil Qwen, lalu menyimpan pesan user +
   balasan asisten ke agent_messages.

Endpoint ini diakses lewat proxy Cloudflare Worker
(src/index.js -> handleAgentProxy), yang menyisipkan header
Authorization: Bearer <JWT> dari cookie sesi Worker -- lihat
app/auth.py. Browser tidak pernah bicara langsung ke FastAPI ini.

CATATAN AGENT MEMORY: semua fungsi di app/database.py sekarang gagal
dengan aman kalau PostgreSQL/CockroachDB tidak tersedia (lihat
DB_AVAILABLE di app/database.py) -- endpoint di bawah TIDAK PERLU lagi
membungkus create_agent_session()/dst dengan try/except untuk
mencegah 500, itu sudah ditangani di lapisan database.py. Yang masih
perlu ditangani di sini hanyalah kasus "session_id dikirim klien tapi
DB sedang mati": jangan balas 404 seolah sesi itu tidak pernah ada,
cukup lanjut secara stateless (tanpa histori/konteks tersimpan).
"""

from fastapi import APIRouter, Depends, HTTPException

from app.auth import get_current_user, CurrentUser
from app.models import ChatRequest, ChatResponse, SessionInitRequest
from app.ollama_client import ask_qwen_with_context, ask_qwen_opening
from app import database as db
from app import risk_engine

router = APIRouter(prefix="/api/v1/agent", tags=["agent"])


@router.post("/session/init", response_model=ChatResponse)
async def init_session(
    payload: SessionInitRequest,
    user: CurrentUser = Depends(get_current_user),
):
    context_dict = payload.context.model_dump()
    risk = risk_engine.assess_session_risk(context_dict)

    session_id = await db.create_agent_session(
        user_id=user.id,
        screening_type=payload.screening_type,
        context=context_dict,
    )

    opening_message = await ask_qwen_opening(context_dict, is_crisis=risk["is_crisis"])

    # Kegagalan menyimpan histori TIDAK menggagalkan respons ke user --
    # yang penting user tetap dapat balasan Qwen. (insert_agent_message
    # sendiri sudah no-op kalau DB mati, try/except ini jaga-jaga untuk
    # kegagalan lain yang tak terduga.)
    try:
        await db.insert_agent_message(
            session_id=session_id,
            user_id=user.id,
            role="assistant",
            content=opening_message,
            nlp_context=None,
            risk_percent=risk["risk_percent"],
            is_crisis=risk["is_crisis"],
        )
        if risk["is_crisis"]:
            await db.touch_agent_session(session_id, is_crisis=True)
    except Exception:  # pragma: no cover
        pass

    return ChatResponse(
        response=opening_message,
        session_id=session_id,
        is_crisis=risk["is_crisis"],
        risk_percent=risk["risk_percent"],
    )


@router.post("/consult", response_model=ChatResponse)
async def consult(
    payload: ChatRequest,
    user: CurrentUser = Depends(get_current_user),
):
    if not payload.message or not payload.message.strip():
        raise HTTPException(status_code=400, detail="Pesan tidak boleh kosong.")

    narrative_context = payload.context.model_dump() if payload.context else None
    risk = risk_engine.assess_message_risk(payload.message, narrative_context)

    session_context = None
    history = []
    session_id = payload.session_id

    if session_id:
        if db.DB_AVAILABLE:
            session_row = await db.get_agent_session(session_id, user.id)
            if not session_row:
                raise HTTPException(status_code=404, detail="Sesi konsultasi tidak ditemukan.")
            session_context = session_row.get("overall_context")
            history = await db.get_recent_messages(session_id, limit=8)
        else:
            # DB sedang tidak tersedia -- jangan anggap sesi ini tidak
            # ada (404), cukup lanjutkan tanpa histori/konteks
            # tersimpan supaya chat tetap jalan (stateless fallback).
            session_context = None
            history = []
    else:
        # Percakapan tanpa sesi screening sebelumnya (stateless
        # fallback) -- tetap dilayani, hanya tanpa konteks screening.
        session_id = await db.create_agent_session(
            user_id=user.id, screening_type=None, context={}
        )

    reply = await ask_qwen_with_context(
        message=payload.message,
        session_context=session_context,
        narrative_context=narrative_context,
        history=history,
        is_crisis=risk["is_crisis"],
    )

    try:
        await db.insert_agent_message(
            session_id=session_id,
            user_id=user.id,
            role="user",
            content=payload.message,
            nlp_context=narrative_context,
            risk_percent=risk["risk_percent"],
            is_crisis=risk["is_crisis"],
        )
        await db.insert_agent_message(
            session_id=session_id,
            user_id=user.id,
            role="assistant",
            content=reply,
            nlp_context=None,
            risk_percent=None,
            is_crisis=False,
        )
        if risk["is_crisis"]:
            await db.touch_agent_session(session_id, is_crisis=True)
    except Exception:  # pragma: no cover
        pass

    return ChatResponse(
        response=reply,
        session_id=session_id,
        is_crisis=risk["is_crisis"],
        risk_percent=risk["risk_percent"],
    )
