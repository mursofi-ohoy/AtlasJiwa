/* =========================================
   ATLAS JIWA — Users Routes (server/routes/users.routes.js)
   Seluruh rute di file ini KHUSUS ADMIN (lihat router.use di bawah).
   GET    /api/users              -> daftar user (+ pencarian ?search=)
   PUT    /api/users/:id          -> edit user
   DELETE /api/users/:id          -> hapus user
   GET    /api/users/stats/summary -> ringkasan dashboard admin
   ========================================= */

const express = require('express');
const router = express.Router();

const db = require('../db');
const { requireAuth, requireAdmin, isValidEmail, isValidUsername } = require('../middleware');

// Semua rute di bawah ini wajib login DAN berperan admin.
router.use(requireAuth, requireAdmin);

// ---------------------------------------------------------
// GET /api/users?search=...
// ---------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
        const result = await db.query(
            `SELECT id, full_name, email, username, role, status, created_at, last_login
             FROM users
             WHERE full_name ILIKE $1 OR email ILIKE $1 OR username ILIKE $1
             ORDER BY created_at DESC`,
            [`%${search}%`]
        );
        return res.json({ users: result.rows });
    } catch (err) {
        console.error('[GET /api/users]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// GET /api/users/stats/summary  — untuk kartu ringkasan admin.html
// ---------------------------------------------------------
router.get('/stats/summary', async (req, res) => {
    try {
        const [userCount, screeningCount, loginCount] = await Promise.all([
            db.query('SELECT COUNT(*)::int AS count FROM users'),
            // "Jumlah screening" dihitung per sesi (screening_type + tanggal),
            // bukan per baris jawaban, supaya angkanya bermakna.
            db.query(`SELECT COUNT(*)::int AS count FROM (
                         SELECT DISTINCT user_id, screening_type, date_trunc('minute', created_at)
                         FROM screening_results
                       ) AS sessions`),
            db.query('SELECT COUNT(*)::int AS count FROM login_logs'),
        ]);

        return res.json({
            users: userCount.rows[0].count,
            screenings: screeningCount.rows[0].count,
            logins: loginCount.rows[0].count,
        });
    } catch (err) {
        console.error('[GET /api/users/stats/summary]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// PUT /api/users/:id
// ---------------------------------------------------------
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { full_name, email, username, role, status } = req.body || {};

        if (email !== undefined && !isValidEmail(email)) {
            return res.status(400).json({ error: 'Format email tidak valid.' });
        }
        if (username !== undefined && !isValidUsername(username)) {
            return res.status(400).json({ error: 'Format username tidak valid.' });
        }
        if (role !== undefined && !['user', 'admin'].includes(role)) {
            return res.status(400).json({ error: "Role harus 'user' atau 'admin'." });
        }
        if (status !== undefined && !['active', 'suspended'].includes(status)) {
            return res.status(400).json({ error: "Status harus 'active' atau 'suspended'." });
        }

        const result = await db.query(
            `UPDATE users SET
                full_name = COALESCE($1, full_name),
                email     = COALESCE($2, email),
                username  = COALESCE($3, username),
                role      = COALESCE($4, role),
                status    = COALESCE($5, status)
             WHERE id = $6
             RETURNING id, full_name, email, username, role, status, created_at, last_login`,
            [
                full_name ?? null,
                email ? email.trim().toLowerCase() : null,
                username ? username.trim() : null,
                role ?? null,
                status ?? null,
                id,
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        return res.json({ message: 'Data pengguna diperbarui.', user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') { // unique_violation (email/username bentrok)
            return res.status(409).json({ error: 'Email atau username sudah dipakai pengguna lain.' });
        }
        console.error('[PUT /api/users/:id]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// DELETE /api/users/:id
// ---------------------------------------------------------
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        if (req.user.id === id) {
            return res.status(400).json({ error: 'Tidak bisa menghapus akun Anda sendiri saat sedang login sebagai akun tsb.' });
        }
        const result = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        return res.json({ message: 'Pengguna berhasil dihapus.' });
    } catch (err) {
        console.error('[DELETE /api/users/:id]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

module.exports = router;
