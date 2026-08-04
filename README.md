# ATLAS JIWA — Full-Stack Setup

Platform edukasi dan pre-clinical behavioral screening untuk memahami pola kendali impuls dan perilaku adiktif.

Frontend statis (HTML/CSS/Vanilla JS) + backend Node.js/Express + PostgreSQL (CockroachDB).

## Arsitektur Terbaru

Backend utama Node.js/Express menangani autentikasi pengguna, otorisasi, penyimpanan hasil screening terstruktur, serta menjadi AI gateway untuk fitur konsultasi Gemini.

Analisis NLP kualitatif, ekstraksi pola perilaku, explainable scoring, dan ringkasan screening dilakukan lokal di browser menggunakan **Explainable Rule-Based NLP Engine** yang terdiri dari:

- `keyword-dictionary.js`
- `nlp-engine.js`
- `summary-engine.js`

Fitur **"Konsultasi Singkat dengan Atlas Jiwa AI"** menggunakan Google Gemini API melalui backend Express (`gemini.routes.js` + `gemini.service.js`).

`public/js/ai-adapter.js` mengirim:

- `topic`
- `message`
- `history` (opsional)
- `screeningContext` (structured)

`public/js/ai-adapter.js` tidak mengirim:

- jawaban naratif screening mentah;
- raw NLP output.

Backend hanya meneruskan `topic`, `message`, `history` (opsional), dan `screeningContext` terstruktur kepada Gemini, bukan jawaban naratif mentah hasil screening.

Database CockroachDB hanya menyimpan akun pengguna dan hasil screening terstruktur berupa nilai kuantitatif serta metadata analisis yang telah diringkas.

## Struktur Project

```text
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
 │       │       <- kamus axis untuk explainable rule-based NLP
 │       │
 │       ├── nlp-engine.js
 │       │       <- explainable rule-based NLP semantic analysis
 │       │
 │       ├── summary-engine.js
 │       │       <- composite risk scoring & structured summary
 │       │
 │       ├── ai-adapter.js
 │       │       <- adapter komunikasi frontend untuk endpoint konsultasi AI (/api/ai/consult).
 │       │       <- mengirim topic, message, history, screeningContext; bukan raw jawaban screening.
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
 │         └── gemini-prompts.js    <- system instructions, safety constraints, response behavior rules
 │
 └── sql/
      └── schema.sql
```

## Lapisan Arsitektur

### 1. Frontend Client-Side Layer

Frontend menjalankan **Explainable Rule-Based NLP Engine** secara lokal di browser.

Komponen:

```text
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

Jawaban naratif pengguna diproses lokal dan tidak dikirim sebagai raw text ke backend.

### 2. Backend Application Layer

Node.js/Express bertanggung jawab untuk:

- autentikasi pengguna;
- JWT session management;
- role authorization;
- penyimpanan hasil screening terstruktur;
- API sanitization;
- request size limitation;
- error handling;
- AI gateway untuk Gemini.

Backend tidak melakukan NLP screening.

Proses NLP kualitatif, ekstraksi pola perilaku, explainable scoring, dan pembuatan ringkasan screening dilakukan sepenuhnya di sisi client/browser menggunakan **Explainable Rule-Based NLP Engine**.

Backend menerima data sesuai endpoint.

Untuk penyimpanan screening melalui `POST /api/screening`:

```text
{
  overallPercent,
  overallLevel,
  screeningType,
  metadata
}
```

Untuk konsultasi Gemini melalui `POST /api/ai/consult`:

```text
{
  topic,
  message,
  history,
  screeningContext
}
```

`screeningContext` adalah ringkasan terstruktur hasil screening dari sisi client, bukan teks jawaban mentah pengguna.

### 3. Gemini AI Gateway Layer

Konsultasi AI menggunakan Google Gemini API melalui backend Express.

Alur komunikasi:

```text
Frontend Browser

        |
        ▼

public/js/ai-adapter.js

        |
        ▼

POST /api/ai/consult

        |
        ▼

server/routes/gemini.routes.js

(auth,
validation,
sanitization,
rate limiting,
request size limitation,
error handling)

        |
        ▼

server/services/gemini.service.js

(system prompt,
screening context,
Gemini request,
response/error handling)

        |
        ▼

Google Gemini API
```

`gemini.routes.js` bertugas:

- autentikasi pengguna;
- validasi topic;
- validasi message;
- sanitasi history chat;
- validasi screeningContext;
- rate limiting penggunaan AI;
- membantu pembatasan ukuran request;
- meneruskan error secara aman ke client.

`gemini.service.js` bertugas:

- membuat request ke Gemini API;
- menyusun system prompt;
- menggabungkan screening context;
- menangani response/error Gemini.

Gemini tidak melakukan perhitungan ulang screening.

Gemini hanya menerima konteks terstruktur:

```json
{
  "screeningType": "",
  "riskLevel": "",
  "score": 0,
  "theme": "",
  "tags": []
}
```

Jawaban naratif screening tetap diproses lokal oleh Explainable Rule-Based NLP Engine.

## AI Safety Boundary

Atlas Jiwa AI dirancang sebagai assistant edukasi dan refleksi.

Sistem tidak:

- memberikan diagnosis medis;
- menggantikan profesional kesehatan mental;
- menentukan kondisi psikologis pengguna.

AI memberikan informasi edukatif berdasarkan konteks yang diberikan pengguna.

## Endpoint AI Gateway

| Method | Endpoint          | Auth  | Fungsi                                  |
| ------ | ----------------- | ----- | --------------------------------------- |
| POST   | `/api/ai/consult` | login | Konsultasi Atlas Jiwa AI melalui Gemini |

## Privacy by Design

CockroachDB menyimpan:

- `users`
- `screening_results`

Data disimpan sebagai akun pengguna dan hasil screening terstruktur berupa nilai kuantitatif serta metadata analisis yang telah diringkas.

Tidak menyimpan:

- jawaban naratif pengguna;
- raw NLP output;
- prompt AI secara permanen di database;
- history konsultasi AI secara permanen;
- embedding;
- hasil analisis AI yang tidak disimpan.

System prompt AI berada di source code, misalnya pada `server/services/gemini-prompts.js`, bukan disimpan di database.

History chat dapat hidup sementara dalam request menuju Gemini, tetapi tidak disimpan secara permanen di database.

## Screening Pipeline

```text
User Answers
|
▼
Explainable Rule-Based NLP Engine
|
▼
Summary Engine
|
▼
Risk Score + Structured Summary
|
▼
Node.js Express API
|
▼
CockroachDB
```

## AI Consultation Pipeline

```text
User Message + Screening Context

        |
        ▼

Frontend ai-adapter.js

        |
        ▼

POST /api/ai/consult

        |
        ▼

gemini.routes.js

(authentication,
validation,
sanitization,
rate limiting,
request size limitation,
error handling)

        |
        ▼

gemini.service.js

(system prompt +
screening context +
Gemini request +
response/error handling)

        |
        ▼

Google Gemini API

        |
        ▼

AI Response
```

## Prinsip Utama Arsitektur

Dengan arsitektur ini:

- NLP tetap ringan dan explainable;
- data naratif tetap berada di browser;
- database hanya menyimpan hasil screening terstruktur;
- Gemini digunakan sebagai pendamping edukasi/refleksi;
- backend memiliki kontrol keamanan terhadap request AI;
- LLM tidak menggantikan reasoning engine;
- LLM menjadi interface edukasi di atas hasil analisis yang explainable.
