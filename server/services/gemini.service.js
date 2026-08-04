/* =========================================
   ATLAS JIWA — Gemini Service (server/services/gemini.service.js)
   -----------------------------------------------------------
   Bertugas SATU hal saja: memanggil Gemini REST API dan
   mengembalikan teks balasan, atau melempar error yang sudah
   dipetakan ke kode yang bisa dipahami route/frontend.

   TIDAK ADA akses database di file ini.
   TIDAK ADA logic auth/rate-limit di file ini (itu tugas route).

   Requirement: Node.js >= 18 (pakai `fetch` global bawaan Node).
   Tidak menambah dependency baru (tanpa axios/node-fetch) supaya
   tidak mengubah package.json project yang sudah berjalan.
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

/**
 * Susun payload request Gemini dari system prompt + history + pesan baru.
 * history: array of { role: 'user'|'assistant', text: string }, maksimal
 * dipotong di sisi caller (route) — service tidak memaksakan batas di sini.
 */
function buildRequestBody(systemPrompt, history, message) {
    const contents = [];

    (history || []).forEach((turn) => {
        if (!turn || !turn.text) return;
        contents.push({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: String(turn.text).slice(0, 4000) }],
        });
    });

    contents.push({ role: 'user', parts: [{ text: String(message).slice(0, 4000) }] });

    return {
        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
            temperature: 0.6,
            maxOutputTokens: 512,
        },
    };
}

function extractReplyText(json) {
    const candidate = json && json.candidates && json.candidates[0];
    const parts = candidate && candidate.content && candidate.content.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p.text || '').join('').trim() : '';
    if (!text) {
        throw new GeminiServiceError('bad_response', 'Respons Gemini kosong/tidak terduga.');
    }
    return text;
}

async function callGeminiOnce(systemPrompt, history, message) {
    if (!GEMINI_API_KEY) {
        throw new GeminiServiceError('invalid_key', 'GEMINI_API_KEY belum dikonfigurasi di server.');
    }

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;
    const body = buildRequestBody(systemPrompt, history, message);

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

    if (res.status === 401 || res.status === 403) {
        throw new GeminiServiceError('invalid_key', 'API key Gemini tidak valid atau tidak diizinkan.');
    }
    if (res.status === 429) {
        throw new GeminiServiceError('quota', 'Kuota/rate limit Gemini API terlampaui.');
    }
    if (res.status >= 500) {
        throw new GeminiServiceError('server_error', `Gemini API error server (HTTP ${res.status}).`);
    }
    if (!res.ok) {
        let detail = '';
        try {
            const errJson = await res.json();
            detail = (errJson && errJson.error && errJson.error.message) || '';
        } catch (_) {
            // abaikan, body mungkin bukan JSON
        }
        throw new GeminiServiceError('bad_response', `Gemini API menolak permintaan (HTTP ${res.status}). ${detail}`.trim());
    }

    const json = await res.json();
    return extractReplyText(json);
}

/**
 * @param {{ topic: string, message: string, history?: Array<{role:string,text:string}> }} params
 * @returns {Promise<string>} teks balasan Gemini
 * @throws {GeminiServiceError}
 */
async function consult({ topic, message, history }) {
    const systemPrompt = getSystemPrompt(topic);
    if (!systemPrompt) {
        // Ini seharusnya sudah divalidasi di route, tapi dijaga lagi di sini
        // supaya service tetap aman dipakai mandiri.
        throw new GeminiServiceError('bad_response', `Topic tidak dikenali: ${topic}`);
    }

    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
        try {
            return await callGeminiOnce(systemPrompt, history, message);
        } catch (err) {
            lastErr = err;
            const retriable = err instanceof GeminiServiceError && (err.code === 'network' || err.code === 'server_error');
            if (!retriable || attempt === MAX_RETRIES) break;
            await sleep(RETRY_DELAY_MS);
        }
    }
    throw lastErr;
}

module.exports = { consult, GeminiServiceError };
