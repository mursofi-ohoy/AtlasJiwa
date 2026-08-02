/* =========================================
   ATLAS JIWA — Screening Routes (server/routes/screening.routes.js)
   POST /api/screening        -> simpan hasil screening milik user yang login
   GET  /api/screening/:userid -> lihat hasil (pemilik sendiri ATAU admin)
   GET  /api/screening        -> semua hasil (khusus admin, untuk dashboard/export)
   ========================================= */

const express = require('express');
const router = express.Router();

const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware');

// ---------------------------------------------------------
// POST /api/screening
// Body: { screening_type: string, answers: [{ question_number, question, answer, score }, ...] }
// ---------------------------------------------------------
router.post('/', requireAuth, async (req, res) => {
    const { screening_type, answers } = req.body || {};

    if (!screening_type || typeof screening_type !== 'string') {
        return res.status(400).json({ error: 'screening_type wajib diisi.' });
    }
    if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({ error: 'answers wajib berupa array dan tidak boleh kosong.' });
    }
    for (const a of answers) {
        if (typeof a.question !== 'string' || a.answer === undefined || a.answer === null) {
            return res.status(400).json({ error: 'Setiap item answers wajib memiliki question dan answer.' });
        }
    }

    // Transaksi: semua baris jawaban dalam satu sesi screening harus
    // tersimpan bersama-sama (all-or-nothing) supaya hasil tidak "setengah".
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        for (const a of answers) {
            await client.query(
                `INSERT INTO screening_results
                   (user_id, screening_type, question_number, question, answer, score)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [
                    req.user.id,
                    screening_type,
                    Number.isFinite(a.question_number) ? a.question_number : 0,
                    a.question,
                    String(a.answer),
                    Number.isFinite(a.score) ? a.score : 0,
                ]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        // Cetak detail LENGKAP ke log server (Railway Logs) -- ini yang
        // paling sering hilang saat debugging: kode error Postgres/
        // CockroachDB (err.code) dan pesannya (err.message) menunjukkan
        // PERSIS kolom/constraint mana yang bermasalah, mis.
        // '42703 column "x" does not exist' atau '23502 null value in
        // column "y"'.
        console.error('[POST /api/screening] Gagal INSERT ke screening_results:', {
            code: err.code,
            message: err.message,
            detail: err.detail,
        });
        return res.status(500).json({
            error: 'Gagal menyimpan hasil screening.',
            // Detail teknis HANYA dikirim ke klien saat development,
            // supaya tidak membocorkan info internal di production.
            ...(process.env.NODE_ENV !== 'production'
                ? { detail: err.message, code: err.code }
                : {}),
        });
    } finally {
        client.release();
    }

    return res.status(201).json({ message: 'Hasil screening tersimpan.' });
});

// ---------------------------------------------------------
// GET /api/screening/_debug/schema  — khusus admin.
// Introspeksi kolom tabel screening_results yang SESUNGGUHNYA berjalan
// di database saat ini, supaya bisa dibandingkan langsung dengan yang
// dibutuhkan query INSERT di atas -- tanpa perlu akses psql/CockroachDB
// console manual. Buka lewat browser (saat sudah login sebagai admin):
//   GET /api/screening/_debug/schema
// PENTING: route ini WAJIB didaftarkan SEBELUM '/:userid' di bawah,
// kalau tidak Express akan menganggap "_debug" sebagai nilai :userid.
// ---------------------------------------------------------
router.get('/_debug/schema', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT column_name, data_type, is_nullable, column_default
             FROM information_schema.columns
             WHERE table_name = 'screening_results'
             ORDER BY ordinal_position`
        );
        return res.json({ table: 'screening_results', columns: result.rows });
    } catch (err) {
        console.error('[GET /api/screening/_debug/schema]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// GET /api/screening/:userid
// Pemilik data boleh melihat miliknya sendiri; admin boleh melihat siapa saja.
// ---------------------------------------------------------
router.get('/:userid', requireAuth, async (req, res) => {
    try {
        const { userid } = req.params;
        if (req.user.role !== 'admin' && req.user.id !== userid) {
            return res.status(403).json({ error: 'Anda hanya bisa melihat hasil screening milik sendiri.' });
        }

        const result = await db.query(
            'SELECT * FROM screening_results WHERE user_id = $1 ORDER BY created_at DESC',
            [userid]
        );
        return res.json({ results: result.rows });
    } catch (err) {
        console.error('[GET /api/screening/:userid]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// GET /api/screening  — khusus admin (dipakai admin.html untuk
// tabel "Lihat hasil screening" + basis data export CSV/Excel).
// ---------------------------------------------------------
router.get('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const result = await db.query(
            `SELECT sr.id, sr.screening_type, sr.question_number, sr.question,
                    sr.answer, sr.score, sr.created_at,
                    u.id AS user_id, u.full_name, u.email, u.username
             FROM screening_results sr
             JOIN users u ON u.id = sr.user_id
             ORDER BY sr.created_at DESC`
        );
        return res.json({ results: result.rows });
    } catch (err) {
        console.error('[GET /api/screening]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

module.exports = router;
