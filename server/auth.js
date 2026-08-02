/* =========================================
   ATLAS JIWA — Auth Helpers (server/auth.js)
   Kumpulan fungsi murni untuk hashing password (bcrypt) dan
   pembuatan/verifikasi token sesi (JWT). Tidak menyentuh
   request/response Express — itu tugas middleware.js & routes/.

   Kenapa JWT (bukan express-session)?
   Spesifikasi memberi pilihan "express-session ATAU JWT". JWT dipilih
   di sini supaya server tetap stateless (tidak perlu tabel/store sesi
   terpisah) — token disimpan di cookie httpOnly agar tidak bisa
   diakses lewat JavaScript sisi klien (mitigasi XSS-token-theft).
   ========================================= */

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = 12;

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 16) {
        throw new Error('[Auth] JWT_SECRET belum di-set atau terlalu pendek. Set string acak panjang di .env.');
    }
    return secret;
}

/** Hash password mentah sebelum disimpan ke kolom users.password_hash. */
async function hashPassword(plainPassword) {
    return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** Bandingkan password mentah dari form login dengan hash di database. */
async function comparePassword(plainPassword, hash) {
    return bcrypt.compare(plainPassword, hash);
}

/** Buat JWT berisi identitas minimal (id, username, role) — JANGAN
 *  pernah menaruh password_hash atau data sensitif lain di payload,
 *  karena payload JWT bisa dibaca siapa pun yang punya tokennya
 *  (hanya tanda tangannya yang dilindungi secret). */
function signToken(payload) {
    return jwt.sign(payload, getJwtSecret(), {
        expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    });
}

/** Verifikasi & decode token. Melempar error jika invalid/kedaluwarsa —
 *  pemanggil (middleware requireAuth) wajib membungkus dengan try/catch. */
function verifyToken(token) {
    return jwt.verify(token, getJwtSecret());
}

module.exports = { hashPassword, comparePassword, signToken, verifyToken };
