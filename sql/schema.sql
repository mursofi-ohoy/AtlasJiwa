-- ============================================================
-- ATLAS JIWA
-- CockroachDB / PostgreSQL Schema
-- Compatible with CockroachDB Serverless
-- ============================================================

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    full_name VARCHAR(150) NOT NULL,

    email VARCHAR(150) NOT NULL UNIQUE,

    username VARCHAR(50) NOT NULL UNIQUE,

    password_hash TEXT NOT NULL,

    role STRING NOT NULL DEFAULT 'user',

    status STRING NOT NULL DEFAULT 'active',

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    last_login TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email);

CREATE INDEX IF NOT EXISTS idx_users_username
ON users(username);



-- ============================================================
-- LOGIN LOGS
-- ============================================================

CREATE TABLE IF NOT EXISTS login_logs (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    logged_in_at TIMESTAMPTZ NOT NULL DEFAULT now()

);

CREATE INDEX IF NOT EXISTS idx_login_logs_user
ON login_logs(user_id);



-- ============================================================
-- SCREENING SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS screening_sessions (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    screening_type STRING NOT NULL,

    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    completed_at TIMESTAMPTZ,

    overall_score INT,

    overall_max INT,

    overall_percent DECIMAL(5,2),

    overall_level STRING,

    created_at TIMESTAMPTZ DEFAULT now()

);

CREATE INDEX IF NOT EXISTS idx_screening_user
ON screening_sessions(user_id);



-- ============================================================
-- SCREENING ANSWERS
-- ============================================================

CREATE TABLE IF NOT EXISTS screening_answers (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID NOT NULL
        REFERENCES screening_sessions(id)
        ON DELETE CASCADE,

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    screening_type STRING NOT NULL,

    section_id STRING,

    question_number INT,

    question_text STRING,

    answer_text STRING,

    answer_score INT,

    is_qualitative BOOL DEFAULT false,

    created_at TIMESTAMPTZ DEFAULT now()

);

CREATE INDEX IF NOT EXISTS idx_answers_session
ON screening_answers(session_id);

CREATE INDEX IF NOT EXISTS idx_answers_user
ON screening_answers(user_id);



-- ============================================================
-- NLP RESULT
-- ============================================================

CREATE TABLE IF NOT EXISTS nlp_analysis (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    answer_id UUID
        REFERENCES screening_answers(id)
        ON DELETE CASCADE,

    session_id UUID
        REFERENCES screening_sessions(id)
        ON DELETE CASCADE,

    theme STRING,

    interpretation STRING,

    axis_scores JSONB,

    tags JSONB,

    evidence JSONB,

    qualitative_score DECIMAL(5,2),

    created_at TIMESTAMPTZ DEFAULT now()

);

CREATE INDEX IF NOT EXISTS idx_nlp_session
ON nlp_analysis(session_id);



-- ============================================================
-- SECTION SCORES
-- ============================================================

CREATE TABLE IF NOT EXISTS section_scores (

    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    session_id UUID
        REFERENCES screening_sessions(id)
        ON DELETE CASCADE,

    section_id STRING,

    score INT,

    max_score INT,

    percentage DECIMAL(5,2),

    level STRING

);

CREATE INDEX IF NOT EXISTS idx_section_session
ON section_scores(session_id);



-- ============================================================
-- SCREENING RESULTS (tabel flat yang dipakai oleh
-- server/routes/screening.routes.js & server/routes/users.routes.js)
--
-- CATATAN AUDIT: tabel ini SUDAH dipakai (INSERT/SELECT) oleh kode
-- Node yang berjalan, tapi sebelumnya tidak ada definisinya di
-- schema.sql manapun di project ini -- kemungkinan dibuat manual
-- langsung di database, atau berasal dari skema versi sebelumnya
-- yang tidak ikut ter-commit. Ditambahkan di sini supaya
-- `psql "$DATABASE_URL" -f sql/schema.sql` benar-benar mereproduksi
-- skema yang dibutuhkan endpoint yang sudah berjalan. Struktur kolom
-- disamakan persis dengan query INSERT di screening.routes.js.
-- Tabel screening_sessions/screening_answers/nlp_analysis di atas
-- TETAP DIPERTAHANKAN apa adanya (tidak dihapus) -- kemungkinan
-- dipersiapkan untuk model penyimpanan per-sesi yang lebih rapi di
-- masa depan, di luar scope perubahan ini.
-- ============================================================

CREATE TABLE IF NOT EXISTS screening_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screening_type STRING NOT NULL,
    question_number INT NOT NULL DEFAULT 0,
    question STRING NOT NULL,
    answer STRING NOT NULL,
    score INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_screening_results_user
ON screening_results(user_id);

CREATE INDEX IF NOT EXISTS idx_screening_results_type
ON screening_results(screening_type);



-- ============================================================
-- AGENT SESSIONS & MESSAGES  (DEPRECATED, tidak lagi ditulis)
-- Dulu dipakai untuk menyimpan riwayat percakapan dengan Atlas Jiwa AI
-- lewat backend FastAPI + Qwen/Ollama (backend/app/agent_api.py).
-- Backend itu SUDAH DIHAPUS -- konsultasi AI sekarang berjalan 100%
-- di browser (lihat public/js/ai-adapter.js) dan TIDAK PERNAH
-- mengirim isi pesan ke server. Definisi tabel ini dipertahankan
-- apa adanya (tidak di-DROP) hanya supaya baris lama (jika ada) tidak
-- ikut hilang; tidak ada kode server yang menulis ke sini lagi.
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    screening_type STRING,
    -- Ringkasan konteks awal (dari summary-engine.js) saat sesi dibuka,
    -- disimpan agar riwayat tetap bermakna walau screening berikutnya
    -- mengubah skor.
    overall_context_theme STRING,
    overall_context_risk_percent DECIMAL(5,2),
    overall_context JSONB,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_crisis BOOL NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_user
ON agent_sessions(user_id);


CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role STRING NOT NULL, -- 'user' | 'assistant'
    content STRING NOT NULL,
    -- Konteks NLP kualitatif pesan ini (khusus role='user'), dari
    -- window.AtlasNLPEngine.analyzeQualitative() sisi klien: theme,
    -- tags, axis scores, qualitative risk. NULL untuk role='assistant'.
    nlp_context JSONB,
    -- Skor risiko komposit 0-100 yang dipakai untuk memutuskan
    -- is_crisis pesan ini (lihat backend/app/risk_engine.py).
    risk_percent DECIMAL(5,2),
    is_crisis BOOL NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_session
ON agent_messages(session_id);

CREATE INDEX IF NOT EXISTS idx_agent_messages_user
ON agent_messages(user_id);
