/* =========================================
   ATLAS JIWA — Auth Routes (server/routes/auth.routes.js)
   POST /api/auth/register
   POST /api/auth/login
   POST /api/auth/logout
   GET  /api/auth/profile
   ========================================= */

const express = require('express');
const router = express.Router();

const db = require('../db');
const { hashPassword, comparePassword, signToken } = require('../auth');
const {
    authLimiter,
    requireAuth,
    isValidEmail,
    isValidUsername,
    isValidPassword,
    COOKIE_NAME,
    getCookieOptions,
} = require('../middleware');

// ---------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------
router.post('/register', authLimiter, async (req, res) => {
    try {
        const { full_name, email, username, password, confirm_password } = req.body || {};

        if (!full_name || !email || !username || !password || !confirm_password) {
            return res.status(400).json({ error: 'Semua field wajib diisi.' });
        }
        if (String(full_name).trim().length < 3) {
            return res.status(400).json({ error: 'Nama lengkap minimal 3 karakter.' });
        }
        if (!isValidEmail(email)) {
            return res.status(400).json({ error: 'Format email tidak valid.' });
        }
        if (!isValidUsername(username)) {
            return res.status(400).json({ error: 'Username harus 3-30 karakter: huruf, angka, titik, atau garis bawah.' });
        }
        if (!isValidPassword(password)) {
            return res.status(400).json({ error: 'Password minimal 8 karakter dan mengandung huruf serta angka.' });
        }
        if (password !== confirm_password) {
            return res.status(400).json({ error: 'Konfirmasi password tidak sama dengan password.' });
        }

        // Prepared statement (parameterized query) — aman dari SQL injection.
        const existing = await db.query(
            'SELECT id FROM users WHERE email = $1 OR username = $2',
            [email.trim().toLowerCase(), username.trim()]
        );
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email atau username sudah terdaftar.' });
        }

        const password_hash = await hashPassword(password);

        const result = await db.query(
            `INSERT INTO users (full_name, email, username, password_hash, role, status)
             VALUES ($1, $2, $3, $4, 'user', 'active')
             RETURNING id, full_name, email, username, role, created_at`,
            [full_name.trim(), email.trim().toLowerCase(), username.trim(), password_hash]
        );

        return res.status(201).json({ message: 'Registrasi berhasil. Silakan login.', user: result.rows[0] });
    } catch (err) {
        console.error('[POST /api/auth/register]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// POST /api/auth/login
// Menerima `identifier` (boleh email ATAU username) + password.
// ---------------------------------------------------------
router.post('/login', authLimiter, async (req, res) => {
    try {
        const { identifier, password } = req.body || {};
        if (!identifier || !password) {
            return res.status(400).json({ error: 'Email/username dan password wajib diisi.' });
        }

        const result = await db.query(
            'SELECT * FROM users WHERE email = $1 OR username = $1',
            [String(identifier).trim().toLowerCase()]
        );
        const user = result.rows[0];

        // Pesan error DISENGAJA generik (tidak membedakan "user tidak ada"
        // vs "password salah") supaya tidak membocorkan user enumeration.
        if (!user) {
            return res.status(401).json({ error: 'Email/username atau password salah.' });
        }
        if (user.status !== 'active') {
            return res.status(403).json({ error: 'Akun ini tidak aktif. Hubungi admin.' });
        }

        const passwordValid = await comparePassword(password, user.password_hash);
        if (!passwordValid) {
            return res.status(401).json({ error: 'Email/username atau password salah.' });
        }

        await db.query('UPDATE users SET last_login = now() WHERE id = $1', [user.id]);
        await db.query('INSERT INTO login_logs (user_id) VALUES ($1)', [user.id]);

        const token = signToken({ id: user.id, username: user.username, role: user.role });
        res.cookie(COOKIE_NAME, token, getCookieOptions(req));

        return res.json({
            message: 'Login berhasil.',
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                username: user.username,
                role: user.role,
            },
        });
    } catch (err) {
        console.error('[POST /api/auth/login]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

// ---------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------
router.post('/logout', (req, res) => {
    const { maxAge, ...clearOptions } = getCookieOptions(req);
    res.clearCookie(COOKIE_NAME, clearOptions);
    return res.json({ message: 'Logout berhasil.' });
});

// ---------------------------------------------------------
// GET /api/auth/profile  (dipakai auth-guard.js di frontend)
// ---------------------------------------------------------
router.get('/profile', requireAuth, async (req, res) => {
    try {
        const result = await db.query(
            'SELECT id, full_name, email, username, role, status, created_at, last_login FROM users WHERE id = $1',
            [req.user.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
        }
        return res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('[GET /api/auth/profile]', err);
        return res.status(500).json({ error: 'Terjadi kesalahan pada server.' });
    }
});

module.exports = router;
