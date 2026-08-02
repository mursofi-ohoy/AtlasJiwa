/* =========================================
   ATLAS JIWA — Agent Bridge (public/js/agent-bridge.js)
   Menjembatani hasil NLP JS (nlp-engine.js / summary-engine.js) ke
   agen konsultasi Qwen (lewat proxy Node -> FastAPI -> Ollama, lihat
   server/routes/agent.routes.js & backend/app/agent_api.py).

   window.AtlasAgent.initSessionFromSummary(overallSummary, screeningType)
     Dipanggil SEKALI setelah hasil screening ditampilkan. Mengubah
     bentuk overallSummary (dari AtlasSummaryEngine.buildOverallSummary)
     menjadi ScreeningContext yang dimengerti backend, lalu membuka
     sesi konsultasi. Mengembalikan { sessionId, response, isCrisis }.

   window.AtlasAgent.sendMessage(sessionId, messageText)
     Dipanggil setiap kali user mengirim pesan chat. Menjalankan
     window.AtlasNLPEngine.analyzeQualitative(messageText) DI SISI
     KLIEN untuk pesan ini, mengirimkannya sebagai NarrativeContext
     bersama pesannya. Mengembalikan { sessionId, response, isCrisis }.

   URUTAN MUAT SCRIPT (wajib): file ini dimuat SETELAH
   keyword-dictionary.js, nlp-engine.js, dan summary-engine.js,
   supaya window.AtlasNLPEngine sudah tersedia saat sendMessage()
   dipanggil.
   ========================================= */

(function (global) {
    'use strict';

    const API_BASE = '/api/agent';

    /**
     * Meratakan overallSummary (bentuk lengkap dari
     * AtlasSummaryEngine.buildOverallSummary) menjadi ScreeningContext
     * ringkas sesuai app/models.py -> ScreeningContext di backend.
     * Sengaja hanya mengambil field yang relevan untuk prompt Qwen —
     * bukan seluruh objek mentah — supaya payload tetap ringkas dan
     * tidak membocorkan detail yang tidak perlu (mis. kutipan mentah
     * jawaban) ke luar dari alur yang sudah ada.
     */
    function toScreeningContext(overallSummary, currentLang) {
        if (!overallSummary) return null;
        const pickLang = (biObj) => {
            if (!biObj) return null;
            return (currentLang === 'en' ? biObj.en : biObj.id) || biObj.id || biObj.en || null;
        };

        return {
            theme: pickLang(overallSummary.theme),
            tags: (overallSummary.tags || []).map((t) => pickLang(t)).filter(Boolean),
            composite_risk_percent:
                overallSummary.compositeRisk && typeof overallSummary.compositeRisk.score === 'number'
                    ? overallSummary.compositeRisk.score
                    : null,
            composite_risk_band:
                overallSummary.compositeRisk && overallSummary.compositeRisk.band
                    ? pickLang(overallSummary.compositeRisk.band)
                    : null,
            addiction_components: (overallSummary.addictionComponents || []).map((c) => ({
                key: c.key,
                label: pickLang(c.label),
                present: !!c.present,
                score: c.score || 0,
            })),
            axis_totals: overallSummary.axisTotals || {},
            synergy_pairs: (overallSummary.synergyPairs || []).map((p) => pickLang(p)).filter(Boolean),
            reliability_avg:
                typeof overallSummary.reliabilityAvg === 'number' ? overallSummary.reliabilityAvg : null,
        };
    }

    /**
     * Meratakan hasil window.AtlasNLPEngine.analyzeQualitative(text)
     * menjadi NarrativeContext ringkas sesuai app/models.py di backend.
     */
    function toNarrativeContext(analysis, currentLang) {
        if (!analysis) return null;
        const pickLang = (biObj) => {
            if (!biObj) return null;
            return (currentLang === 'en' ? biObj.en : biObj.id) || biObj.id || biObj.en || null;
        };

        const axes = {};
        if (analysis.axes) {
            Object.keys(analysis.axes).forEach((k) => {
                axes[k] = analysis.axes[k].score || 0;
            });
        }

        return {
            theme: pickLang(analysis.theme),
            tags: (analysis.tags || []).map((t) => pickLang(t)).filter(Boolean),
            axes,
            qualitative_risk_percent:
                analysis.meta && analysis.meta.qualitativeRisk
                    ? analysis.meta.qualitativeRisk.percent
                    : null,
            reliability: analysis.meta && typeof analysis.meta.reliability === 'number'
                ? analysis.meta.reliability
                : null,
        };
    }

    async function postJson(path, body) {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            credentials: 'include', // wajib: sesi diverifikasi lewat cookie httpOnly di Node
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(data.error || `Permintaan gagal (${res.status}).`);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    /**
     * @param {object} overallSummary  hasil AtlasSummaryEngine.buildOverallSummary()
     * @param {string} screeningType   mis. 'scrolling' | 'gaming'
     * @param {string} [currentLang]   'id' | 'en', default 'id'
     */
    async function initSessionFromSummary(overallSummary, screeningType, currentLang) {
        const context = toScreeningContext(overallSummary, currentLang || 'id');
        const data = await postJson('/session/init', {
            screening_type: screeningType || null,
            context,
        });
        return {
            sessionId: data.session_id,
            response: data.response,
            isCrisis: !!data.is_crisis,
        };
    }

    /**
     * @param {string|null} sessionId  null -> backend akan membuat sesi baru (stateless fallback)
     * @param {string} messageText
     * @param {string} [currentLang]
     */
    async function sendMessage(sessionId, messageText, currentLang) {
        let context = null;
        if (global.AtlasNLPEngine && typeof global.AtlasNLPEngine.analyzeQualitative === 'function') {
            const analysis = global.AtlasNLPEngine.analyzeQualitative(messageText);
            context = toNarrativeContext(analysis, currentLang || 'id');
        }

        const data = await postJson('/consult', {
            message: messageText,
            session_id: sessionId || null,
            context,
        });
        return {
            sessionId: data.session_id,
            response: data.response,
            isCrisis: !!data.is_crisis,
        };
    }

    global.AtlasAgent = { initSessionFromSummary, sendMessage, toScreeningContext, toNarrativeContext };
})(window);
