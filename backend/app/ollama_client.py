import httpx

from app.config import QWEN_API_URL, OLLAMA_MODEL, OLLAMA_TIMEOUT_SECONDS
from app.prompt_builder import build_full_prompt, build_opening_prompt

# NOTE (backward-compat): fungsi ask_qwen(prompt) lama dipertahankan
# apa adanya untuk siapa pun yang masih memanggilnya langsung dengan
# prompt polos. Untuk jalur baru (session/init & consult yang sudah
# terhubung dengan nlp-engine.js), pakai ask_qwen_with_context() /
# ask_qwen_opening() di bawah -- keduanya membangun prompt lewat
# prompt_builder.py supaya konteks NLP tersusun konsisten.

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

    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
        response = await client.post(QWEN_API_URL, json=payload)

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