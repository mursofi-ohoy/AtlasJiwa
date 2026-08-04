/* =========================================
ATLAS JIWA — AI Adapter Layer (public/js/ai-adapter.js)

Hybrid AI Architecture:
- LocalHeuristicAdapter dipakai untuk interpretasi hasil screening.
- GeminiAdapter dipakai untuk chatbot lanjutan.
- Jika Gemini gagal (timeout, quota, invalid key, network, server error,
  bad_response), otomatis fallback ke LocalHeuristicAdapter.

Alur:
- Screening / Summary Engine tetap 100% lokal.
- Gemini hanya untuk diskusi setelah hasil screening muncul.
- Gemini TIDAK menghitung ulang skor, risk level, atau hasil screening.

Adapter TIDAK PERNAH membaca jawaban naratif dari database.
Konteks yang dikirim ke Gemini hanya berasal dari ringkasan hasil
screening yang sudah dihitung di sisi klien.
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

// ---------- Adapter lokal: heuristik berbasis Summary Engine ----------
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

// ---------- Adapter Gemini (server-side, via /api/ai/consult) ----------
const GEMINI_FALLBACK_CODES = new Set([
    'timeout',
    'invalid_key',
    'quota',
    'network',
    'server_error',
    'bad_response',
]);

const GEMINI_REQUEST_TIMEOUT_MS = 12000;
const GEMINI_MAX_HISTORY_TURNS = 5;
const GEMINI_MAX_HISTORY_ITEM_CHARS = 2000;
const GEMINI_MAX_HISTORY_CHARS = 6000;
const GEMINI_MAX_SCREENING_CONTEXT_STRING_CHARS = 3000;

async function postToGeminiConsult(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

    let res;

    try {
        res = await fetch('/api/ai/consult', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
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
 * Membangun narrativeContext dari pesan chat menggunakan NLP lokal.
 * Dipakai oleh HybridAdapter untuk memperketat deteksi krisis sebelum
 * pesan dikirim ke Gemini.
 */
function buildNarrativeContextForMessage(message, lang) {
    const engine = global.AtlasNLPEngine;

    if (!engine || typeof engine.analyzeQualitative !== 'function') {
        return null;
    }

    let analysis = null;

    try {
        analysis = engine.analyzeQualitative(message);
    } catch (_) {
        return null;
    }

    if (!analysis) {
        return null;
    }

    return {
        qualitativeRiskPercent: analysis.meta && analysis.meta.qualitativeRisk && typeof analysis.meta.qualitativeRisk.percent === 'number'
            ? analysis.meta.qualitativeRisk.percent
            : null,
        tags: (analysis.tags || [])
            .map((t) => {
                if (typeof t === 'string') return t;
                return pick(lang, t && t.id, t && t.en);
            })
            .filter(Boolean),
        axes: analysis.axes
            ? Object.keys(analysis.axes).reduce((acc, k) => {
                  acc[k] = analysis.axes[k].score || 0;
                  return acc;
              }, {})
            : {},
    };
}

/**
 * Batasi history chat yang dikirim ke Gemini:
 * - maksimal 5 turn,
 * - maksimal 2000 karakter per item,
 * - maksimal total 6000 karakter.
 */
function sanitizeHistoryForGemini(history) {
    if (!Array.isArray(history)) {
        return [];
    }

    const validTurns = history.filter((turn) => {
        return (
            turn &&
            typeof turn.text === 'string' &&
            ['user', 'assistant'].includes(turn.role)
        );
    });

    const limited = [];
    let totalChars = 0;

    for (let i = validTurns.length - 1; i >= 0; i -= 1) {
        const text = String(validTurns[i].text)
            .slice(0, GEMINI_MAX_HISTORY_ITEM_CHARS)
            .trim();

        if (!text) continue;

        if (totalChars + text.length > GEMINI_MAX_HISTORY_CHARS) {
            break;
        }

        limited.unshift({
            role: validTurns[i].role,
            text,
        });

        totalChars += text.length;
    }

    return limited.slice(-GEMINI_MAX_HISTORY_TURNS);
}

/**
 * Sanitasi screeningContext sebelum dikirim ke backend.
 *
 * Bentuk yang disarankan adalah objek:
 * {
 *   screeningType: string,
 *   riskLevel: string,
 *   score: number,
 *   theme: string,
 *   interpretation: string,
 *   tags: string[]
 * }
 *
 * String tetap diterima untuk backward compatibility, tetapi backend
 * akan lebih optimal bila menerima objek terstruktur.
 */
function sanitizeScreeningContextForGemini(screeningContext) {
    if (!screeningContext) {
        return undefined;
    }

    if (typeof screeningContext === 'string') {
        const text = screeningContext.trim().slice(0, GEMINI_MAX_SCREENING_CONTEXT_STRING_CHARS);
        return text || undefined;
    }

    if (typeof screeningContext !== 'object' || Array.isArray(screeningContext)) {
        return undefined;
    }

    const out = {};

    if (typeof screeningContext.screeningType === 'string') {
        const value = screeningContext.screeningType.trim().slice(0, 100);
        if (value) out.screeningType = value;
    }

    if (typeof screeningContext.riskLevel === 'string') {
        const value = screeningContext.riskLevel.trim().slice(0, 100);
        if (value) out.riskLevel = value;
    }

    if (typeof screeningContext.score === 'number' && Number.isFinite(screeningContext.score)) {
        out.score = Math.max(0, Math.min(100, screeningContext.score));
    }

    if (typeof screeningContext.theme === 'string') {
        const value = screeningContext.theme.trim().slice(0, 500);
        if (value) out.theme = value;
    }

    if (typeof screeningContext.interpretation === 'string') {
        const value = screeningContext.interpretation.trim().slice(0, 2000);
        if (value) out.interpretation = value;
    }

    if (Array.isArray(screeningContext.tags)) {
        const tags = screeningContext.tags
            .filter((t) => typeof t === 'string')
            .map((t) => t.trim().slice(0, 100))
            .filter(Boolean)
            .slice(0, 20);

        if (tags.length) out.tags = tags;
    }

    return Object.keys(out).length ? out : undefined;
}

/**
 * @param {string} kind 'interpret' | 'reply'
 *
 * Pada arsitektur hybrid:
 * - interpret() TIDAK memanggil Gemini.
 * - reply() memanggil Gemini, lalu fallback ke local bila gagal.
 */
async function geminiConsultWithFallback(kind, message, ctx) {
    const safeCtx = ctx || {};

    // Interpretasi hasil screening harus selalu lokal.
    if (kind !== 'reply') {
        return LocalHeuristicAdapter.interpret(safeCtx);
    }

    const normalizedMessage = typeof message === 'string' ? message.trim() : '';

    // Pesan kosong tidak perlu dikirim ke Gemini.
    if (!normalizedMessage) {
        return LocalHeuristicAdapter.reply(normalizedMessage, safeCtx);
    }

    try {
        if (!safeCtx.topic) {
            // Tanpa topic, tidak ada dasar system prompt di server.
            // Langsung fallback ke local agar chat tetap hidup.
            throw Object.assign(new Error('Topic belum dipilih untuk provider gemini.'), {
                code: 'bad_response',
            });
        }

        const payload = {
            topic: safeCtx.topic,
            message: normalizedMessage,
            history: sanitizeHistoryForGemini(safeCtx.history),
        };

        const screeningContext = sanitizeScreeningContextForGemini(safeCtx.screeningContext);
        if (screeningContext !== undefined) {
            payload.screeningContext = screeningContext;
        }

        const reply = await postToGeminiConsult(payload);

        return {
            isCrisis: false,
            text: reply,
        };
    } catch (err) {
        const code = (err && err.code) || 'server_error';

        if (!GEMINI_FALLBACK_CODES.has(code)) {
            throw err;
        }

        console.warn(`[ATLAS][Gemini] Fallback ke Local Heuristic (alasan: ${code})`);

        return LocalHeuristicAdapter.reply(normalizedMessage, safeCtx);
    }
}

const GeminiAdapter = {
    id: 'gemini',
    label: 'Gemini (server-side, via /api/ai/consult)',

    // Interpretasi screening tetap lokal, walau adapter Gemini dipilih.
    async interpret(ctx) {
        return LocalHeuristicAdapter.interpret(ctx);
    },

    async reply(message, ctx) {
        return geminiConsultWithFallback('reply', message, ctx);
    },
};

// ---------- Hybrid Adapter ----------
// Inilah adapter default Atlas Jiwa.
//
// - interpret() selalu memakai LocalHeuristicAdapter.
// - reply() memakai GeminiAdapter.
// - Jika Gemini gagal, fallback ke LocalHeuristicAdapter.
// - Jika ada indikasi krisis berdasarkan NLP lokal, local safety
//   response dipakai tanpa menunggu Gemini.
const HybridAdapter = {
    id: 'hybrid',
    label: 'Hybrid (Local Screening + Gemini Chat)',

    async interpret(ctx) {
        return LocalHeuristicAdapter.interpret(ctx);
    },

    async reply(message, ctx) {
        const safeCtx = ctx || {};
        const normalizedMessage = typeof message === 'string' ? message.trim() : '';

        if (!normalizedMessage) {
            return LocalHeuristicAdapter.reply(normalizedMessage, safeCtx);
        }

        // Perbaikan Bug 2:
        // Deteksi krisis memakai hasil NLP lokal, bukan hanya regex kata.
        const narrativeContext = buildNarrativeContextForMessage(normalizedMessage, safeCtx.lang);
        const safetyRisk = assessMessageRisk(normalizedMessage, narrativeContext);

        if (safetyRisk.isCrisis) {
            return LocalHeuristicAdapter.reply(normalizedMessage, safeCtx);
        }

        return GeminiAdapter.reply(normalizedMessage, safeCtx);
    },
};

const ADAPTERS = {
    local: LocalHeuristicAdapter,
    hybrid: HybridAdapter,
    gemini: GeminiAdapter,
    qwen: externalAdapterStub('qwen', 'Qwen (belum dikonfigurasi)'),
    openai: externalAdapterStub('openai', 'OpenAI (belum dikonfigurasi)'),
    claude: externalAdapterStub('claude', 'Claude (belum dikonfigurasi)'),
};

// Provider default: hybrid.
// Local tetap ada untuk fallback dan compatibility.
const AI_CONFIG = {
    provider: 'hybrid',
};

function getActiveAdapter() {
    return ADAPTERS[AI_CONFIG.provider] || ADAPTERS.hybrid;
}

global.AtlasAIAdapter = {
    adapters: ADAPTERS,
    config: AI_CONFIG,
    getActiveAdapter,
    assessMessageRisk,
};
})(window);