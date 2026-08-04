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

    // ---------- [Gemini] Topic & history in-memory ----------
    // Hanya dipakai jika provider aktif = 'gemini' (topic-selector.js yang
    // mengisi lewat setTopic()). Provider 'local' TIDAK membaca variabel ini
    // sama sekali (LocalHeuristicAdapter.reply/interpret tidak menerima
    // parameter topic/history), jadi perilaku provider local tidak berubah.
    // Disimpan murni di variabel JS module-scope -> otomatis hilang saat
    // halaman di-reload (tidak ada persistence, sesuai requirement).
    const MAX_HISTORY_TURNS = 5;
    let currentTopic = null;
    let chatHistory = []; // [{ role: 'user'|'assistant', text }]

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
            // [Gemini] Field tambahan — diabaikan begitu saja oleh LocalHeuristicAdapter
            // (dia hanya membaca screeningType/score/riskLevel/theme/interpretation/lang),
            // jadi aman ditambahkan tanpa mengubah perilaku provider local.
            topic: currentTopic,
            history: chatHistory.slice(),
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
        // [Gemini] topic & history disertakan di ctx; LocalHeuristicAdapter
        // mengabaikannya (lihat ai-adapter.js), jadi provider local tidak berubah.
        const ctx = { lang: currentLang || 'id', topic: currentTopic, history: chatHistory.slice() };
        const result = await adapter.reply(messageText, ctx);

        // Catat ke history in-memory (maks 5 percakapan) HANYA setelah balasan
        // berhasil didapat, supaya history tidak berisi giliran yang gagal.
        pushHistory('user', messageText);
        pushHistory('assistant', result.text);

        return {
            sessionId: sessionId || makeSessionId(),
            response: result.text,
            isCrisis: !!result.isCrisis,
        };
    }

    global.AtlasAgent = {
        initSessionFromSummary,
        sendMessage,
        // [Gemini] API tambahan untuk topic-selector.js / script.js.
        // Tidak dipakai sama sekali oleh alur provider 'local' yang sudah ada.
        setTopic,
        getTopic,
        resetHistory,
    };
})(window);
