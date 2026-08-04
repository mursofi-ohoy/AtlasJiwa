/* =========================================
ATLAS JIWA — Agent Bridge (public/js/agent-bridge.js)

Menjembatani hasil NLP JS (nlp-engine.js / summary-engine.js) ke
panel "Konsultasi Singkat dengan Atlas Jiwa AI" di script.js.

Hybrid Architecture:
- Screening / summary / interpretasi awal tetap lokal.
- Chatbot lanjutan memakai Gemini melalui adapter aktif.
- Gemini TIDAK dipanggil saat menampilkan hasil screening.
- Gemini hanya dipanggil saat user mengirim pesan chat.

window.AtlasAgent.initSessionFromSummary(overallSummary, screeningType, currentLang)
Dipanggil SEKALI setelah hasil screening ditampilkan. Mengubah
overallSummary menjadi konteks ringkas, lalu meminta adapter AI aktif
membuat interpretasi pembuka.

Pada arsitektur hybrid, interpretasi pembuka ini selalu berasal dari
LocalHeuristicAdapter, bukan Gemini.

window.AtlasAgent.sendMessage(sessionId, messageText, currentLang)
Dipanggil setiap kali user mengirim pesan chat. Pada arsitektur hybrid,
pesan ini diteruskan ke GeminiAdapter. Jika Gemini gagal, adapter akan
fallback ke LocalHeuristicAdapter.

URUTAN MUAT SCRIPT (wajib): file ini dimuat SETELAH
keyword-dictionary.js, nlp-engine.js, summary-engine.js, DAN
ai-adapter.js (lihat public/screening.html).
========================================= */
(function (global) {
'use strict';

// ---------- Topic & history in-memory ----------
// History chat disimpan di memory browser saja. Tidak ada persistence
// server-side untuk chat AI, sesuai arsitektur saat ini.
const MAX_HISTORY_TURNS = 5;

let currentTopic = null;
let chatHistory = []; // [{ role: 'user'|'assistant', text }]
let currentScreeningContext = null;

function setTopic(topic) {
    currentTopic = topic || null;
    chatHistory = []; // ganti topic = mulai percakapan baru
}

function getTopic() {
    return currentTopic;
}

function pushHistory(role, text) {
    if (!text) return;

    chatHistory.push({ role, text: String(text) });

    if (chatHistory.length > MAX_HISTORY_TURNS) {
        chatHistory = chatHistory.slice(-MAX_HISTORY_TURNS);
    }
}

function resetHistory() {
    chatHistory = [];
}

function pickLang(biObj, lang) {
    if (!biObj) return null;

    if (typeof biObj === 'string') {
        return biObj;
    }

    return (lang === 'en' ? biObj.en : biObj.id) || biObj.id || biObj.en || null;
}

/**
 * Menyusun konteks screening sebagai objek terstruktur.
 *
 * Objek ini later dikirim ke backend sebagai field `screeningContext`,
 * bukan disisipkan ke dalam history chat.
 *
 * Konteks ini hanya berisi ringkasan hasil screening:
 * - screening type
 * - risk level
 * - composite score
 * - tema
 * - interpretasi
 * - tags
 *
 * TIDAK ada jawaban naratif mentah di sini.
 */
function buildScreeningContextObject(overallSummary, screeningType, currentLang) {
    const lang = currentLang || 'id';
    const compositeRisk = overallSummary && overallSummary.compositeRisk;

    const score = compositeRisk && typeof compositeRisk.score === 'number'
        ? compositeRisk.score
        : null;

    const riskLevel = compositeRisk && compositeRisk.band
        ? pickLang(compositeRisk.band, lang)
        : null;

    const theme = pickLang(overallSummary && overallSummary.theme, lang);
    const interpretation = pickLang(overallSummary && overallSummary.interpretation, lang);

    const tags = ((overallSummary && overallSummary.tags) || [])
        .map((t) => pickLang(t, lang))
        .filter(Boolean);

    const context = {};

    if (screeningType) {
        context.screeningType = String(screeningType);
    }

    if (riskLevel) {
        context.riskLevel = String(riskLevel);
    }

    if (typeof score === 'number' && Number.isFinite(score)) {
        context.score = score;
    }

    if (theme) {
        context.theme = String(theme);
    }

    if (interpretation) {
        context.interpretation = String(interpretation);
    }

    if (tags.length) {
        context.tags = tags;
    }

    return Object.keys(context).length ? context : null;
}

/**
 * Meratakan overallSummary (bentuk lengkap dari
 * AtlasSummaryEngine.buildOverallSummary) menjadi konteks ringkas
 * untuk adapter AI — hanya field yang relevan, TANPA kutipan
 * jawaban naratif mentah.
 */
function buildContext(overallSummary, screeningType, currentLang) {
    const lang = currentLang || 'id';
    const compositeRisk = overallSummary && overallSummary.compositeRisk;

    return {
        screeningType: screeningType || '-',
        score: compositeRisk && typeof compositeRisk.score === 'number' ? compositeRisk.score : null,
        riskLevel: compositeRisk && compositeRisk.band ? pickLang(compositeRisk.band, lang) : null,
        theme: pickLang(overallSummary && overallSummary.theme, lang),
        interpretation: pickLang(overallSummary && overallSummary.interpretation, lang),
        tags: ((overallSummary && overallSummary.tags) || []).map((t) => pickLang(t, lang)).filter(Boolean),
        lang,

        // Dipakai oleh GeminiAdapter untuk chatbot lanjutan.
        topic: currentTopic,
        history: chatHistory.slice(),
        screeningContext: currentScreeningContext,
    };
}

function makeSessionId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
        ? global.crypto.randomUUID()
        : `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * @param {object} overallSummary  hasil AtlasSummaryEngine.buildOverallSummary()
 * @param {string} screeningType   mis. 'scrolling' | 'gaming'
 * @param {string} [currentLang]   'id' | 'en', default 'id'
 */
async function initSessionFromSummary(overallSummary, screeningType, currentLang) {
    const adapter = global.AtlasAIAdapter.getActiveAdapter();

    // Simpan konteks screening agar bisa dipakai pada pesan chat berikutnya.
    currentScreeningContext = buildScreeningContextObject(overallSummary, screeningType, currentLang);

    // Jika topic belum dipilih secara eksplisit, gunakan screeningType
    // sebagai topic awal. Server tetap melakukan normalisasi topic.
    if (!currentTopic && screeningType) {
        currentTopic = String(screeningType);
    }

    const ctx = buildContext(overallSummary, screeningType, currentLang);

    // Pada arsitektur hybrid, adapter.interpret() selalu memakai
    // LocalHeuristicAdapter. Tidak ada request ke Gemini di sini.
    const response = await adapter.interpret(ctx);

    return {
        sessionId: makeSessionId(),
        response,
        isCrisis: false,
    };
}

/**
 * @param {string|null} sessionId  dipertahankan hanya untuk konsistensi UI (tidak ada state server)
 * @param {string} messageText
 * @param {string} [currentLang]
 */
async function sendMessage(sessionId, messageText, currentLang) {
    const adapter = global.AtlasAIAdapter.getActiveAdapter();

    const ctx = {
        lang: currentLang || 'id',
        topic: currentTopic,
        history: chatHistory.slice(),
        screeningContext: currentScreeningContext,
    };

    // Pada arsitektur hybrid, adapter.reply() memakai GeminiAdapter.
    // Jika Gemini gagal, ai-adapter.js otomatis fallback ke local.
    const result = await adapter.reply(messageText, ctx);

    const replyText = typeof result === 'string'
        ? result
        : (result && result.text) || '';

    const isCrisis = !!(result && result.isCrisis);

    // Catat ke history in-memory (maks 5 percakapan) HANYA setelah balasan
    // berhasil didapat, supaya history tidak berisi giliran yang gagal.
    pushHistory('user', messageText);
    pushHistory('assistant', replyText);

    return {
        sessionId: sessionId || makeSessionId(),
        response: replyText,
        isCrisis,
    };
}

global.AtlasAgent = {
    initSessionFromSummary,
    sendMessage,

    // API tambahan untuk topic-selector.js / script.js.
    setTopic,
    getTopic,
    resetHistory,
};
})(window);