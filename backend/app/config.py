import os
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

# JWT_SECRET HARUS sama persis dengan JWT_SECRET yang dipakai
# server/auth.js (Node) -- FastAPI tidak punya sistem login sendiri,
# ia hanya memverifikasi token yang sudah diterbitkan Node saat
# login (lihat app/auth.py). Jangan buat secret terpisah untuk
# backend Python, atau verifikasi token akan selalu gagal.
JWT_SECRET = os.getenv("JWT_SECRET")
JWT_ALGORITHM = "HS256"  # samakan dengan default algoritma jsonwebtoken di Node

# QWEN_API_URL dipertahankan sebagai satu-satunya sumber URL Ollama,
# dulu dideklarasikan tapi tidak pernah dipakai -- ollama_client.py
# sekarang membacanya lewat config ini alih-alih hardcode langsung,
# supaya bisa diarahkan ke instance Ollama lain tanpa ubah kode.
QWEN_API_URL = os.getenv("QWEN_API_URL") or "http://127.0.0.1:11434/api/generate"
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL") or "qwen3:4b"
OLLAMA_TIMEOUT_SECONDS = float(os.getenv("OLLAMA_TIMEOUT_SECONDS") or 120)