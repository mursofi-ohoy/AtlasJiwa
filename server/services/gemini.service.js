/* =========================================
ATLAS JIWA — Gemini Service (server/services/gemini.service.js)

Bertugas SATU hal saja: memanggil Gemini REST API dan
mengembalikan teks balasan, atau melempar error yang sudah
dipetakan ke kode yang bisa dipahami route/frontend.

Hybrid Architecture:
- Screening context diterima sebagai field terpisah `screeningContext`.
- Screening context digabungkan ke system prompt.
- Gemini TIDAK diminta menghitung ulang hasil screening.
- History chat user/assistant tetap dikirim sebagai contents.
- Pesan user terakhir dibungkus dengan penanda:
  === USER QUESTION ===

TIDAK ADA akses database di file ini.
TIDAK ADA logic auth/rate-limit di file ini (itu tugas route).
Requirement: Node.js >= 18 (pakai `fetch` global bawaan Node).
Tidak menambah dependency baru.
========================================= */
'use strict';

const { getSystemPrompt } = require('./gemini-prompts');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// Model bisa dioverride lewat .env (GEMINI_MODEL) tanpa ubah kode,
// karena penamaan model Gemini berubah dari waktu ke waktu.
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const REQUEST_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 10000);
const MAX_RETRIES = 1; // retry ringan: 1x percobaan ulang untuk error transient
const RETRY_DELAY_MS = 400;
const RETRY_JITTER_MS = 150; // sedikit jitter supaya retry tidak "serentak" saat Gemini gangguan massal

// Set true lewat env GEMINI_DEBUG_LOG=1 HANYA di lingkungan development.
// Saat aktif, isi pesan/history akan ikut tercetak ke log (terpotong) —
// JANGAN aktifkan di production karena bisa memuat data sensitif pengguna
// (termasuk hasil screening kesehatan mental).
const DEBUG_LOG = process.env.GEMINI_DEBUG_LOG === '1';

// ---------- Error bertipe, supaya route/frontend bisa map ke pesan/HTTP code ----------
class GeminiServiceError extends Error {
    constructor(code, message, cause) {
        super(message);
        this.name = 'GeminiServiceError';
        this.code = code; // 'invalid_key' | 'quota' | 'timeout' | 'network' | 'server_error' | 'bad_response'
        this.cause = cause;
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Logging helper: seragam, aman (tidak pernah mencetak API key/konten mentah) ----------
const LOG_PREFIX = '[GeminiService]';

function logInfo(...args) {
    console.log(LOG_PREFIX, ...args);
}

function logWarn(...args) {
    console.warn(LOG_PREFIX, ...args);
}

function logError(...args) {
    console.error(LOG_PREFIX, ...args);
}

function truncateForLog(text, maxLen = 1500) {
    const str = String(text ?? '');
    return str.length > maxLen ? `${str.slice(0, maxLen)}…[truncated]` : str;
}

/**
 * Susun teks screening context dari object terstruktur.
 *
 * Jika screeningContext berupa string, gunakan apa adanya untuk
 * backward compatibility.
 */
function buildScreeningContextText(screeningContext) {
    if (!screeningContext) {
        return '';
    }

    if (typeof screeningContext === 'string') {
        return screeningContext.trim().slice(0, 4000);
    }

    if (typeof screeningContext !== 'object' || Array.isArray(screeningContext)) {
        return '';
    }

    const lines = ['=== SCREENING CONTEXT ===', ''];

    const appendField = (label, value) => {
        if (value === undefined || value === null) return;

        const text = String(value).trim();
        if (!text) return;

        lines.push(`${label}:`, text, '');
    };

    appendField('Screening Type', screeningContext.screeningType);
    appendField('Risk Level', screeningContext.riskLevel);

    if (typeof screeningContext.score === 'number' && Number.isFinite(screeningContext.score)) {
        appendField('Composite Score', screeningContext.score);
    }

    appendField('Tema', screeningContext.theme);
    appendField('Interpretasi', screeningContext.interpretation);

    if (Array.isArray(screeningContext.tags) && screeningContext.tags.length) {
        appendField('Tags', screeningContext.tags.join(', '));
    }

    lines.push('Catatan: hasil screening ini dihitung oleh sistem lokal Atlas Jiwa. Jangan menghitung ulang skor atau risk level.');

    return lines.join('\n').slice(0, 4000);
}

/**
 * Susun payload request Gemini dari system prompt + screening context
 * + history + pesan baru.
 *
 * history: array of { role: 'user'|'assistant', text: string }.
 */
function buildRequestBody(systemPrompt, history, message, screeningContext) {
    const contents = [];

    (history || []).forEach((turn) => {
        if (!turn || typeof turn.text !== 'string') return;

        const text = String(turn.text).slice(0, 4000).trim();
        if (!text) return;

        contents.push({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text }],
        });
    });

    const userQuestionText = [
        '=== USER QUESTION ===',
        '',
        String(message).slice(0, 4000),
    ].join('\n');

    contents.push({
        role: 'user',
        parts: [{ text: userQuestionText }],
    });

    const screeningContextText = buildScreeningContextText(screeningContext);

    const finalSystemPrompt = screeningContextText
        ? `${systemPrompt}\n\n${screeningContextText}`
        : systemPrompt;

    return {
        systemInstruction: {
            role: 'system',
            parts: [{ text: finalSystemPrompt }],
        },
        contents,
        generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 512,
        },
    };
}

/**
 * Ekstrak teks balasan dari response JSON Gemini, sekaligus menangani
 * seluruh kasus "200 OK tapi tidak ada jawaban valid":
 * - prompt diblokir (promptFeedback.blockReason)
 * - tidak ada candidates sama sekali
 * - respons diblokir (finishReason SAFETY/RECITATION/dll, parts kosong)
 * - respons terpotong karena maxOutputTokens (MAX_TOKENS) — tetap dikembalikan,
 *   hanya diberi warning log.
 *
 * Semua field diagnostik (promptFeedback, finishReason, safetyRatings)
 * selalu dicatat ke log bila ada, supaya mudah dianalisis.
 */
function extractReplyText(json) {
    if (json && json.promptFeedback) {
        logWarn('promptFeedback:', JSON.stringify(json.promptFeedback));

        if (json.promptFeedback.blockReason) {
            throw new GeminiServiceError(
                'bad_response',
                `Prompt diblokir oleh Gemini (blockReason: ${json.promptFeedback.blockReason}).`
            );
        }
    }

    const candidates = json && Array.isArray(json.candidates) ? json.candidates : [];
    const candidate = candidates[0];

    if (!candidate) {
        throw new GeminiServiceError('bad_response', 'Gemini tidak mengembalikan candidates.');
    }

    if (candidate.finishReason) {
        logInfo('finishReason:', candidate.finishReason);
    }

    if (candidate.safetyRatings) {
        logInfo('safetyRatings:', JSON.stringify(candidate.safetyRatings));
    }

    const parts = candidate.content && candidate.content.parts;
    const text = Array.isArray(parts)
        ? parts.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim()
        : '';

    if (!text) {
        const reason = candidate.finishReason ? ` (finishReason: ${candidate.finishReason})` : '';
        throw new GeminiServiceError('bad_response', `Respons Gemini kosong/diblokir${reason}.`);
    }

    if (candidate.finishReason === 'MAX_TOKENS') {
        logWarn('Respons Gemini terpotong karena mencapai maxOutputTokens (jawaban tetap dikembalikan).');
    }

    return text;
}

async function callGeminiOnce(systemPrompt, history, message, screeningContext) {
    if (!GEMINI_API_KEY) {
        throw new GeminiServiceError('invalid_key', 'GEMINI_API_KEY belum dikonfigurasi di server.');
    }

    // PENTING: jangan pernah log variabel `url` ini — mengandung API key di query string.
    const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;

    const body = buildRequestBody(systemPrompt, history, message, screeningContext);
    const historyCount = Array.isArray(history) ? history.length : 0;

    logInfo('Model:', GEMINI_MODEL);
    logInfo('API key configured:', !!GEMINI_API_KEY);
    logInfo('Timeout(ms):', REQUEST_TIMEOUT_MS);
    logInfo('Message length:', String(message).length);
    logInfo('History turns:', historyCount);
    logInfo('Screening context:', screeningContext ? 'present' : 'none');

    if (DEBUG_LOG) {
        // Opt-in only — bisa memuat konten sensitif pengguna, jangan aktifkan di production.
        logInfo('Request body (debug):', truncateForLog(JSON.stringify(body)));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;

    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        if (err && err.name === 'AbortError') {
            throw new GeminiServiceError('timeout', 'Permintaan ke Gemini melebihi batas waktu.', err);
        }

        throw new GeminiServiceError('network', 'Gagal menghubungi Gemini API (jaringan).', err);
    } finally {
        clearTimeout(timer);
    }

    logInfo('HTTP status:', res.status);

    if (!res.ok) {
        // Baca body response TEPAT SEKALI di sini untuk semua jalur error (401/403/404/429/5xx/lainnya),
        // supaya error body dari Gemini selalu tercatat dan tidak ada risiko double-read.
        let rawErrorBody = '';
        try {
            rawErrorBody = await res.text();
        } catch (readErr) {
            logWarn('Gagal membaca error body dari Gemini:', readErr.message);
        }

        if (rawErrorBody) {
            logError('Gemini error body:', truncateForLog(rawErrorBody, 2000));
        }

        if (res.status === 401 || res.status === 403) {
            throw new GeminiServiceError(
                'invalid_key',
                'API key Gemini tidak valid atau tidak diizinkan.'
            );
        }

        if (res.status === 404) {
            throw new GeminiServiceError(
                'bad_response',
                `Model/endpoint Gemini tidak ditemukan (HTTP 404). Periksa GEMINI_MODEL="${GEMINI_MODEL}".`
            );
        }

        if (res.status === 429) {
            throw new GeminiServiceError('quota', 'Kuota/rate limit Gemini API terlampaui.');
        }

        if (res.status >= 500) {
            throw new GeminiServiceError('server_error', `Gemini API error server (HTTP ${res.status}).`);
        }

        throw new GeminiServiceError('bad_response', `Gemini API menolak permintaan (HTTP ${res.status}).`);
    }

    // Jalur sukses: baca body TEPAT SEKALI sebagai JSON, dengan penanganan malformed JSON.
    let json;
    try {
        json = await res.json();
    } catch (err) {
        logError('Gagal parse JSON dari Gemini:', err.message);
        throw new GeminiServiceError('bad_response', 'Respons Gemini tidak valid (bukan JSON).', err);
    }

    return extractReplyText(json);
}

/**
 * @param {{
 *   topic: string,
 *   message: string,
 *   history?: Array<{role:string,text:string}>,
 *   screeningContext?: object|string
 * }} params
 *
 * @returns {Promise<string>} teks balasan Gemini
 * @throws {GeminiServiceError}
 */
async function consult({ topic, message, history, screeningContext }) {
    const systemPrompt = getSystemPrompt(topic);

    if (!systemPrompt) {
        // Ini seharusnya sudah divalidasi di route, tapi dijaga lagi di sini
        // supaya service tetap aman dipakai mandiri.
        throw new GeminiServiceError('bad_response', `Topic tidak dikenali: ${topic}`);
    }

    if (typeof message !== 'string' || !message.trim()) {
        throw new GeminiServiceError('bad_response', 'Message tidak boleh kosong.');
    }

    let lastErr;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            return await callGeminiOnce(systemPrompt, history, message, screeningContext);
        } catch (err) {
            lastErr = err;

            const retriable = err instanceof GeminiServiceError && (
                err.code === 'network' ||
                err.code === 'server_error'
            );

            if (!retriable || attempt === MAX_RETRIES) break;

            logWarn(`Percobaan ${attempt + 1} gagal (${err.code}), retry dalam ~${RETRY_DELAY_MS}ms...`);
            await sleep(RETRY_DELAY_MS + Math.floor(Math.random() * RETRY_JITTER_MS));
        }
    }

    throw lastErr;
}

module.exports = {
    consult,
    GeminiServiceError,
};
