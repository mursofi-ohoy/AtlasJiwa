/* =========================================
   ATLAS JIWA — Agent Routes (server/routes/agent.routes.js)
   Menjembatani browser <-> FastAPI (backend/app/agent_api.py), yang
   menjalankan agent konsultasi Qwen via Ollama.

   Kenapa lewat proxy Node, bukan browser -> FastAPI langsung?
   - Mempertahankan arsitektur auth yang sudah ada: browser HANYA
     pernah bicara dengan Node lewat cookie httpOnly `atlas_session`
     (lihat middleware.js requireAuth), tidak pernah menyentuh token
     JWT secara langsung. FastAPI tidak dibuka ke publik sama sekali
     (tetap di 127.0.0.1, tidak perlu CORS/expose port baru).
   - Node membaca ulang req.user (hasil requireAuth) dan menandatangani
     ulang token pendek untuk dikirim sebagai Authorization: Bearer ke
     FastAPI — FastAPI memverifikasinya dengan JWT_SECRET yang sama
     (lihat backend/app/auth.py).

   POST /api/agent/session/init  -> proxy ke FastAPI POST /api/v1/agent/session/init
   POST /api/agent/consult        -> proxy ke FastAPI POST /api/v1/agent/consult
   ========================================= */

const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware');
const { signToken } = require('../auth');

const FASTAPI_BASE_URL = process.env.FASTAPI_BASE_URL || 'http://127.0.0.1:8000';

// Token internal berumur pendek, HANYA dipakai server-to-server untuk
// panggilan proxy ini — bukan token sesi utama pengguna (yang tetap
// di cookie httpOnly dan berumur 2 jam sesuai JWT_EXPIRES_IN).
function signInternalToken(user) {
    return signToken({ id: user.id, username: user.username, role: user.role });
}

async function forwardToFastapi(res, path, user, body) {
    const token = signInternalToken(user);

    let upstream;
    try {
        upstream = await fetch(`${FASTAPI_BASE_URL}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(body),
        });
    } catch (err) {
        console.error(`[Agent Proxy] Gagal menghubungi FastAPI (${path}):`, err.message);
        return res.status(502).json({
            error: 'Layanan konsultasi AI sedang tidak dapat dihubungi. Coba lagi beberapa saat lagi.',
        });
    }

    let data;
    try {
        data = await upstream.json();
    } catch (err) {
        return res.status(502).json({ error: 'Respons layanan konsultasi AI tidak valid.' });
    }

    if (!upstream.ok) {
        return res.status(upstream.status).json({
            error: data.detail || data.error || 'Layanan konsultasi AI menolak permintaan.',
        });
    }

    return res.json(data);
}

// ---------------------------------------------------------
// POST /api/agent/session/init
// Body: { screening_type, context: {...ScreeningContext dari summary-engine.js} }
// ---------------------------------------------------------
router.post('/session/init', requireAuth, async (req, res) => {
    const { screening_type, context } = req.body || {};
    if (!context || typeof context !== 'object') {
        return res.status(400).json({ error: 'context wajib diisi (ringkasan hasil screening).' });
    }
    return forwardToFastapi(res, '/api/v1/agent/session/init', req.user, {
        screening_type: screening_type || null,
        context,
    });
});

// ---------------------------------------------------------
// POST /api/agent/consult
// Body: { message, session_id?, context?: {...NarrativeContext dari nlp-engine.js} }
// ---------------------------------------------------------
router.post('/consult', requireAuth, async (req, res) => {
    const { message, session_id, context } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message wajib diisi.' });
    }
    return forwardToFastapi(res, '/api/v1/agent/consult', req.user, {
        message,
        session_id: session_id || null,
        context: context || null,
    });
});

module.exports = router;
