-- ============================================================
-- ATLAS JIWA — Skema D1 (SQLite) untuk Cloudflare Worker
-- Menggantikan ketergantungan pada backend Railway/CockroachDB.
-- Jalankan dengan:
--   wrangler d1 execute atlasjiwa-db --remote --file=./sql/d1_schema.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

CREATE TABLE IF NOT EXISTS login_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    logged_in_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_logs_user ON login_logs(user_id);

-- Tabel flat hasil screening — persis kolomnya dengan yang dipakai
-- server/routes/screening.routes.js (versi Railway), supaya kedua
-- deployment tetap kompatibel secara konsep meski database berbeda.
CREATE TABLE IF NOT EXISTS screening_results (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screening_type TEXT NOT NULL,
    question_number INTEGER NOT NULL DEFAULT 0,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_screening_results_user ON screening_results(user_id);
CREATE INDEX IF NOT EXISTS idx_screening_results_type ON screening_results(screening_type);
