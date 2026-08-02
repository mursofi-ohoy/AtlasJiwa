/* =========================================
   ATLAS JIWA — Middleware (server/middleware.js)
   Berisi:
   - Nama & opsi cookie sesi (dipakai auth.routes.js & di sini)
   - requireAuth / requireAdmin  : guard untuk rute terproteksi
   - authLimiter / apiLimiter    : rate limiting (express-rate-limit)
   - Validator input sederhana (email, password, username)
   ========================================= */

const rateLimit = require('express-rate-limit');
const { verifyToken } = require('./auth');

const COOKIE_NAME = 'atlas_session';

/** Opsi cookie sesi DIHITUNG PER REQUEST (bukan nilai tetap).
 *  Kenapa: kalau `secure` di-hardcode `true` (mis. berdasar NODE_ENV
 *  saja) sementara koneksi sesungguhnya masih HTTP — baik karena akses
 *  langsung tanpa HTTPS, atau server ada di belakang reverse proxy /
 *  platform hosting (Render, Railway, dst) — browser akan MENOLAK
 *  menyimpan cookie tsb sama sekali. Efeknya: login terlihat sukses
 *  (200 OK) tapi cookie tidak pernah tersimpan, sehingga halaman
 *  berikutnya (auth-guard.js) selalu menganggap belum login dan
 *  melempar balik ke login.html.
 *  `req.secure` sudah otomatis membaca header X-Forwarded-Proto dari
 *  proxy SELAMA `app.set('trust proxy', 1)` dipasang di server.js. */
function getCookieOptions(req) {
    return {
        httpOnly: true, // tidak bisa diakses document.cookie di JS frontend -> mitigasi XSS
        secure: req.secure, // true hanya jika koneksi ini benar-benar HTTPS
        sameSite: 'lax', // proteksi dasar terhadap CSRF lintas situs
        maxAge: 2 * 60 * 60 * 1000, // 2 jam, selaras dengan JWT_EXPIRES_IN default
        path: '/',
    };
}

/** Rute wajib login. Membaca token dari cookie httpOnly (BUKAN dari
 *  header Authorization) — frontend tidak pernah menyentuh token ini
 *  secara langsung. */
function requireAuth(req, res, next) {
    const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
    if (!token) {
        return res.status(401).json({ error: 'Anda belum login.' });
    }
    try {
        req.user = verifyToken(token); // { id, username, role }
        return next();
    } catch (err) {
        return res.status(401).json({ error: 'Sesi tidak valid atau sudah kedaluwarsa. Silakan login kembali.' });
    }
}

/** Dipasang SETELAH requireAuth. Rute khusus admin. */
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Akses ditolak. Halaman ini khusus untuk admin.' });
    }
    return next();
}

/** Rate limit ketat untuk endpoint sensitif (login/register) — mencegah
 *  brute-force credential guessing. */
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak percobaan. Silakan coba lagi dalam beberapa menit.' },
});

/** Rate limit umum untuk seluruh /api/*. */
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Terlalu banyak permintaan. Silakan coba lagi nanti.' },
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.]{3,30}$/;

function isValidEmail(value) {
    return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}

function isValidUsername(value) {
    return typeof value === 'string' && USERNAME_REGEX.test(value.trim());
}

/** Minimal 8 karakter, mengandung huruf & angka. Disengaja tidak
 *  memaksa simbol wajib supaya tidak terlalu membebani pengguna awam,
 *  tapi tetap jauh lebih kuat dari sekadar "min length". */
function isValidPassword(value) {
    if (typeof value !== 'string' || value.length < 8) return false;
    const hasLetter = /[a-zA-Z]/.test(value);
    const hasDigit = /[0-9]/.test(value);
    return hasLetter && hasDigit;
}

module.exports = {
    COOKIE_NAME,
    getCookieOptions,
    requireAuth,
    requireAdmin,
    authLimiter,
    apiLimiter,
    isValidEmail,
    isValidUsername,
    isValidPassword,
};
