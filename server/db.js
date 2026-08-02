/* =========================================
   ATLAS JIWA — Database Connection (server/db.js)
   ========================================= */

require('dotenv').config();
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
    console.error('[DB] DATABASE_URL belum di-set di file .env.');
    process.exit(1);
}

const useSSL = process.env.DB_SSL !== 'false';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL
        ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' }
        : false,
    max: Number(process.env.DB_POOL_MAX) || 10,
    idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
    console.error('[DB] Unexpected error pada idle client:', err.message);
});

// =========================================
// TES KONEKSI DATABASE
// =========================================
pool.query('SELECT NOW()')
    .then(() => {
        console.log('[DB] ✅ Berhasil terhubung ke CockroachDB');
    })
    .catch((err) => {
        console.error('[DB] ❌ Gagal terhubung ke CockroachDB');
        console.error(err);
    });

// =========================================

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool,
};
