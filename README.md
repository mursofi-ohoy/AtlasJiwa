ATLAS JIWA — Full-Stack Setup

Platform edukasi & screening psikologi untuk memahami pola kendali impuls dan perilaku adiktif.

Frontend statis (HTML/CSS/Vanilla JS) + backend Node.js/Express + PostgreSQL (CockroachDB).

## Arsitektur Terbaru

- Backend utama Node.js/Express menangani autentikasi pengguna, otorisasi,
  penyimpanan hasil screening kuantitatif, serta menjadi AI gateway untuk
  fitur konsultasi Gemini.

- Analisis NLP kualitatif, ekstraksi pola perilaku, explainable scoring,
  dan ringkasan screening dilakukan lokal di browser menggunakan:
  `keyword-dictionary.js`, `nlp-engine.js`, dan `summary-engine.js`.

- Fitur "Konsultasi Singkat dengan Atlas Jiwa AI" menggunakan Google Gemini
  API melalui backend Express (`gemini.routes.js` + `gemini.service.js`).

- Backend hanya meneruskan konteks screening terstruktur kepada Gemini
  (score, risk level, tema, tags), bukan jawaban naratif mentah pengguna.

- Database CockroachDB hanya menyimpan akun pengguna dan hasil screening
  kuantitatif.

- Backend FastAPI + Ollama/Qwen yang sebelumnya digunakan untuk eksperimen
  AI telah dihentikan dan tidak termasuk dalam arsitektur produksi.

## Struktur Project

```
atlas-jiwa/
├── .env.example
├── package.json
│
├── public/
│   ├── login.html
│   ├── atlas-jiwa.html
│   ├── screening.html
│   ├── admin.html
│   │
│   ├── css/
│   │
│   └── js/
│       ├── keyword-dictionary.js
│       │       <- kamus axis NLP kualitatif
│       │
│       ├── nlp-engine.js
│       │       <- rule-based NLP semantic analysis
│       │
│       ├── summary-engine.js
│       │       <- composite risk scoring & summary
│       │
│       ├── ai-adapter.js
│       │       <- adapter komunikasi frontend ke backend Gemini Gateway.
│       │
│       ├── screening-submit.js
│       │       <- kirim hasil screening terstruktur
│       │
│       ├── auth-guard.js
│       │       <- proteksi halaman autentikasi
│       │
│       ├── admin.js
│       │       <- dashboard admin logic
│       │
│       └── script.js
│               <- UI screening & rendering hasil
│
├── server/
│   ├── server.js
│   │       <- Express API entry point
│   │
│   ├── db.js
│   │       <- PostgreSQL connection pool CockroachDB
│   │
│   ├── auth.js
│   │       <- bcrypt & JWT helper
│   │
│   ├── middleware.js
│   │       <- auth, admin, validator, rate limiter
│   │
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── users.routes.js
│   │   ├── screening.routes.js
│   │   └── gemini.routes.js
│   │
│   └── services/
│         │
│         ├── gemini.service.js    <- Gemini API integration
│         │
│         └── gemini-prompts.js   <- system prompt dan AI behavior rules
│
└── sql/
     └── schema.sql

```
---

## Lapisan Arsitektur

### 1. Frontend Client-Side Layer

Frontend menjalankan analisis NLP secara lokal di browser.

Komponen:

```
keyword-dictionary.js
+
nlp-engine.js
+
summary-engine.js

```

Fungsi:

- semantic keyword analysis;
- axis detection;
- behavioral pattern extraction;
- composite risk scoring;
- screening summary generation.

Jawaban naratif pengguna diproses lokal dan tidak dikirim sebagai raw text
ke backend.
---

### 2. Backend Application Layer

Node.js/Express bertanggung jawab untuk:

- autentikasi pengguna;
- JWT session management;
- role authorization;
- penyimpanan hasil screening;
- AI gateway untuk Gemini.

Backend tidak melakukan NLP screening.

Proses NLP kualitatif, ekstraksi pola perilaku, explainable scoring,
dan pembuatan ringkasan screening dilakukan sepenuhnya di sisi client
(browser) menggunakan:
- keyword-dictionary.js
- nlp-engine.js
- summary-engine.js

Backend hanya menerima:

```
{
overallPercent,
overallLevel,
screeningType,
metadata
}

```
untuk penyimpanan database.
---

### 3. Gemini AI Gateway Layer

Konsultasi AI menggunakan:

```
Frontend Browser

```
    |
    ▼
```

POST /api/ai/consult

```
    |
    ▼
```

server/routes/gemini.routes.js

```
    |
    ▼
```

server/services/gemini.service.js

```
    |
    ▼
```

Google Gemini API

```

`gemini.routes.js` bertugas:

- autentikasi request;
- validasi topic;
- validasi message;
- sanitasi history chat;
- validasi screeningContext;
- rate limiting konsultasi AI.

`gemini.service.js` bertugas:

- membuat request ke Gemini API;
- menyusun system prompt;
- menggabungkan screening context;
- mengembalikan response AI.

Gemini tidak menghitung ulang screening.

Gemini hanya menerima konteks:

```
{
screeningType,
riskLevel,
score,
theme,
tags
}

```

---
# Privacy by Design

CockroachDB menyimpan:

```

users
screening_results

```

Tidak menyimpan:

- jawaban naratif pengguna;
- raw NLP output;
- prompt AI;
- embedding;
- history konsultasi AI (tidak disimpan permanen di database);
- hasil analisis AI yang tidak disimpan.

---
# Screening Pipeline

```

User Answers

```
  |
  ▼
```

Client NLP Engine

```
  |
  ▼
```

Summary Engine

```
  |
  ▼
```

Risk Score + Structured Summary

```
  |
  ▼
```

Node.js Express API

```
  |
  ▼
```

CockroachDB

```


# AI Consultation Pipeline

```

User Message

```
  |
  ▼
```

Node.js Gemini Gateway

```
  |
  ▼
```

Gemini API

```
  |
  ▼
```

AI Response

```

Dengan arsitektur ini:

- NLP tetap ringan dan explainable;
- data naratif tetap berada di browser;
- database hanya menyimpan data kuantitatif;
- Gemini digunakan sebagai pendamping edukasi/refleksi;
- backend memiliki kontrol keamanan terhadap request AI.
```
---
