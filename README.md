# ATLAS JIWA — Full-Stack Setup

An educational platform and pre-clinical behavioral screening system designed to help users understand impulse control patterns and addictive behaviors.

Static frontend (HTML/CSS/Vanilla JavaScript) + Node.js/Express backend + PostgreSQL (CockroachDB).

## Latest Architecture

The primary Node.js/Express backend is responsible for user authentication, authorization, structured screening result storage, and serving as the AI gateway for Google Gemini consultations.

Qualitative NLP analysis, behavioral pattern extraction, explainable scoring, and screening summary generation are performed locally in the browser using an **Explainable Rule-Based NLP Engine**, consisting of:

* `keyword-dictionary.js`
* `nlp-engine.js`
* `summary-engine.js`

The **"Brief Consultation with Atlas Jiwa AI"** feature is powered by the Google Gemini API through the Express backend (`gemini.routes.js` + `gemini.service.js`).

`public/js/ai-adapter.js` sends:

* `topic`
* `message`
* `history` (optional)
* `screeningContext` (structured)

`public/js/ai-adapter.js` does **not** send:

* raw narrative screening responses;
* raw NLP outputs.

The backend forwards only `topic`, `message`, optional `history`, and structured `screeningContext` to Gemini. Raw narrative screening responses are never transmitted.

CockroachDB stores only user accounts and structured screening outcomes, including quantitative scores and summarized analytical metadata.

---

# Project Structure

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
 │       │       <- Explainable Rule-Based NLP keyword dictionary
 │       │
 │       ├── nlp-engine.js
 │       │       <- semantic analysis engine
 │       │
 │       ├── summary-engine.js
 │       │       <- composite scoring & structured summary
 │       │
 │       ├── ai-adapter.js
 │       │       <- frontend AI communication adapter
 │       │       <- sends topic, message, history, and screeningContext
 │       │
 │       ├── screening-submit.js
 │       │       <- submits structured screening results
 │       │
 │       ├── auth-guard.js
 │       │       <- authentication guard
 │       │
 │       ├── admin.js
 │       │       <- admin dashboard logic
 │       │
 │       └── script.js
 │               <- screening UI & result rendering
 │
 ├── server/
 │   ├── server.js
 │   │       <- Express API entry point
 │   │
 │   ├── db.js
 │   │       <- CockroachDB PostgreSQL connection
 │   │
 │   ├── auth.js
 │   │       <- bcrypt & JWT helpers
 │   │
 │   ├── middleware.js
 │   │       <- authentication, authorization, validation, rate limiting
 │   │
 │   ├── routes/
 │   │   ├── auth.routes.js
 │   │   ├── users.routes.js
 │   │   ├── screening.routes.js
 │   │   └── gemini.routes.js
 │   │
 │   └── services/
 │         ├── gemini.service.js
 │         └── gemini-prompts.js
 │
 └── sql/
      └── schema.sql
```

---

# Architecture Layers

## 1. Frontend Client-Side Layer

The frontend executes the **Explainable Rule-Based NLP Engine** entirely within the browser.

Components:

```text
keyword-dictionary.js
+
nlp-engine.js
+
summary-engine.js
```

Responsibilities:

* semantic keyword analysis
* behavioral axis detection
* behavioral pattern extraction
* composite behavioral risk scoring
* structured screening summary generation

Narrative screening responses are processed locally and never transmitted as raw text.

---

## 2. Backend Application Layer

The Node.js/Express backend is responsible for:

* user authentication
* JWT session management
* role-based authorization
* structured screening result storage
* API sanitization
* request size limitation
* error handling
* AI gateway for Gemini

The backend does **not** perform behavioral NLP analysis.

All qualitative NLP, behavioral pattern extraction, explainable scoring, and structured summary generation are executed locally by the browser.

### Structured Screening Endpoint

```json
{
  "overallPercent": 0,
  "overallLevel": "",
  "screeningType": "",
  "metadata": {}
}
```

### AI Consultation Endpoint

```json
{
  "topic": "",
  "message": "",
  "history": [],
  "screeningContext": {}
}
```

`screeningContext` contains summarized structured screening information rather than raw user narratives.

---

## 3. Gemini AI Gateway Layer

AI consultations are performed through Google Gemini using the Express backend.

Communication flow:

```text
Frontend Browser
        │
        ▼
public/js/ai-adapter.js
        │
        ▼
POST /api/ai/consult
        │
        ▼
server/routes/gemini.routes.js
        │
        ▼
server/services/gemini.service.js
        │
        ▼
Google Gemini API
```

`gemini.routes.js` handles:

* authentication
* topic validation
* message validation
* chat history sanitization
* screeningContext validation
* AI rate limiting
* request size limitation
* secure error handling

`gemini.service.js` is responsible for:

* building Gemini requests
* composing system prompts
* injecting structured screening context
* handling Gemini responses and errors

Gemini **does not** recalculate screening results.

Instead, it receives structured context such as:

```json
{
  "screeningType": "",
  "riskLevel": "",
  "score": 0,
  "theme": "",
  "tags": []
}
```

Narrative screening responses remain entirely on the client and are processed by the Explainable Rule-Based NLP Engine.

---

# AI Safety Boundary

Atlas Jiwa AI is designed as an educational and self-reflection assistant.

It does **not**:

* provide medical diagnoses;
* replace licensed mental health professionals;
* determine a user's psychological condition.

The AI delivers educational guidance based solely on the structured context provided.

---

# AI Endpoint

| Method | Endpoint          | Authentication | Purpose                                                 |
| ------ | ----------------- | -------------- | ------------------------------------------------------- |
| POST   | `/api/ai/consult` | Required       | Brief consultation with Atlas Jiwa AI via Google Gemini |

---

# Privacy by Design

CockroachDB stores only:

* `users`
* `screening_results`

Stored data consists exclusively of user accounts, quantitative screening outcomes, and summarized analytical metadata.

The system does **not** permanently store:

* raw narrative screening responses
* raw NLP outputs
* AI prompts
* AI conversation history
* embeddings
* temporary AI-generated analyses

System prompts reside within the application source code (e.g., `server/services/gemini-prompts.js`) rather than inside the database.

Chat history may exist temporarily during a Gemini request but is never stored permanently.

---

# Screening Pipeline

```text
User Responses
      │
      ▼
Explainable Rule-Based NLP Engine
      │
      ▼
Summary Engine
      │
      ▼
Risk Score + Structured Summary
      │
      ▼
Node.js / Express API
      │
      ▼
CockroachDB
```

---

# AI Consultation Pipeline

```text
User Message + Screening Context
            │
            ▼
Frontend (ai-adapter.js)
            │
            ▼
POST /api/ai/consult
            │
            ▼
gemini.routes.js
(Authentication, Validation, Sanitization, Rate Limiting)
            │
            ▼
gemini.service.js
(System Prompt + Structured Screening Context)
            │
            ▼
Google Gemini API
            │
            ▼
Educational AI Response
```

---

# Core Architectural Principles

This architecture ensures that:

* Explainable NLP remains lightweight and fully client-side.
* Narrative user responses never leave the browser.
* The database stores only structured screening outcomes.
* Google Gemini serves as an educational and self-reflection assistant.
* The backend enforces authentication, validation, and AI request security.
* The Explainable Rule-Based NLP Engine remains the primary reasoning engine.
* Large Language Models complement, rather than replace, the explainable behavioral analysis pipeline.
