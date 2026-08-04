/* =========================================
   ATLAS JIWA — Server Entry Point (server/server.js)
   Menyusun seluruh middleware keamanan, memasang rute API, dan
   menyajikan file statis frontend dari /public.

   Jalankan: node server/server.js   (atau `npm start`)
   ========================================= */

require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const { apiLimiter } = require('./middleware');
const db = require('./db');
const { runMigrations } = require('./migrate');
const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const screeningRoutes = require('./routes/screening.routes');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// Wajib jika server berjalan di belakang reverse proxy / platform hosting
// (Nginx, Render, Railway, Fly.io, dst). Tanpa ini, req.secure (dipakai
// untuk menentukan flag `secure` cookie sesi) akan selalu false meskipun
// pengguna sebenarnya mengakses lewat HTTPS -> cookie sesi gagal
// tersimpan -> login "berhasil" tapi selalu terlempar balik ke login.html.
// Aman dipasang juga saat development di localhost (tidak ada proxy).
app.set('trust proxy', 1);

// ---------------------------------------------------------
// Keamanan dasar
// ---------------------------------------------------------
app.use(
    helmet({
        // CSP default Helmet cukup ketat untuk memblokir Google Fonts (CDN)
        // yang dipakai halaman-halaman di /public. Konfigurasikan CSP
        // secara eksplisit sebelum deploy ke produksi, contoh:
        //   contentSecurityPolicy: { directives: { defaultSrc: ["'self'"],
        //     styleSrc: ["'self'", 'fonts.googleapis.com'],
        //     fontSrc: ["'self'", 'fonts.gstatic.com'] } }
        contentSecurityPolicy: false,
    })
);

app.use(
    cors({
        origin: process.env.CORS_ORIGIN || true, // same-origin by default (frontend disajikan dari server yang sama)
        credentials: true, // wajib true agar cookie sesi ikut terkirim di request fetch()
    })
);

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// Rate limiter global untuk seluruh /api/*  (limiter lebih ketat khusus
// login/register dipasang terpisah di auth.routes.js).
app.use('/api', apiLimiter);

// ---------------------------------------------------------
// Rute API
// ---------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/screening', screeningRoutes);
// Catatan arsitektur: proxy ke FastAPI (backend/app/agent_api.py,
// Qwen/Ollama) SUDAH DIHAPUS. Backend sekarang hanya menangani
// auth (/api/auth), manajemen user (/api/users), dan penyimpanan
// skor screening (/api/screening). Seluruh interpretasi/konsultasi
// AI berjalan di browser — lihat public/js/ai-adapter.js.

// ---------------------------------------------------------
// Frontend statis (HTML/CSS/JS di /public)
// Proteksi halaman (atlas-jiwa.html, screening.html, admin.html)
// dilakukan di SISI KLIEN oleh public/js/auth-guard.js yang memanggil
// GET /api/auth/profile. Data sesungguhnya tetap aman karena setiap
// endpoint API yang mengembalikan data sensitif (users, screening
// results) tervalidasi ulang oleh requireAuth/requireAdmin di server.
// ---------------------------------------------------------
app.use(express.static(PUBLIC_DIR));

app.get('/', (req, res) => {
    res.redirect('/login.html');
});

// 404 khusus untuk /api/*
app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Endpoint tidak ditemukan.' });
});

// Fallback 404 umum
app.use((req, res) => {
    res.status(404).sendFile(path.join(PUBLIC_DIR, 'login.html'), (err) => {
        if (err) res.status(404).send('Not found');
    });
});

// Error handler terakhir — menangkap error tak terduga dari route manapun
// (mis. promise rejection yang lolos try/catch) supaya server tidak crash
// dan tidak membocorkan stack trace ke klien.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error('[Unhandled Error]', err);
    res.status(500).json({ error: 'Terjadi kesalahan tak terduga di server.' });
});

// ---------------------------------------------------------
// Jalankan migrasi skema (idempotent, aman diulang setiap deploy)
// SEBELUM server mulai menerima request. Ini menutup celah "tabel
// sudah ada tapi bentuk kolomnya beda" yang tidak dibereskan oleh
// `CREATE TABLE IF NOT EXISTS` di sql/schema.sql -- lihat komentar
// di server/migrate.js. Kalau migrasi gagal, server TETAP dijalankan
// (supaya halaman login/statis lain tidak ikut down), tapi error
// lengkap dicetak ke log supaya kelihatan di Railway Logs.
// ---------------------------------------------------------
runMigrations(db.pool)
    .catch((err) => {
        console.error('[Migrate] Migrasi gagal dijalankan:', err);
    })
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`[ATLAS JIWA] Server berjalan di http://localhost:${PORT}`);
            console.log(`[ATLAS JIWA] NODE_ENV = ${process.env.NODE_ENV || 'development'}`);
        });
    });
