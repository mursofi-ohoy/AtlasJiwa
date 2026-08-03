"""
ATLAS JIWA — Endpoint Analisa Pra-Klinis (backend/app/preclinical_api.py)

POST /api/v1/analysis/preclinical
Body: PreclinicalScoreRequest (lihat app/models.py) -- HANYA skor
kuantitatif (overall_score/overall_max/overall_percent/overall_level +
breakdown per section), TIDAK ADA teks jawaban naratif di dalamnya.

Frontend bertanggung jawab menghitung agregat ini sendiri (logika
skor sudah ada di public/js/summary-engine.js) sebelum mengirim ke
endpoint ini -- endpoint ini TIDAK membaca screening_results/
screening_sessions langsung, supaya tidak perlu mengubah
server/routes/screening.routes.js atau skema DB sama sekali di
iterasi pertama ini (lihat catatan PERSISTENSI di bawah).

Diakses lewat proxy Cloudflare Worker yang sama seperti /api/v1/agent/*
(header Authorization: Bearer <JWT> disisipkan Worker dari cookie
sesi), sehingga cukup daftarkan router baru ini -- tidak perlu route
proxy baru di src/index.js kalau proxy sudah generik untuk semua path
di bawah /api/v1/*. Kalau proxy di-hardcode per-path, tambahkan satu
baris pemetaan baru di sana (lihat CARA TEST).

CATATAN PERSISTENSI (sengaja BELUM diimplementasikan di iterasi ini):
Tabel nlp_analysis di sql/schema.sql punya kolom answer_id/session_id
yang FK ke screening_answers/screening_sessions -- tabel yang TIDAK
diisi oleh jalur aktif saat ini (screening.routes.js insert ke
screening_results, tabel flat yang berbeda). Memaksa INSERT ke
nlp_analysis sekarang akan menghasilkan baris tanpa kepemilikan user
yang bisa dilacak (kedua FK nullable, tidak ada kolom user_id di
tabel itu). Kalau nanti perlu histori analisa pra-klinis tersimpan,
opsinya:
  ALTER TABLE nlp_analysis ADD COLUMN user_id UUID REFERENCES users(id);
  ALTER TABLE nlp_analysis ADD COLUMN screening_type STRING;
(migration aditif, sesuai aturan "Perlindungan Database" -- bukan
mengubah kolom lama). Sampai itu diputuskan, endpoint ini stateless:
hasil dikembalikan langsung ke caller, penyimpanan (kalau perlu)
dilakukan di sisi Node/screening seperti flow lain.
"""

from fastapi import APIRouter, Depends

from app.auth import get_current_user, CurrentUser
from app.gemini_client import ask_gemini_preclinical
from app.models import PreclinicalScoreRequest, PreclinicalAnalysisResponse

router = APIRouter(prefix="/api/v1/analysis", tags=["analysis"])


@router.post("/preclinical", response_model=PreclinicalAnalysisResponse)
async def preclinical_analysis(
    payload: PreclinicalScoreRequest,
    user: CurrentUser = Depends(get_current_user),
):
    analysis_text = await ask_gemini_preclinical(payload.model_dump())

    return PreclinicalAnalysisResponse(
        analysis=analysis_text,
        screening_type=payload.screening_type,
        overall_percent=payload.overall_percent,
    )
