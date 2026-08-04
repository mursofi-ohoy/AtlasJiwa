/* =========================================
ATLAS JIWA — AI Routes (server/routes/ai.routes.js)

Endpoint:
POST /api/ai/consult

Bertugas HANYA:
1. requireAuth (dari server/middleware.js)
2. validasi topic, message, history, dan screeningContext
3. rate limit khusus endpoint AI
4. memanggil gemini.service.js dan meneruskan hasil/error

Kontrak payload:
{
  topic: string,
  message: string,
  history?: Array<{ role: 'user'|'assistant', text: string }>,
  screeningContext?: {
    screeningType?: string,
    riskLevel?: string,
    score?: number,
    theme?: string,
    interpretation?: string,
    tags?: string[]
  }
}

screeningContext TIDAK dikirim sebagai history chat.
Backend menggabungkannya ke system prompt Gemini di gemini.service.js.
========================================= */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware');
const geminiService = require('../services/gemini.service');
const { normalizeTopic, VALID_TOPICS } = require('../services/gemini-prompts');

const router = express.Router();

// ---------------------------------------------------------
// Rate limiter khusus /api/ai/consult.
// Lebih ketat daripada apiLimiter umum karena tiap request
// memanggil Gemini API (biaya + latensi lebih tinggi).
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
const MAX_HISTORY_TURNS = 10;
const MAX_HISTORY_ITEM_LEN = 2000;
const MAX_HISTORY_CHARS = 6000;
const MAX_SCREENING_CONTEXT_STRING_LEN = 3000;

function sanitizeHistory(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    const validTurns = history.filter((turn) => {
        return (
            turn &&
            ['user', 'assistant'].includes(turn.role) &&
            typeof turn.text === 'string'
        );
    });

    const limited = [];
    let totalChars = 0;

    for (let i = validTurns.length - 1; i >= 0; i -= 1) {
        const text = String(validTurns[i].text)
            .slice(0, MAX_HISTORY_ITEM_LEN)
            .trim();

        if (!text) continue;

        if (totalChars + text.length > MAX_HISTORY_CHARS) {
            break;
        }

        limited.unshift({
            role: validTurns[i].role,
            text,
        });

        totalChars += text.length;
    }

    return limited.slice(-MAX_HISTORY_TURNS);
}

function buildSanitizedScreeningContext(input) {
    if (input === undefined || input === null) {
        return { value: undefined };
    }

    // String tetap diterima untuk backward compatibility.
    if (typeof input === 'string') {
        const text = input.trim().slice(0, MAX_SCREENING_CONTEXT_STRING_LEN);
        return { value: text || undefined };
    }

    if (typeof input !== 'object' || Array.isArray(input)) {
        return {
            error: 'Field "screeningContext" harus berupa objek atau string.',
        };
    }

    const out = {};

    const stringFields = [
        ['screeningType', 100],
        ['riskLevel', 100],
        ['theme', 500],
        ['interpretation', 2000],
    ];

    for (const [key, maxLen] of stringFields) {
        if (input[key] !== undefined && input[key] !== null) {
            if (typeof input[key] !== 'string') {
                return {
                    error: `Field "screeningContext.${key}" harus berupa string.`,
                };
            }

            const value = input[key].trim().slice(0, maxLen);
            if (value) out[key] = value;
        }
    }

    if (input.score !== undefined && input.score !== null) {
        const score = Number(input.score);

        if (!Number.isFinite(score)) {
            return {
                error: 'Field "screeningContext.score" harus berupa angka.',
            };
        }

        out.score = Math.max(0, Math.min(100, score));
    }

    if (input.tags !== undefined && input.tags !== null) {
        if (!Array.isArray(input.tags)) {
            return {
                error: 'Field "screeningContext.tags" harus berupa array of string.',
            };
        }

        const tags = [];

        for (const tag of input.tags.slice(0, 20)) {
            if (typeof tag !== 'string') {
                return {
                    error: 'Setiap item pada "screeningContext.tags" harus berupa string.',
                };
            }

            const value = tag.trim().slice(0, 100);
            if (value) tags.push(value);
        }

        if (tags.length) out.tags = tags;
    }

    return {
        value: Object.keys(out).length ? out : undefined,
    };
}

function validateConsultBody(req, res, next) {
    const { topic, message, history, screeningContext } = req.body || {};

    const normalizedTopic = normalizeTopic(topic);

    if (!normalizedTopic) {
        return res.status(400).json({
            error: `Topic tidak valid. Topic yang didukung: ${VALID_TOPICS.join(', ')}.`,
        });
    }

    if (typeof message !== 'string') {
        return res.status(400).json({
            error: 'Field "message" wajib berupa string.',
        });
    }

    const normalizedMessage = message.trim();

    if (!normalizedMessage) {
        return res.status(400).json({
            error: 'Field "message" wajib diisi.',
        });
    }

    if (normalizedMessage.length > MAX_MESSAGE_LEN) {
        return res.status(400).json({
            error: `Pesan terlalu panjang (maks ${MAX_MESSAGE_LEN} karakter).`,
        });
    }

    if (history !== undefined) {
        if (!Array.isArray(history)) {
            return res.status(400).json({
                error: 'Field "history" harus berupa array.',
            });
        }

        const invalidTurn = history.some((t) => {
            return (
                !t ||
                typeof t.text !== 'string' ||
                !['user', 'assistant'].includes(t.role)
            );
        });

        if (invalidTurn) {
            return res.status(400).json({
                error: 'Setiap item "history" wajib punya { role: "user"|"assistant", text }.',
            });
        }
    }

    const screeningContextResult = buildSanitizedScreeningContext(screeningContext);

    if (screeningContextResult.error) {
        return res.status(400).json({
            error: screeningContextResult.error,
        });
    }

    // Pastikan route hanya meneruskan field yang diperbolehkan.
    const sanitizedBody = {
        topic: normalizedTopic,
        message: normalizedMessage,
        history: sanitizeHistory(history || []),
    };

    if (screeningContextResult.value !== undefined) {
        sanitizedBody.screeningContext = screeningContextResult.value;
    }

    req.body = sanitizedBody;

    next();
}

// ---------------------------------------------------------
// POST /api/ai/consult
// ---------------------------------------------------------
router.post('/consult', requireAuth, aiRateLimiter, validateConsultBody, async (req, res) => {
    const { topic, message, history, screeningContext } = req.body;

    try {
        const replyText = await geminiService.consult({
            topic,
            message,
            history,
            screeningContext,
        });

        return res.json({
            reply: replyText,
            topic,
        });
    } catch (err) {
        const code = (err && err.code) || 'server_error';

        console.error('[AI] Konsultasi gagal:', code, err && err.message);

        // Kode error dipetakan konsisten supaya public/js/ai-adapter.js
        // bisa memutuskan kapan harus fallback ke LocalHeuristicAdapter.
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