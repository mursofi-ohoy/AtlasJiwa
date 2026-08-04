/* =========================================
   ATLAS JIWA — Agent Bridge (public/js/agent-bridge.js)
   -----------------------------------------------------------
   Menjembatani hasil NLP JS (nlp-engine.js / summary-engine.js) ke
   panel "Konsultasi Singkat dengan Atlas Jiwa AI" di script.js.

   PERUBAHAN ARSITEKTUR: versi sebelumnya memanggil Node proxy ->
   FastAPI -> Qwen/Ollama (server/routes/agent.routes.js +
   backend/app/agent_api.py). Kedua layanan itu SUDAH DIHAPUS.
   Sekarang seluruh proses berjalan di browser lewat
   window.AtlasAIAdapter (lihat ai-adapter.js) — tidak ada lagi
   request jaringan ke server untuk fitur ini, dan tidak ada pesan
   chat yang tersimpan di CockroachDB.

   window.AtlasAgent.initSessionFromSummary(overallSummary, screeningType, currentLang)
     Dipanggil SEKALI setelah hasil screening ditampilkan. Mengubah
     overallSummary (dari AtlasSummaryEngine.buildOverallSummary,
     sudah dihitung sisi klien) menjadi konteks ringkas, lalu minta
     adapter AI aktif membuat interpretasi pembuka.
     Mengembalikan { sessionId, response, isCrisis }.

   window.AtlasAgent.sendMessage(sessionId, messageText, currentLang)
     Dipanggil setiap kali user mengirim pesan chat. Menjalankan
     window.AtlasNLPEngine.analyzeQualitative(messageText) DI SISI
     KLIEN (di dalam adapter), lalu adapter AI aktif membalas.
     Mengembalikan { sessionId, response, isCrisis }.

   URUTAN MUAT SCRIPT (wajib): file ini dimuat SETELAH
   keyword-dictionary.js, nlp-engine.js, summary-engine.js, DAN
   ai-adapter.js (lihat public/screening.html).
   ========================================= */

(function (global) {
    'use strict';

    function pickLang(biObj, lang) {
        if (!biObj) return null;
        return (lang === 'en' ? biObj.en : biObj.id) || biObj.id || biObj.en || null;
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
        const ctx = buildContext(overallSummary, screeningType, currentLang);
        const response = await adapter.interpret(ctx);
        return { sessionId: makeSessionId(), response, isCrisis: false };
    }

    /**
     * @param {string|null} sessionId  dipertahankan hanya untuk konsistensi UI (tidak ada state server)
     * @param {string} messageText
     * @param {string} [currentLang]
     */
    async function sendMessage(sessionId, messageText, currentLang) {
        const adapter = global.AtlasAIAdapter.getActiveAdapter();
        const result = await adapter.reply(messageText, { lang: currentLang || 'id' });
        return {
            sessionId: sessionId || makeSessionId(),
            response: result.text,
            isCrisis: !!result.isCrisis,
        };
    }

    global.AtlasAgent = { initSessionFromSummary, sendMessage };
})(window);
