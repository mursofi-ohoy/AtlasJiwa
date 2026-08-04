# ATLAS JIWA — Full-Stack Setup

Platform edukasi & screening psikologi kendali impuls/adiksi.
Frontend statis (HTML/CSS/Vanilla JS) + backend Node.js/Express +
PostgreSQL (CockroachDB).

**Arsitektur (per refactor terbaru):** backend HANYA menangani
login/register dan menyimpan **skor kuantitatif** hasil screening.
Seluruh analisis NLP, ringkasan, dan "konsultasi AI" berjalan **di
browser** — tidak ada jawaban naratif, prompt, atau ringkasan AI yang
pernah dikirim ke server maupun disimpan di database. Backend kedua
(FastAPI + Ollama/Qwen) yang dulu ada di `backend/` sudah dihapus.

## Struktur Project

```
atlas-jiwa/
├── .env.example                 <- config Node
├── package.json
├── public/                 <- disajikan langsung oleh Express (static)
│   ├── login.html          <- form Login & Register (tab)
│   ├── atlas-jiwa.html     <- halaman utama (wajib login)
│   ├── screening.html      <- tes screening (wajib login)
│   ├── admin.html          <- dashboard admin (wajib login + role admin)
│   ├── css/
│   └── js/
│       ├── keyword-dictionary.js  <- kamus axis NLP kualitatif
│       ├── nlp-engine.js          <- analisis per-jawaban naratif
│       ├── summary-engine.js      <- ringkasan lintas-jawaban + composite risk
│       ├── ai-adapter.js          <- lapisan AI client-side, lihat §8 (baru)
│       ├── agent-bridge.js        <- jembatan ke ai-adapter.js (§8)
│       ├── screening-submit.js    <- kirim RINGKASAN SKOR (bukan narasi) ke backend
│       └── script.js              <- UI screening & render hasil
├── server/
│   ├── server.js           <- entry point Express
│   ├── db.js                <- koneksi PostgreSQL (pg Pool)
│   ├── auth.js               <- bcrypt & JWT helpers
│   ├── middleware.js          <- requireAuth, requireAdmin, rate limiter, validator
│   └── routes/
│       ├── auth.routes.js
│       ├── users.routes.js
│       └── screening.routes.js
└── sql/
    └── schema.sql           <- DDL semua tabel (users, screening_*, dst.)
```

## 1. Instalasi

```bash
npm install
cp .env.example .env
# lalu edit .env: isi DATABASE_URL & JWT_SECRET
```

## 2. Buat Database (CockroachDB)

Buat cluster CockroachDB (Serverless gratis cukup), ambil connection
string-nya, tempel ke `DATABASE_URL` di `.env`. Lalu jalankan skema:

```bash
psql "$DATABASE_URL" -f sql/schema.sql
```

CockroachDB adalah satu-satunya database AtlasJiwa: menyimpan akun
pengguna (`users`) untuk login/register, dan skor screening kuantitatif
(`screening_results`). Tidak menyimpan jawaban naratif, hasil NLP,
ringkasan AI, prompt AI, maupun embedding.

## 3. Jalankan Server

```bash
npm start
# atau untuk auto-restart saat development:
npm run dev
```

Buka `http://localhost:3000` — otomatis diarahkan ke `login.html`.
Tidak ada layanan tambahan yang perlu dijalankan — fitur "Konsultasi
Singkat dengan Atlas Jiwa AI" berjalan sepenuhnya di browser lewat
`public/js/ai-adapter.js` (lihat §8), tanpa Ollama/FastAPI.

## 4. Membuat Akun Admin Pertama

Tidak ada UI khusus "buat admin" (sesuai spesifikasi, register selalu
membuat role `user`). Cara membuat admin pertama:

1. Daftar akun biasa lewat `login.html` (tab Daftar).
2. Naikkan role-nya langsung lewat SQL:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'email_anda@contoh.com';
   ```
3. Login ulang — akun tsb sekarang bisa membuka `admin.html`.

## 5. Alur Autentikasi

- Login mengirim `POST /api/auth/login`, server men-set cookie
  **httpOnly** berisi JWT (nama cookie: `atlas_session`).
- Frontend TIDAK PERNAH menyimpan token secara manual (tidak ada
  `localStorage.setItem('token', ...)`) — browser mengirim cookie itu
  otomatis di setiap `fetch(..., { credentials: 'include' })`.
- `public/js/auth-guard.js` dipasang di `<head>` `atlas-jiwa.html`,
  `screening.html`, dan `admin.html`. Script ini memanggil
  `GET /api/auth/profile`; jika gagal (401) -> redirect ke `login.html`.
- `admin.html` punya lapisan tambahan: `public/js/admin.js` mengecek
  `user.role === 'admin'` dari event `atlas:auth-ready`, dan setiap
  endpoint `/api/users/*` & sebagian `/api/screening` divalidasi ulang
  oleh middleware `requireAdmin` di server — jadi proteksi TIDAK hanya
  mengandalkan frontend.

Alur register → hash password (bcrypt) → simpan ke `users` di
CockroachDB → login → verifikasi kredensial → JWT → cookie httpOnly.

## 6. Catatan Keamanan

- Password di-hash dengan **bcrypt** (12 rounds) — tidak pernah
  disimpan/dikirim dalam bentuk plain text setelah registrasi.
- Semua query pakai **parameterized query** (`$1, $2, ...` lewat `pg`)
  — bukan string concatenation — aman dari SQL injection.
- **Helmet** dipasang untuk header keamanan dasar (catatan: CSP
  dinonaktifkan secara default karena memuat Google Fonts CDN;
  konfigurasikan CSP eksplisit sebelum ke produksi — lihat komentar
  di `server/server.js`).
- **express-rate-limit** dipasang dua lapis: limiter ketat khusus
  `/api/auth/login` & `/api/auth/register` (20 req/15 menit), dan
  limiter umum untuk seluruh `/api/*` (300 req/15 menit).
- Cookie sesi: `httpOnly`, `sameSite=lax`, dan `secure=true` otomatis
  saat `NODE_ENV=production` (wajib HTTPS di production).
- `DATABASE_URL` HANYA pernah dibaca oleh `server/db.js` lewat
  `process.env` — tidak pernah dikirim ke frontend dalam bentuk
  apa pun (cek: `grep -r DATABASE_URL public/` seharusnya kosong).
- **Privacy by design:** backend tidak melakukan NLP/inferensi AI
  apa pun, dan tidak ada endpoint yang menerima teks naratif pengguna
  — lihat §8.

## 7. Ringkasan Endpoint API

| Method | Endpoint                  | Auth        | Keterangan                          |
|--------|----------------------------|-------------|--------------------------------------|
| POST   | /api/auth/register          | -           | Daftar akun baru (role: user)        |
| POST   | /api/auth/login              | -           | Login, set cookie sesi               |
| POST   | /api/auth/logout             | login       | Hapus cookie sesi                    |
| GET    | /api/auth/profile             | login       | Profil user yang sedang login        |
| GET    | /api/users?search=            | admin       | Daftar/cari user                     |
| PUT    | /api/users/:id                 | admin       | Edit user                            |
| DELETE | /api/users/:id                 | admin       | Hapus user                           |
| GET    | /api/users/stats/summary        | admin       | Ringkasan dashboard                  |
| POST   | /api/screening                   | login       | Simpan RINGKASAN SKOR screening (bukan jawaban naratif) |
| GET    | /api/screening/:userid            | login/admin | Lihat hasil (milik sendiri/semua)    |
| GET    | /api/screening                     | admin       | Semua hasil (untuk tabel & export)   |

Tidak ada lagi endpoint `/api/agent/*` — backend tidak melakukan
NLP/inferensi AI sama sekali.

## 8. Analisis & Konsultasi AI (100% Client-Side)

Seluruh analisis NLP, ringkasan lintas-jawaban, dan "konsultasi AI"
berjalan di browser. Tidak ada request jaringan ke server untuk fitur
ini, dan tidak ada isi pesan/narasi yang pernah disimpan di database.

```
public/js/keyword-dictionary.js + nlp-engine.js + summary-engine.js
            │  (analisis kualitatif & skor komposit, 100% di browser)
            ▼
public/js/ai-adapter.js        (window.AtlasAIAdapter)
            │  interpret(context) / reply(message, context)
            │  context HANYA berisi data terstruktur:
            │    { score, riskLevel, screeningType, theme, tags, ... }
            │  TIDAK PERNAH membaca database secara langsung
            ▼
public/js/agent-bridge.js      (window.AtlasAgent — dipanggil script.js)
```

- **Pola adapter yang mudah diganti:** `ai-adapter.js` mendefinisikan
  `AI_CONFIG.provider` dan sebuah registry adapter (`local`, `qwen`,
  `gemini`, `openai`, `claude`). Default-nya `local` — heuristik
  berbasis aturan dari `summary-engine.js`, tanpa API key/jaringan
  sama sekali (aman untuk demo). Adapter lain sengaja berupa stub;
  isi implementasi & API key Anda sendiri di sana untuk mengaktifkan
  model eksternal, tanpa perlu mengubah `agent-bridge.js` atau
  `script.js`.
- **Model hanya menerima data kuantitatif/terstruktur** (skor,
  risk band, tema, tag) — bukan kutipan jawaban naratif mentah dari
  database, karena memang tidak pernah dikirim ke server.
- **Deteksi krisis tetap deterministik** (bukan hanya mengandalkan
  interpretasi model AI): `ai-adapter.js` memindai pola frasa krisis
  eksplisit dan ambang skor risiko komposit, lalu menyisipkan rujukan
  layanan darurat — konsisten dengan disclaimer di halaman hasil
  bahwa ini bukan pengganti diagnosis profesional.
- **Skor yang dikirim ke server** (`POST /api/screening`, lihat §7)
  dibentuk oleh `screening-submit.js` dari `overallPercent` +
  `overallLevel` yang sudah dihitung `script.js` — satu baris
  ringkasan per sesi, tanpa jawaban naratif.

`public/js/nlp-engine.js`, `summary-engine.js`, dan
`keyword-dictionary.js` tidak berubah oleh refactor ini —
`ai-adapter.js`/`agent-bridge.js` hanya memanggil fungsi publiknya
(`analyzeQualitative`, `buildOverallSummary`) dari luar.
