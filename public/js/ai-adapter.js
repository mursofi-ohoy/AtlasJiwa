/* =========================================
   ATLAS JIWA — AI Adapter Layer (public/js/ai-adapter.js)
   -----------------------------------------------------------
   Menggantikan alur lama: browser -> Node proxy -> FastAPI -> Qwen/Ollama
   (server/routes/agent.routes.js + backend/app/agent_api.py, SUDAH
   DIHAPUS). Seluruh interpretasi & "konsultasi AI" sekarang berjalan
   100% di browser:

     window.AtlasAIAdapter.getActiveAdapter()
       -> { interpret(context), reply(message, context) }

   Adapter TIDAK PERNAH membaca jawaban naratif dari database (memang
   tidak ada lagi yang dikirim ke server), hanya menggunakan hasil
   yang sudah dihitung sisi klien oleh nlp-engine.js / summary-engine.js
   (skor komposit, risk band, tema, tag).

   Desain "mudah diganti" (AIAdapter pattern): tinggal isi implementasi
   qwen/gemini/openai/claude di bawah dan ganti AI_CONFIG.provider.
   Default-nya `local` — heuristik berbasis aturan yang SUDAH dihitung
   oleh summary-engine.js, jadi tidak butuh API key/jaringan sama
   sekali (aman untuk demo hackathon, tidak membocorkan API key di
   sisi klien).

   Deteksi krisis di bawah adalah port sisi-klien dari
   backend/app/risk_engine.py (versi lama, sudah dihapus) — sengaja
   deterministik, bukan bergantung ke model AI, supaya "apakah perlu
   tampilkan rujukan darurat" tetap bisa diaudit.
   ========================================= */

(function (global) {
    'use strict';

    // ---------- Deteksi krisis deterministik (client-side) ----------
    const CRISIS_PATTERNS = [
        '\\bbunuh diri\\b',
        '\\bmengakhiri hidup\\b',
        '\\bmenyakiti diri\\b',
        '\\bmelukai diri\\b',
        '\\btidak ingin hidup\\b',
        '\\bingin mati\\b',
        '\\bsudah tidak (?:tahan|kuat)\\b',
        '\\bsuicide\\b',
        '\\bkill myself\\b',
        '\\bend my life\\b',
        '\\bself[- ]harm\\b',
        '\\bhurt myself\\b',
        "\\bdon'?t want to live\\b",
        '\\bwant to die\\b',
        "\\bcan'?t take it anymore\\b",
    ];
    const CRISIS_REGEX = new RegExp(CRISIS_PATTERNS.join('|'), 'i');
    const COMPOSITE_RISK_CRISIS_THRESHOLD = 85;

    function textHasCrisisPattern(text) {
        return CRISIS_REGEX.test(text || '');
    }

    /**
     * @param {string} message
     * @param {{qualitativeRiskPercent?: number, tags?: string[], axes?: object}} narrativeContext
     */
    function assessMessageRisk(message, narrativeContext) {
        const reasons = [];
        let riskPercent = null;

        if (narrativeContext) {
            riskPercent = typeof narrativeContext.qualitativeRiskPercent === 'number'
                ? narrativeContext.qualitativeRiskPercent
                : null;
            const tags = (narrativeContext.tags || []).map((t) => String(t).toLowerCase());
            if (tags.some((t) => t.includes('segera') || t.includes('immediate') || t.includes('urgent'))) {
                reasons.push('urgency_tag');
            }
            if (narrativeContext.axes && narrativeContext.axes.urgency > 0) {
                reasons.push('urgency_axis');
            }
        }

        const patternHit = textHasCrisisPattern(message);
        if (patternHit) reasons.push('explicit_phrase');

        const scoreHit = typeof riskPercent === 'number' && riskPercent >= COMPOSITE_RISK_CRISIS_THRESHOLD;
        if (scoreHit) reasons.push('high_composite_risk');

        return {
            isCrisis: patternHit || scoreHit || reasons.includes('urgency_tag'),
            riskPercent,
            reasons,
        };
    }

    function pick(lang, idText, enText) {
        return (lang === 'en' ? enText : idText) || idText || enText || '';
    }

    // ---------- Adapter default: heuristik lokal (tanpa API eksternal) ----------
    const LocalHeuristicAdapter = {
        id: 'local',
        label: 'Local Heuristic (client-side, tanpa API eksternal)',

        // context: { screeningType, score, riskLevel, theme, interpretation, tags, lang }
        async interpret(ctx) {
            const parts = [];
            parts.push(
                pick(
                    ctx.lang,
                    `Berdasarkan hasil screening "${ctx.screeningType}" Anda (skor komposit ${ctx.score ?? '-'}%, tingkat "${ctx.riskLevel || '-'}"), berikut interpretasi singkatnya.`,
                    `Based on your "${ctx.screeningType}" screening (composite score ${ctx.score ?? '-'}%, "${ctx.riskLevel || '-'}" level), here is a brief interpretation.`
                )
            );
            if (ctx.theme) parts.push(ctx.theme);
            if (ctx.interpretation) parts.push(ctx.interpretation);
            parts.push(
                pick(
                    ctx.lang,
                    'Ada yang ingin Anda tanyakan lebih lanjut tentang hasil ini?',
                    'Is there anything you would like to ask further about this result?'
                )
            );
            return parts.filter(Boolean).join(' ');
        },

        // message: teks dari kolom chat. ctx: { lang }
        async reply(message, ctx) {
            const lang = ctx.lang || 'id';
            const analysis = global.AtlasNLPEngine && typeof global.AtlasNLPEngine.analyzeQualitative === 'function'
                ? global.AtlasNLPEngine.analyzeQualitative(message)
                : null;

            const narrativeContext = analysis
                ? {
                      qualitativeRiskPercent: analysis.meta && analysis.meta.qualitativeRisk ? analysis.meta.qualitativeRisk.percent : null,
                      tags: (analysis.tags || []).map((t) => pick(lang, t.id, t.en)),
                      axes: analysis.axes
                          ? Object.keys(analysis.axes).reduce((acc, k) => {
                                acc[k] = analysis.axes[k].score || 0;
                                return acc;
                            }, {})
                          : {},
                  }
                : null;

            const risk = assessMessageRisk(message, narrativeContext);

            if (risk.isCrisis) {
                return {
                    isCrisis: true,
                    text: pick(
                        lang,
                        'Terima kasih sudah menceritakannya. Yang Anda sampaikan terdengar berat — saya bukan pengganti bantuan darurat, jadi mohon segera hubungi layanan darurat atau profesional kesehatan mental tepercaya di lokasi Anda.',
                        'Thank you for sharing that. What you described sounds heavy — I am not a substitute for emergency help, so please reach out to emergency services or a trusted mental health professional in your area right away.'
                    ),
                };
            }

            let text;
            if (analysis && analysis.theme) {
                const themeText = pick(lang, analysis.theme.id, analysis.theme.en);
                const interpText = analysis.interpretation ? pick(lang, analysis.interpretation.id, analysis.interpretation.en) : '';
                text = pick(
                    lang,
                    `Dari yang Anda tulis, saya menangkap tema "${themeText}". ${interpText}`,
                    `From what you wrote, I noticed a theme of "${themeText}". ${interpText}`
                );
            } else {
                text = pick(
                    lang,
                    'Terima kasih sudah berbagi. Bisa ceritakan lebih spesifik apa yang paling Anda rasakan belakangan ini terkait pola ini?',
                    'Thanks for sharing. Could you tell me more specifically what you have been feeling lately related to this pattern?'
                );
            }
            return { isCrisis: false, text: text.trim() };
        },
    };

    // ---------- Adapter eksternal (belum diaktifkan) ----------
    // Isi implementasi (fetch ke API model pilihan Anda) & aktifkan
    // dengan mengganti AI_CONFIG.provider di bawah. Sengaja dibiarkan
    // sebagai stub supaya tidak ada API key yang perlu ditempel di
    // kode ini secara default.
    function externalAdapterStub(id, label) {
        return {
            id,
            label,
            async interpret() {
                throw new Error(`AIAdapter "${id}" belum dikonfigurasi. Isi implementasi & API key di public/js/ai-adapter.js sebelum mengaktifkannya.`);
            },
            async reply() {
                throw new Error(`AIAdapter "${id}" belum dikonfigurasi.`);
            },
        };
    }

    // ---------- Adapter Gemini (server/routes/gemini.routes.js -> Gemini API) ----------
    // Panggil server (BUKAN Gemini API langsung dari browser) supaya API key
    // tidak pernah menyentuh sisi klien. Jika permintaan gagal karena
    // timeout/invalid key/quota/network/server error, otomatis fallback
    // ke LocalHeuristicAdapter TANPA mengubah perilaku LocalHeuristicAdapter
    // itu sendiri sama sekali.
    const GEMINI_FALLBACK_CODES = new Set(['timeout', 'invalid_key', 'quota', 'network', 'server_error', 'bad_response']);
    const GEMINI_REQUEST_TIMEOUT_MS = 12000;

    async function postToGeminiConsult(payload) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);
        let res;
        try {
            res = await fetch('/api/ai/consult', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include', // wajib: endpoint pakai cookie sesi (requireAuth)
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (err) {
            clearTimeout(timer);
            if (err && err.name === 'AbortError') {
                const e = new Error('Permintaan ke Gemini melebihi batas waktu.');
                e.code = 'timeout';
                throw e;
            }
            const e = new Error('Gagal menghubungi server (jaringan).');
            e.code = 'network';
            throw e;
        }
        clearTimeout(timer);

        if (!res.ok) {
            let code = 'server_error';
            try {
                const body = await res.json();
                if (body && body.code) code = body.code;
            } catch (_) {
                // respons bukan JSON, biarkan code default
            }
            const e = new Error(`Gemini consult gagal (HTTP ${res.status}).`);
            e.code = code;
            throw e;
        }

        const data = await res.json();
        if (!data || typeof data.reply !== 'string') {
            const e = new Error('Respons Gemini tidak terduga.');
            e.code = 'bad_response';
            throw e;
        }
        return data.reply;
    }

    /**
     * @param {string} kind 'interpret' | 'reply'
     * ctx yang diteruskan boleh membawa `topic` (dari topic-selector.js)
     * dan `history` (dari agent-bridge.js, maksimal 5 percakapan terakhir).
     * Provider local TIDAK memakai field ini sama sekali, jadi menambahkan
     * field ini aman untuk backward-compatibility.
     */
    async function geminiConsultWithFallback(kind, message, ctx) {
        const safeCtx = ctx || {};
        try {
            if (!safeCtx.topic) {
                // Tanpa topic (mis. topic-selector belum dipilih user), tidak ada
                // dasar system prompt di server -> langsung pakai local, jangan
                // memaksa request ke server.
                throw Object.assign(new Error('Topic belum dipilih untuk provider gemini.'), { code: 'bad_response' });
            }
            const reply = await postToGeminiConsult({
                topic: safeCtx.topic,
                message,
                history: safeCtx.history || [],
            });
            return { isCrisis: false, text: reply };
        } catch (err) {
            const code = (err && err.code) || 'server_error';
            if (!GEMINI_FALLBACK_CODES.has(code)) throw err; // error tak dikenal: jangan diam-diam ditelan
            console.warn(`[ATLAS][Gemini] Fallback ke Local Heuristic (alasan: ${code})`);
            // Fallback: delegasikan penuh ke LocalHeuristicAdapter, TANPA mengubah
            // perilaku/kode LocalHeuristicAdapter itu sendiri.
            if (kind === 'interpret') return LocalHeuristicAdapter.interpret(safeCtx);
            const text = await LocalHeuristicAdapter.reply(message, safeCtx);
            return text;
        }
    }

    const GeminiAdapter = {
        id: 'gemini',
        label: 'Gemini (server-side, via /api/ai/consult)',
        async interpret(ctx) {
            const result = await geminiConsultWithFallback('interpret', null, ctx);
            // interpret() LocalHeuristicAdapter mengembalikan string biasa (bukan
            // {isCrisis,text}) — samakan bentuk kembalian supaya agent-bridge.js
            // (yang memanggil adapter.interpret langsung sbg response teks) tidak perlu berubah.
            return typeof result === 'string' ? result : result.text;
        },
        async reply(message, ctx) {
            return geminiConsultWithFallback('reply', message, ctx);
        },
    };

    const ADAPTERS = {
        local: LocalHeuristicAdapter,
        qwen: externalAdapterStub('qwen', 'Qwen (belum dikonfigurasi)'),
        gemini: GeminiAdapter,
        openai: externalAdapterStub('openai', 'OpenAI (belum dikonfigurasi)'),
        claude: externalAdapterStub('claude', 'Claude (belum dikonfigurasi)'),
    };

    // Ganti 'provider' di sini untuk pindah model AI tanpa menyentuh
    // kode lain (agent-bridge.js, script.js) — itulah tujuan pola adapter ini.
    const AI_CONFIG = { provider: 'local' };

    function getActiveAdapter() {
        return ADAPTERS[AI_CONFIG.provider] || ADAPTERS.local;
    }

    global.AtlasAIAdapter = {
        adapters: ADAPTERS,
        config: AI_CONFIG,
        getActiveAdapter,
        assessMessageRisk,
    };
})(window);
