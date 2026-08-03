import httpx
from fastapi import HTTPException

from app.config import QWEN_API_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS
from app.prompt_builder import build_full_prompt, build_opening_prompt

# NOTE (backward-compat): fungsi ask_qwen(prompt) lama dipertahankan
# apa adanya untuk siapa pun yang masih memanggilnya langsung dengan
# prompt polos. Untuk jalur baru (session/init & consult yang sudah
# terhubung dengan nlp-engine.js), pakai ask_qwen_with_context() /
# ask_qwen_opening() di bawah -- keduanya membangun prompt lewat
# prompt_builder.py supaya konteks NLP tersusun konsisten.
#
# PERBAIKAN: _generate() sekarang menangkap error koneksi ke Ollama
# secara eksplisit (server belum jalan / model belum di-pull / lambat
# merespons) dan mengubahnya jadi HTTPException dengan pesan yang
# jelas, alih-alih exception mentah httpx yang muncul sebagai 500
# generik tanpa penjelasan di frontend.

_MINIMAL_SYSTEM_PROMPT = """
Kamu adalah Atlas Jiwa AI, asisten edukasi kesehatan mental.
Jangan pernah memberikan diagnosis atau resep obat. Gunakan bahasa
yang sama dengan pengguna. Jawab sopan, singkat, mudah dipahami. Jika
pengguna dalam kondisi berbahaya, sarankan segera menghubungi
profesional kesehatan atau layanan darurat setempat.
"""


async def _generate(full_prompt: str) -> str:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": full_prompt,
        "stream": False,
    }

    try:
        async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
            response = await client.post(QWEN_API_URL, json=payload)
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Tidak dapat terhubung ke Ollama di {QWEN_API_URL}. "
                "Pastikan 'ollama serve' sedang berjalan di background."
            ),
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail=(
                f"Ollama tidak merespons dalam {OLLAMA_TIMEOUT_SECONDS:.0f} detik "
                f"(model: {OLLAMA_MODEL}). Model besar bisa lambat di percobaan "
                "pertama -- coba lagi, atau naikkan OLLAMA_TIMEOUT_SECONDS di .env."
            ),
        ) from exc

    if response.status_code == 404:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Model '{OLLAMA_MODEL}' belum tersedia di Ollama. "
                f"Jalankan: ollama pull {OLLAMA_MODEL}"
            ),
        )

    response.raise_for_status()
    return response.json()["response"]


async def ask_qwen(prompt: str) -> str:
    """Versi lama, dipertahankan untuk kompatibilitas mundur."""
    full_prompt = f"{_MINIMAL_SYSTEM_PROMPT}\n\nPertanyaan pengguna:\n{prompt}"
    return await _generate(full_prompt)


async def ask_qwen_with_context(
    message: str,
    session_context: dict | None = None,
    narrative_context: dict | None = None,
    history: list[dict] | None = None,
    is_crisis: bool = False,
) -> str:
    """Jalur utama POST /api/v1/agent/consult -- prompt disusun dari
    konteks screening (sekali di awal sesi), konteks NLP pesan
    terbaru, dan histori percakapan singkat."""
    full_prompt = build_full_prompt(
        message=message,
        session_context=session_context,
        narrative_context=narrative_context,
        history=history,
        is_crisis=is_crisis,
    )
    return await _generate(full_prompt)


async def ask_qwen_opening(session_context: dict | None, is_crisis: bool = False) -> str:
    """Jalur POST /api/v1/agent/session/init -- pesan pembuka otomatis
    berdasarkan konteks ringkasan screening, tanpa pesan user."""
    full_prompt = build_opening_prompt(session_context, is_crisis=is_crisis)
    return await _generate(full_prompt)
