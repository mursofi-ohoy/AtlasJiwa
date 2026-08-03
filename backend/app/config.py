import os
from dotenv import load_dotenv

load_dotenv()

# Opsional sekarang -- lihat app/database.py. Kalau kosong atau tidak
# bisa dihubungi saat startup, backend tetap jalan tanpa Agent Memory
# (riwayat percakapan), tapi endpoint Qwen tetap berfungsi penuh.
DATABASE_URL = os.getenv("DATABASE_URL")

# JWT_SECRET HARUS SAMA PERSIS dengan JWT_SECRET yang di-set di
# Cloudflare Worker lewat `wrangler secret put JWT_SECRET` (lihat
# src/lib/crypto.js + wrangler.toml di root project). Worker itu
# sekarang satu-satunya penerbit token saat user login -- FastAPI di
# sini HANYA memverifikasi ulang token yang sama (lihat app/auth.py).
# Jangan buat secret terpisah, atau verifikasi token akan selalu 401.
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"  # samakan dengan HS256 yang dipakai crypto.js

# QWEN_API_URL dipertahankan sebagai satu-satunya sumber URL Ollama --
# ollama_client.py membacanya lewat config ini alih-alih hardcode
# langsung, supaya bisa diarahkan ke instance Ollama lain tanpa ubah
# kode.
QWEN_API_URL = os.getenv("QWEN_API_URL") or "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL") or "qwen3:4b"
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS") or 120)

# Batas waktu (detik) mencoba konek ke PostgreSQL/CockroachDB SAAT
# STARTUP SAJA (lihat app/main.py). Kalau habis waktu ini, DB dianggap
# tidak tersedia dan backend tetap jalan TANPA Agent Memory, bukan
# menggantung/crash seperti sebelumnya (PoolTimeout 30 detik lalu
# startup gagal total).
DB_STARTUP_TIMEOUT_SECONDS = float(os.getenv("DB_STARTUP_TIMEOUT_SECONDS") or 5)
