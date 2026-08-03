"""
ATLAS JIWA — Gemini Client (backend/app/gemini_client.py)

Modul TERPISAH dari app/ollama_client.py. Tanggung jawabnya sengaja
dipersempit sesuai keputusan arsitektur project ini: Gemini HANYA
menerima skor kuantitatif screening (angka/persentase/level per
section) dan mengubahnya jadi analisa psikologi pra-klinis dalam
bahasa awam -- TIDAK PERNAH menerima teks jawaban naratif/kualitatif
mentah pengguna. Ekstraksi naratif tetap sepenuhnya jadi domain
nlp-engine.js (client-side) + Qwen (app/ollama_client.py), tidak
digantikan atau diduplikasi di sini.

Dipanggil oleh app/preclinical_api.py saja. Tidak dipanggil dari
app/agent_api.py -- kedua jalur LLM ini independen dan boleh gagal
sendiri-sendiri tanpa saling menjatuhkan.

Menggunakan httpx (sudah jadi dependency project lewat
ollama_client.py) memanggil REST API Gemini langsung, alih-alih
menambah dependency SDK google-generativeai baru -- sejalan dengan
prinsip "perubahan minimal" (tidak menambah struktur/dependency tanpa
kebutuhan kuat).
"""

import json

import httpx
from fastapi import HTTPException

from app.config import (
    GEMINI_API_KEY,
    GEMINI_API_URL_BASE,
    GEMINI_MODEL,
    GEMINI_TIMEOUT_SECONDS,
)

SYSTEM_PROMPT = """Anda adalah "Atlas Jiwa Pre-Clinical Scoring Interpreter". \
Tugas Anda HANYA menerjemahkan skor kuantitatif hasil screening (angka, \
persentase, level per dimensi) menjadi analisis psikologi pra-klinis yang \
mudah dipahami awam. Anda TIDAK menerima dan TIDAK memproses teks jawaban \
naratif/kualitatif pengguna -- itu ditangani modul terpisah.

ATURAN MUTLAK:
- JANGAN pernah memberi label diagnosis klinis formal (mis. nama gangguan, \
kode ICD/DSM apa pun).
- JANGAN memberi rekomendasi dosis/obat.
- Gunakan bahasa "pola yang terlihat dari skor Anda menunjukkan...", BUKAN \
"Anda mengalami..." / "Anda kecanduan...".
- Jika overall_level atau level section manapun berada di kategori \
tertinggi yang dikirim, WAJIB sertakan anjuran menghubungi profesional \
kesehatan mental secara eksplisit di bagian akhir.
- Selalu tutup dengan kalimat bahwa ini gambaran awal berbasis skor, bukan \
pengganti asesmen profesional.
- Gunakan bahasa Indonesia yang hangat dan profesional.

FORMAT OUTPUT (markdown):
## Ringkasan Skor
[1-2 kalimat: level keseluruhan + section paling menonjol]

## Pola per Dimensi
[bullet per section: makna skor dalam bahasa awam, tanpa jargon]

## Insight Pra-Klinis
[2-3 kalimat menghubungkan pola antar-dimensi, tanpa diagnosis]

## Langkah Lanjutan
[2-3 saran edukatif generik + anjuran profesional jika relevan]"""


async def ask_gemini_preclinical(score_payload: dict) -> str:
    """score_payload: hasil PreclinicalScoreRequest.model_dump() dari
    app/preclinical_api.py -- HANYA berisi angka/persentase/level,
    tidak ada teks bebas pengguna di dalamnya."""

    if not GEMINI_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY belum dikonfigurasi di backend (.env).",
        )

    url = f"{GEMINI_API_URL_BASE}/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": json.dumps(score_payload, ensure_ascii=False)}],
            }
        ],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 800,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=GEMINI_TIMEOUT_SECONDS) as client:
            response = await client.post(url, json=body)
    except httpx.ConnectError as exc:
        raise HTTPException(
            status_code=503,
            detail="Tidak dapat terhubung ke Gemini API. Cek koneksi internet backend.",
        ) from exc
    except httpx.TimeoutException as exc:
        raise HTTPException(
            status_code=504,
            detail=f"Gemini tidak merespons dalam {GEMINI_TIMEOUT_SECONDS:.0f} detik.",
        ) from exc

    if response.status_code == 400:
        raise HTTPException(
            status_code=502,
            detail=f"Gemini menolak permintaan (400): {response.text[:300]}",
        )
    if response.status_code in (401, 403):
        raise HTTPException(
            status_code=502,
            detail="GEMINI_API_KEY ditolak Gemini (401/403) -- cek validitas key.",
        )
    if response.status_code == 429:
        raise HTTPException(
            status_code=503,
            detail="Kuota/rate limit Gemini API tercapai, coba lagi sebentar lagi.",
        )

    response.raise_for_status()
    data = response.json()

    try:
        candidates = data["candidates"]
        if not candidates:
            raise KeyError("candidates kosong")
        parts = candidates[0]["content"]["parts"]
        text = "".join(p.get("text", "") for p in parts).strip()
        if not text:
            raise KeyError("teks kosong")
        return text
    except (KeyError, IndexError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Format balasan Gemini tidak sesuai dugaan (kemungkinan diblokir safety filter).",
        ) from exc
