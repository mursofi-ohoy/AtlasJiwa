/* =========================================
   ATLAS JIWA — Migration Runner (server/migrate.js)

   KENAPA FILE INI ADA:
   `sql/schema.sql` memakai `CREATE TABLE IF NOT EXISTS`, yang AMAN untuk
   tabel yang belum ada, tapi TIDAK MEMPERBAIKI tabel yang sudah ada
   dengan bentuk kolom berbeda (mis. dibuat manual sebelumnya). Kalau itu
   terjadi, `CREATE TABLE IF NOT EXISTS` di-skip diam-diam oleh database,
   dan endpoint yang meng-INSERT ke tabel tsb akan gagal dengan error
   500 (mis. "column ... does not exist" / "null value in column ...").

   File ini dijalankan SEKALI setiap kali server start (lihat server.js):
   1. Menjalankan seluruh sql/schema.sql apa adanya (idempotent, aman
      diulang) -> membuat tabel yang belum ada.
   2. Menjalankan ALTER TABLE ... ADD COLUMN IF NOT EXISTS untuk kolom-
      kolom yang benar-benar dipakai di server/routes/*.js -> merapikan
      tabel yang SUDAH ADA tapi kolomnya kurang/beda, tanpa perlu akses
      manual ke psql/CockroachDB console.

   ADD COLUMN di sini SENGAJA tidak memaksa NOT NULL secara langsung
   (CockroachDB/Postgres akan menolak ADD COLUMN ... NOT NULL pada
   tabel yang sudah berisi baris, kecuali disertai DEFAULT) -- kolom
   baru ditambah dengan DEFAULT yang aman, supaya proses ini tidak
   pernah gagal walau tabel sudah berisi data.
   ========================================= */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '..', 'sql', 'schema.sql');

// Kolom yang WAJIB ada di setiap tabel, sesuai yang benar-benar dipakai
// oleh query di server/routes/*.js. Kalau tabel sudah ada tapi kolom
// ini belum ada, ditambahkan dengan tipe + default yang aman.
const RECONCILE = [
    {
        table: 'screening_results',
        columns: [
            ["user_id", "UUID"],
            ["screening_type", "STRING NOT NULL DEFAULT ''"],
            ["question_number", "INT NOT NULL DEFAULT 0"],
            ["question", "STRING NOT NULL DEFAULT ''"],
            ["answer", "STRING NOT NULL DEFAULT ''"],
            ["score", "INT NOT NULL DEFAULT 0"],
            ["created_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
        ],
    },
    {
        table: 'users',
        columns: [
            ["full_name", "STRING NOT NULL DEFAULT ''"],
            ["email", "STRING"],
            ["username", "STRING"],
            ["password_hash", "STRING NOT NULL DEFAULT ''"],
            ["role", "STRING NOT NULL DEFAULT 'user'"],
            ["status", "STRING NOT NULL DEFAULT 'active'"],
            ["created_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
            ["last_login", "TIMESTAMPTZ"],
        ],
    },
    {
        table: 'agent_sessions',
        columns: [
            ["user_id", "UUID"],
            ["screening_type", "STRING"],
            ["overall_context_theme", "STRING"],
            ["overall_context_risk_percent", "DECIMAL(5,2)"],
            ["overall_context", "JSONB"],
            ["started_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
            ["last_message_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
            ["is_crisis", "BOOL NOT NULL DEFAULT false"],
        ],
    },
    {
        table: 'agent_messages',
        columns: [
            ["session_id", "UUID"],
            ["user_id", "UUID"],
            ["role", "STRING NOT NULL DEFAULT 'user'"],
            ["content", "STRING NOT NULL DEFAULT ''"],
            ["nlp_context", "JSONB"],
            ["risk_percent", "DECIMAL(5,2)"],
            ["is_crisis", "BOOL NOT NULL DEFAULT false"],
            ["created_at", "TIMESTAMPTZ NOT NULL DEFAULT now()"],
        ],
    },
];

/**
 * Jalankan sql/schema.sql apa adanya. Setiap statement dipisah dengan
 * `;` -- aman untuk file ini karena tidak ada `;` di dalam string literal
 * manapun di schema.sql.
 */
async function runSchemaFile(pool) {
    const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');

    // PENTING: buang baris komentar (`-- ...`) SEBELUM split by ';'.
    // Hampir setiap statement di schema.sql didahului blok komentar
    // header ("-- ====", "-- USERS", dst) -- kalau filter komentar
    // dilakukan SETELAH split per-statement (mis. cek apakah chunk
    // hasil split diawali '--'), seluruh statement CREATE TABLE yang
    // didahului komentar akan ikut ter-skip, karena chunk-nya dimulai
    // dari baris komentar itu, bukan dari 'CREATE TABLE'.
    const withoutComments = raw
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');

    const statements = withoutComments
        .split(';')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

    for (const stmt of statements) {
        await pool.query(stmt);
    }
}

/** Tambahkan kolom yang hilang di tabel yang SUDAH ADA sebelumnya. */
async function reconcileColumns(pool) {
    for (const { table, columns } of RECONCILE) {
        for (const [col, def] of columns) {
            try {
                await pool.query(
                    `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${def}`
                );
            } catch (err) {
                // Jangan hentikan boot server kalau satu ALTER gagal
                // (mis. tipe bentrok dengan data lama) -- catat saja,
                // supaya tabel lain tetap sempat direkonsiliasi.
                console.error(
                    `[Migrate] Gagal ALTER TABLE ${table} ADD COLUMN ${col}:`,
                    err.message
                );
            }
        }
    }
}

async function runMigrations(pool) {
    console.log('[Migrate] Menjalankan sql/schema.sql ...');
    await runSchemaFile(pool);

    console.log('[Migrate] Merekonsiliasi kolom pada tabel yang sudah ada ...');
    await reconcileColumns(pool);

    console.log('[Migrate] Selesai.');
}

module.exports = { runMigrations };
