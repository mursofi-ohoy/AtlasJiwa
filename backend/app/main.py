"""
ATLAS JIWA — FastAPI Entry Point (backend/app/main.py)

PERBAIKAN PENTING (mengatasi error saat `uvicorn app.main:app` di
Windows: "Psycopg cannot use the 'ProactorEventLoop'..." dan
"psycopg_pool.PoolTimeout: couldn't get a connection after 30.00 sec"):

1. EVENT LOOP WINDOWS
   Di Windows, asyncio secara default memakai ProactorEventLoop --
   psycopg (async) HANYA kompatibel dengan SelectorEventLoop (ini
   didokumentasikan resmi oleh psycopg sendiri). Baris paling atas
   file ini mengganti event loop policy KHUSUS di Windows, SEBELUM
   modul lain (termasuk psycopg_pool lewat app.database) sempat
   membuat loop apa pun -- karena uvicorn mengimpor "app.main:app" ini
   dulu sebelum benar-benar menjalankan event loop-nya sendiri, fix
   ini efektif walau hanya dijalankan lewat `uvicorn app.main:app`
   biasa. Catatan: `asyncio.set_event_loop_policy` ditandai deprecated
   sejak Python 3.14 (dihapus di 3.16) tapi MASIH BERFUNGSI PENUH di
   3.14 -- kita redam warning-nya saja.

2. STARTUP TIDAK LAGI MEMBLOKIR KARENA DATABASE
   Sebelumnya `await db_pool.open()` menunggu sampai koneksi berhasil
   dibuat -- kalau PostgreSQL/CockroachDB mati/unreachable, ini
   menggantung sampai PoolTimeout (30 detik) lalu MELEMPAR EXCEPTION,
   membuat FastAPI GAGAL TOTAL start (uvicorn tidak pernah mulai
   melayani request -- makanya endpoint Qwen ikut tidak bisa diakses,
   padahal errornya soal Postgres, bukan soal Qwen/Ollama). Sekarang
   startup mencoba connect dengan timeout pendek (lihat
   DB_STARTUP_TIMEOUT_SECONDS di config.py); kalau gagal, APLIKASI
   TETAP JALAN dengan Agent Memory (riwayat percakapan) dinonaktifkan
   -- fitur chat ke Qwen tetap berfungsi penuh tanpa histori
   tersimpan. Lihat app/database.py (DB_AVAILABLE).
"""

import asyncio
import sys
import warnings

if sys.platform == "win32":
    warnings.filterwarnings("ignore", category=DeprecationWarning, module="asyncio.*")
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception:
        # Kalaupun API ini suatu saat benar-benar dihapus (Python
        # 3.16+), jangan sampai import module ini ikut gagal -- cukup
        # lanjut tanpa fix (Agent Memory akan gagal connect, tapi
        # tertangkap dengan aman oleh lifespan() di bawah).
        pass

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app import database as db
from app.agent_api import router
from app.config import DB_STARTUP_TIMEOUT_SECONDS

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger("atlasjiwa")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ---------- startup ----------
    if db.db_pool is None:
        # DATABASE_URL tidak diisi sama sekali -- sudah dilog di
        # app/database.py saat import, tidak perlu coba connect.
        db.DB_AVAILABLE = False
    else:
        try:
            await db.db_pool.open(wait=False)
            await asyncio.wait_for(db.test_database(), timeout=DB_STARTUP_TIMEOUT_SECONDS)
            db.DB_AVAILABLE = True
            logger.info("[DATABASE] Terhubung -- Agent Memory aktif.")
        except Exception as exc:
            db.DB_AVAILABLE = False
            logger.warning(
                "[DATABASE] Tidak bisa terhubung dalam %.0f detik (%s). "
                "Melanjutkan TANPA Agent Memory -- fitur chat Qwen tetap "
                "berjalan, histori percakapan tidak akan tersimpan.",
                DB_STARTUP_TIMEOUT_SECONDS,
                exc,
            )

    yield

    # ---------- shutdown ----------
    if db.db_pool is not None:
        try:
            await db.db_pool.close()
        except Exception:
            pass


app = FastAPI(title="Atlas Jiwa API", lifespan=lifespan)
app.include_router(router)


@app.get("/")
async def root():
    return {"message": "Atlas Jiwa Backend berjalan!"}


@app.get("/health")
async def health():
    """Endpoint cek cepat -- pakai ini untuk verifikasi backend hidup
    tanpa perlu token JWT (endpoint /api/v1/agent/* butuh auth)."""
    return {
        "status": "ok",
        "database": "connected" if db.DB_AVAILABLE else "unavailable (agent memory nonaktif)",
    }
