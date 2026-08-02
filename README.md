# ATLAS JIWA — Full-Stack Setup

Platform edukasi & screening psikologi kendali impuls/adiksi.
Frontend statis (HTML/CSS/Vanilla JS) + backend Node.js/Express +
PostgreSQL (CockroachDB).

## Struktur Project

```
atlas-jiwa/
├── .env.example                 <- config Node (lihat juga backend/.env.example)
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
│       ├── agent-bridge.js        <- jembatan ke konsultasi AI (§8)
│       └── script.js              <- UI screening & render hasil
├── server/
│   ├── server.js           <- entry point Express
│   ├── db.js                <- koneksi PostgreSQL (pg Pool)
│   ├── auth.js               <- bcrypt & JWT helpers
│   ├── middleware.js          <- requireAuth, requireAdmin, rate limiter, validator
│   └── routes/
│       ├── auth.routes.js
│       ├── users.routes.js
│       ├── screening.routes.js
│       └── agent.routes.js        <- proxy ke backend/ FastAPI (§8)
├── backend/                 <- layanan kedua: FastAPI + Ollama/Qwen (§8)
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── auth.py                <- verifikasi JWT yang sama dengan Node
│       ├── database.py            <- pool psycopg + helper agent_sessions/messages
│       ├── models.py
│       ├── risk_engine.py         <- deteksi krisis deterministik
│       ├── prompt_builder.py      <- susun prompt Qwen dari konteks NLP
│       ├── ollama_client.py
│       └── agent_api.py           <- POST /api/v1/agent/session/init, /consult
└── sql/
    └── schema.sql           <- DDL semua tabel (users, screening_*, agent_*, dst.)
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

## 3. Jalankan Server

```bash
npm start
# atau untuk auto-restart saat development:
npm run dev
```

Buka `http://localhost:3000` — otomatis diarahkan ke `login.html`.

### 2.1 Menjalankan Backend Konsultasi AI (opsional, untuk fitur §8)

Fitur "Konsultasi Singkat dengan Atlas Jiwa AI" di halaman hasil
screening butuh dua layanan tambahan berjalan bersamaan dengan Node:

```bash
# 1) Ollama harus sudah terinstal & modelnya sudah di-pull
ollama pull qwen3:4b
ollama serve                 # default di 127.0.0.1:11434

# 2) FastAPI (di terminal terpisah)
cd backend
python -m venv venv && source venv/bin/activate   # atau venv\Scripts\activate di Windows
pip install -r requirements.txt
cp .env.example .env         # isi DATABASE_URL & JWT_SECRET (SAMA dengan .env Node)
uvicorn app.main:app --reload --port 8000
```

Jika Ollama/FastAPI tidak berjalan, halaman hasil screening tetap
berfungsi normal (skor & analisis naratif tetap tampil) — panel chat
hanya akan menampilkan pesan "Tidak tersedia saat ini".

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
| POST   | /api/screening                   | login       | Simpan hasil screening               |
| GET    | /api/screening/:userid            | login/admin | Lihat hasil (milik sendiri/semua)    |
| GET    | /api/screening                     | admin       | Semua hasil (untuk tabel & export)   |
| POST   | /api/agent/session/init            | login       | Buka sesi konsultasi AI dari ringkasan screening (proxy ke FastAPI) |
| POST   | /api/agent/consult                  | login       | Kirim pesan chat ke Atlas Jiwa AI (proxy ke FastAPI)               |

## 8. Integrasi Konsultasi AI (JS NLP → FastAPI → Qwen/Ollama)

Selain jalur Node/PostgreSQL di atas, project ini juga punya backend
kedua di `backend/` (FastAPI + Ollama/Qwen) untuk fitur konsultasi AI
singkat di halaman hasil screening. Alurnya:

```
public/js/nlp-engine.js + summary-engine.js   (analisis kualitatif, di browser)
            │  (hasil analisis diratakan jadi payload ringkas)
            ▼
public/js/agent-bridge.js                     (window.AtlasAgent)
            │  fetch('/api/agent/...', { credentials: 'include' })
            ▼
server/routes/agent.routes.js                 (proxy Node, requireAuth)
            │  forward + Authorization: Bearer <JWT re-signed>
            ▼
backend/app/agent_api.py  (FastAPI)
            │  risk_engine.py (deteksi krisis) + prompt_builder.py (susun prompt)
            ▼
backend/app/ollama_client.py  →  Ollama (model qwen3:4b)
```

- **Kenapa lewat proxy Node, bukan browser → FastAPI langsung?** Supaya
  arsitektur auth yang sudah ada (cookie httpOnly `atlas_session`,
  lihat §5) tetap satu-satunya jalur yang disentuh browser. FastAPI
  tidak pernah diekspos ke publik; ia memverifikasi ulang JWT yang
  sama (`JWT_SECRET` **harus identik** di `.env` root & `backend/.env`
  — lihat `.env.example` di masing-masing folder).
- **Dua endpoint:** `POST /api/agent/session/init` (dipanggil sekali
  setelah screening selesai, membawa ringkasan dari
  `AtlasSummaryEngine.buildOverallSummary()`) dan
  `POST /api/agent/consult` (dipanggil tiap pesan chat, membawa
  analisis `AtlasNLPEngine.analyzeQualitative()` untuk pesan itu).
- **Riwayat & skor risiko** tiap sesi/pesan disimpan ke tabel baru
  `agent_sessions` / `agent_messages` (lihat `sql/schema.sql`).
- **Lapisan keamanan tambahan:** `backend/app/risk_engine.py`
  mendeteksi indikasi krisis secara deterministik (bukan hanya
  mengandalkan interpretasi LLM) dari skor risiko komposit sisi klien
  maupun pola frasa eksplisit, lalu menyisipkan instruksi prioritas
  rujukan darurat ke prompt Qwen — konsisten dengan disclaimer di §
  screening.html bahwa ini bukan pengganti diagnosis profesional.

**File yang diubah/ditambah untuk fitur ini:** `public/js/script.js`
(menambahkan panel chat di halaman hasil, TIDAK mengubah logika
skor/kamus NLP yang sudah ada), `public/css/style.css` (menambah gaya
panel chat di akhir file), `public/js/agent-bridge.js` (baru),
`server/routes/agent.routes.js` (baru), seluruh isi `backend/app/`,
dan `sql/schema.sql` (menambah tabel `agent_sessions`,
`agent_messages`, serta `screening_results` yang sebelumnya dipakai
kode Node namun belum terdefinisi di file ini).

`public/js/nlp-engine.js`, `summary-engine.js`, dan
`keyword-dictionary.js` **tidak diubah isinya** oleh perubahan ini —
`agent-bridge.js` hanya memanggil fungsi publiknya
(`analyzeQualitative`, `buildOverallSummary`) dari luar.
