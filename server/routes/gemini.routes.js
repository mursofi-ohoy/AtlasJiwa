/* =========================================
   ATLAS JIWA — Gemini Routes (server/routes/gemini.routes.js)
   -----------------------------------------------------------
   Bertugas HANYA:
     1. requireAuth        (pakai user login yang sudah ada)
     2. validasi topic & payload
     3. rate limit (in-memory, khusus endpoint ini)
     4. memanggil gemini.service.js dan meneruskan hasil/errornya

   TIDAK ADA logika AI di sini (system prompt, pemanggilan Gemini API,
   retry, dsb ada di services/gemini.service.js & gemini-prompts.js).

   ASUMSI: `requireAuth` diekspor dari '../middleware' (satu modul
   yang sama dengan `apiLimiter` yang sudah dipakai di server.js).
   Jika middleware auth project berada di file lain, sesuaikan baris
   require di bawah — tidak ada bagian lain yang perlu diubah.
   ========================================= */

'use strict';

const express = require('express');
const { requireAuth } = require('../middleware');
const geminiService = require('../services/gemini.service');
const { normalizeTopic, VALID_TOPICS } = require('../services/gemini-prompts');

const router = express.Router();

// ---------------------------------------------------------
// Rate limiter ringan khusus /api/ai (tanpa dependency baru).
// Membatasi per user (req.user.id jika ada) atau per IP sebagai
// fallback, sliding window sederhana di memori proses.
// Catatan: untuk deployment multi-instance, ganti dengan store
// bersama (mis. Redis) — di luar scope perubahan ini.
// ---------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 menit
const RATE_LIMIT_MAX = 12; // maksimal 12 request/menit per user

const rateBuckets = new Map();

function aiRateLimiter(req, res, next) {
    const key = (req.user && (req.user.id || req.user.userId)) || req.ip || 'anonymous';
    const now = Date.now();
    const bucket = rateBuckets.get(key) || [];
    const recent = bucket.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);

    if (recent.length >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Terlalu banyak permintaan ke konsultasi AI. Coba lagi sebentar lagi.' });
    }

    recent.push(now);
    rateBuckets.set(key, recent);

    // Housekeeping ringan supaya Map tidak tumbuh tanpa batas.
    if (rateBuckets.size > 5000) {
        const cutoff = now - RATE_LIMIT_WINDOW_MS;
        for (const [k, v] of rateBuckets) {
            const stillValid = v.filter((ts) => ts > cutoff);
            if (stillValid.length === 0) rateBuckets.delete(k);
            else rateBuckets.set(k, stillValid);
        }
    }

    next();
}

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
