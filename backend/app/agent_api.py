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

Endpoint ini diakses BUKAN langsung dari browser, melainkan lewat
proxy Node (server/routes/agent.routes.js) yang menyisipkan header
Authorization: Bearer <JWT> dari cookie sesi -- lihat app/auth.py.
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

    try:
        session_id = await db.create_agent_session(
            user_id=user.id,
            screening_type=payload.screening_type,
            context=context_dict,
        )
    except Exception as exc:  # pragma: no cover - kegagalan infra
        raise HTTPException(status_code=500, detail=f"Gagal membuat sesi konsultasi: {exc}")

    opening_message = await ask_qwen_opening(context_dict, is_crisis=risk["is_crisis"])

    # Kegagalan menyimpan histori TIDAK menggagalkan respons ke user --
    # yang penting user tetap dapat balasan Qwen.
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
        try:
            session_row = await db.get_agent_session(session_id, user.id)
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"Gagal mengambil sesi: {exc}")

        if not session_row:
            raise HTTPException(status_code=404, detail="Sesi konsultasi tidak ditemukan.")

        session_context = session_row.get("overall_context")
        try:
            history = await db.get_recent_messages(session_id, limit=8)
        except Exception:  # pragma: no cover
            history = []
    else:
        # Percakapan tanpa sesi screening sebelumnya (stateless
        # fallback) -- tetap dilayani, hanya tanpa konteks screening.
        try:
            session_id = await db.create_agent_session(
                user_id=user.id, screening_type=None, context={}
            )
        except Exception as exc:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"Gagal membuat sesi konsultasi: {exc}")

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
