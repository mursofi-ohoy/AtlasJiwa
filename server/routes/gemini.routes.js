/* =========================================
   ATLAS JIWA — Gemini Routes (server/routes/gemini.routes.js)
   -----------------------------------------------------------
   Bertugas HANYA:
     1. requireAuth        (dari server/middleware.js — sama seperti rute lain)
     2. validasi topic & payload
     3. rate limit khusus endpoint ini (express-rate-limit, konsisten
        dengan authLimiter/apiLimiter di server/middleware.js)
     4. memanggil gemini.service.js dan meneruskan hasil/errornya

   TIDAK ADA logika AI di sini (system prompt, pemanggilan Gemini API,
   retry, dsb ada di services/gemini.service.js & gemini-prompts.js).
   ========================================= */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware');
const geminiService = require('../services/gemini.service');
const { normalizeTopic, VALID_TOPICS } = require('../services/gemini-prompts');

const router = express.Router();

// ---------------------------------------------------------
// Rate limiter khusus /api/ai/consult — lebih ketat daripada apiLimiter
// umum (300/15 menit) karena tiap request memanggil Gemini API (biaya +
// latensi lebih tinggi). Key per-user (req.user.id, tersedia setelah
// requireAuth) supaya satu user rakus tidak menghabiskan jatah user lain;
// fallback ke IP kalau req.user entah kenapa kosong.
// ---------------------------------------------------------
const aiRateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 12, // maksimal 12 pesan konsultasi AI / menit / user
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => (req.user && req.user.id) || req.ip,
    message: { error: 'Terlalu banyak permintaan ke konsultasi AI. Coba lagi sebentar lagi.' },
});

// ---------------------------------------------------------
// Validasi payload
// ---------------------------------------------------------
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY_TURNS = 10; // guard server-side; klien sendiri sudah batasi 5 (agent-bridge.js)

function validateConsultBody(req, res, next) {
    const { topic, message, history } = req.body || {};

    const normalizedTopic = normalizeTopic(topic);
    if (!normalizedTopic) {
        return res.status(400).json({
            error: `Topic tidak valid. Topic yang didukung: ${VALID_TOPICS.join(', ')}.`,
        });
    }

    if (typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Field "message" wajib diisi.' });
    }
    if (message.length > MAX_MESSAGE_LEN) {
        return res.status(400).json({ error: `Pesan terlalu panjang (maks ${MAX_MESSAGE_LEN} karakter).` });
    }

    if (history !== undefined) {
        if (!Array.isArray(history)) {
            return res.status(400).json({ error: 'Field "history" harus berupa array.' });
        }
        const invalidTurn = history.some(
            (t) => !t || typeof t.text !== 'string' || !['user', 'assistant'].includes(t.role)
        );
        if (invalidTurn) {
            return res.status(400).json({ error: 'Setiap item "history" wajib punya { role: "user"|"assistant", text }.' });
        }
    }

    req.body.topic = normalizedTopic;
    req.body.history = (history || []).slice(-MAX_HISTORY_TURNS);
    next();
}

// ---------------------------------------------------------
// POST /api/ai/consult
// ---------------------------------------------------------
router.post('/consult', requireAuth, aiRateLimiter, validateConsultBody, async (req, res) => {
    const { topic, message, history } = req.body;

    try {
        const replyText = await geminiService.consult({ topic, message, history });
        return res.json({ reply: replyText, topic });
    } catch (err) {
        const code = (err && err.code) || 'server_error';
        console.error('[Gemini] Konsultasi gagal:', code, err && err.message);

        // Kode error dipetakan konsisten supaya public/js/ai-adapter.js bisa
        // memutuskan kapan harus fallback ke LocalHeuristicAdapter.
        const statusByCode = {
            invalid_key: 502,
            quota: 429,
            timeout: 504,
            network: 502,
            bad_response: 502,
            server_error: 502,
        };

        return res.status(statusByCode[code] || 500).json({
            error: 'Konsultasi AI (Gemini) sedang tidak dapat diakses.',
            code,
        });
    }
});

module.exports = router;
