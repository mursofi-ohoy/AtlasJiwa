/* =========================================
ATLAS JIWA — Behavioral Advanced Engine v1
Modul tambahan di atas behavioral-nlp-engine.js.
Tidak mengubah nlp-engine.js, keyword-dictionary.js,
summary-engine.js, auth, JWT, D1, Gemini, src/index.js.

Menambahkan:
- Causal reasoning detection
- Cognitive distortion detection
- Ambivalence / internal conflict
- Metacognition / insight markers
- Locus of control
- Temporal discounting / present-future bias
- Digital behavior archetypes
- Linguistic complexity
- Risk stratification explainable
- Intervention matching
========================================= */
(function (global) {
'use strict';

function splitSentences(text) {
    return String(text || '')
        .split(/(?<=[.!?\n])\s+|\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countMatches(text, terms) {
    const lower = String(text || '').toLowerCase();
    const hits = [];
    (terms || []).forEach((t) => {
        const term = Array.isArray(t) ? t[0] : t;
        const re = new RegExp('\\b' + escapeRegex(term) + '\\b', 'i');
        if (re.test(lower)) hits.push(term);
    });
    return hits;
}

function sentencesWithTerms(text, terms) {
    return splitSentences(text)
        .map((s) => {
            const hits = countMatches(s, terms);
            return hits.length ? { sentence: s, terms: hits } : null;
        })
        .filter(Boolean);
}

/* ---------- Causal reasoning ---------- */
const CAUSAL_MARKERS = [
    'karena', 'sebab', 'gara-gara', 'akibat', 'sehingga',
    'bikin', 'membuat', 'due to', 'because', 'so that'
];

function extractCausal(text) {
    const evidence = sentencesWithTerms(text, CAUSAL_MARKERS);
    return {
        present: evidence.length > 0,
        marker_count: evidence.length,
        evidence: evidence.slice(0, 5).map((e) => e.sentence)
    };
}

/* ---------- Cognitive distortions ---------- */
const DISTORTION_DICT = {
    all_or_nothing: [
        'selalu', 'tidak pernah', 'nggak pernah', 'pasti',
        'mustahil', 'semua orang', 'tidak ada yang'
    ],
    catastrophizing: [
        'hancur', 'tamat', 'gak ada harapan', 'rusak',
        'berantakan', 'gagal total', 'kiamat'
    ],
    rationalization: [
        'ya udahlah', 'gapapa sih', 'cuma sebentar', 'nanti aja',
        'besok aja', 'once in a while', 'gak masalah kok'
    ],
    minimizing: [
        'cuma', 'sedikit doang', 'gak banyak', 'biasa aja'
    ]
};

function detectDistortions(text) {
    const result = {};
    Object.keys(DISTORTION_DICT).forEach((key) => {
        const evidence = sentencesWithTerms(text, DISTORTION_DICT[key]);
        result[key] = {
            present: evidence.length > 0,
            evidence: evidence.slice(0, 3).map((e) => e.sentence)
        };
    });
    return result;
}

/* ---------- Ambivalence / conflict ---------- */
const AMBIVALENCE_MARKERS = [
    'tapi', 'namun', 'walaupun', 'meskipun',
    'sebenarnya', 'sejujurnya', 'di satu sisi'
];

function detectAmbivalence(text) {
    const evidence = sentencesWithTerms(text, AMBIVALENCE_MARKERS);
    return {
        present: evidence.length > 0,
        conflict_signal_count: evidence.length,
        evidence: evidence.slice(0, 5).map((e) => e.sentence)
    };
}

/* ---------- Metacognition / insight ---------- */
const METACOGNITION_TERMS = [
    'saya sadar', 'aku sadar', 'saya paham', 'baru sadar',
    'ternyata', 'saya mengerti', 'menyadari', 'saya tahu bahwa'
];

function detectMetacognition(text) {
    const evidence = sentencesWithTerms(text, METACOGNITION_TERMS);
    const insightLevel = evidence.length >= 2 ? 'high'
        : evidence.length === 1 ? 'moderate'
        : 'low';
    return {
        present: evidence.length > 0,
        insight_level: insightLevel,
        evidence: evidence.slice(0, 3).map((e) => e.sentence)
    };
}

/* ---------- Locus of control ---------- */
const AGENCY_TERMS = [
    'saya memilih', 'aku memilih', 'saya memutuskan',
    'saya bisa', 'aku bisa', 'saya kendalikan', 'saya berusaha'
];

const EXTERNAL_TERMS = [
    'terpaksa', 'gak bisa nahan', 'tidak bisa menahan',
    'di luar kendali', 'gak kuasa', 'dibuat', 'terjebak'
];

function locusOfControl(text) {
    const agencyEvidence = sentencesWithTerms(text, AGENCY_TERMS);
    const externalEvidence = sentencesWithTerms(text, EXTERNAL_TERMS);
    const a = agencyEvidence.length;
    const e = externalEvidence.length;

    let orientation = 'unknown';
    if (a > e) orientation = 'internal';
    else if (e > a) orientation = 'external';
    else if (a > 0 && e > 0) orientation = 'mixed';

    return {
        orientation,
        agency_count: a,
        external_count: e,
        agency_evidence: agencyEvidence.slice(0, 3).map((x) => x.sentence),
        external_evidence: externalEvidence.slice(0, 3).map((x) => x.sentence)
    };
}

/* ---------- Temporal orientation ---------- */
const PRESENT_BIAS_TERMS = [
    'nikmat sekarang', 'senang dulu', 'puas sekarang',
    'gak peduli nanti', 'yang penting sekarang'
];

const FUTURE_TERMS = [
    'masa depan', 'besok', 'nanti', 'jangka panjang',
    'tujuan', 'cita-cita'
];

function temporalOrientation(text) {
    const presentEvidence = sentencesWithTerms(text, PRESENT_BIAS_TERMS);
    const futureEvidence = sentencesWithTerms(text, FUTURE_TERMS);
    const p = presentEvidence.length;
    const f = futureEvidence.length;

    let bias = 'balanced';
    if (p > f) bias = 'present';
    else if (f > p) bias = 'future';

    return {
        bias,
        present_count: p,
        future_count: f,
        present_evidence: presentEvidence.slice(0, 3).map((x) => x.sentence),
        future_evidence: futureEvidence.slice(0, 3).map((x) => x.sentence)
    };
}

/* ---------- Digital archetypes ---------- */
const ARCHETYPE_DICT = {
    doomscrolling: [
        'doomscroll', 'berita buruk', 'scroll berita',
        'konten negatif', 'scroll sampai lupa waktu'
    ],
    revenge_bedtime: [
        'begadang', 'balas dendam', 'melek sampai pagi',
        'stay up late', 'tidur larut'
    ],
    fomo: [
        'takut ketinggalan', 'fomo', 'takut gak update',
        'takut ketinggalan info'
    ],
    rage_bait: [
        'marah', 'kesal', 'emosi', 'geram', 'konten bikin kesel'
    ],
    escapism: [
        'pelarian', 'lari dari masalah', 'biar lupa', 'menghindar'
    ]
};

function digitalArchetypes(text) {
    const result = {};
    Object.keys(ARCHETYPE_DICT).forEach((key) => {
        const evidence = sentencesWithTerms(text, ARCHETYPE_DICT[key]);
        result[key] = {
            present: evidence.length > 0,
            evidence: evidence.slice(0, 2).map((e) => e.sentence)
        };
    });
    return result;
}

/* ---------- Linguistic complexity ---------- */
function linguisticComplexity(text) {
    const safeText = String(text || '');
    const sentences = splitSentences(safeText);
    const words = safeText.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));

    const avgSentenceLength = sentences.length
        ? words.length / sentences.length
        : 0;

    const diversity = words.length
        ? uniqueWords.size / words.length
        : 0;

    const hedging = countMatches(safeText, [
        'mungkin', 'kayaknya', 'sepertinya', 'kurang tahu',
        'gak yakin', 'maybe', 'perhaps'
    ]);

    const certainty = countMatches(safeText, [
        'pasti', 'yakin', 'jelas', 'tentu', 'certain'
    ]);

    return {
        sentence_count: sentences.length,
        word_count: words.length,
        avg_sentence_length: Math.round(avgSentenceLength * 10) / 10,
        lexical_diversity: Math.round(diversity * 100) / 100,
        hedging_count: hedging.length,
        certainty_count: certainty.length
    };
}

/* ---------- Risk stratification ---------- */
function stratifyRisk(base, adv) {
    let points = 0;
    const reasons = [];

    if (base && base.temporal && base.temporal.behavior_escalation) {
        points += 2;
        reasons.push('behavior_escalation');
    }

    if (base && base.habit_loop && base.habit_loop.loop_detected) {
        points += 2;
        reasons.push('habit_loop_present');
    }

    if (
        base &&
        base.emotional_analysis &&
        base.emotional_analysis.pattern &&
        base.emotional_analysis.pattern.mismatch
    ) {
        points += 2;
        reasons.push('short_term_reward_long_term_cost');
    }

    if (base && base.scores) {
        const s = base.scores;

        if (s.loss_of_control_score && s.loss_of_control_score.value >= 7) {
            points += 2;
            reasons.push('high_loss_of_control');
        }

        if (s.emotional_dependency_score && s.emotional_dependency_score.value >= 7) {
            points += 2;
            reasons.push('high_emotional_dependency');
        }

        if (s.functional_impact_score && s.functional_impact_score.value >= 7) {
            points += 2;
            reasons.push('high_functional_impact');
        }

        if (s.change_difficulty_score && s.change_difficulty_score.value >= 7) {
            points += 1;
            reasons.push('high_change_difficulty');
        }
    }

    if (adv && adv.distortions) {
        if (adv.distortions.catastrophizing && adv.distortions.catastrophizing.present) {
            points += 2;
            reasons.push('catastrophizing');
        }

        if (adv.distortions.rationalization && adv.distortions.rationalization.present) {
            points += 1;
            reasons.push('rationalization');
        }
    }

    if (adv && adv.locus && adv.locus.orientation === 'external') {
        points += 1;
        reasons.push('external_locus');
    }

    if (adv && adv.temporal && adv.temporal.bias === 'present') {
        points += 1;
        reasons.push('present_bias');
    }

    if (adv && adv.ambivalence && adv.ambivalence.conflict_signal_count >= 3) {
        points += 1;
        reasons.push('high_ambivalence');
    }

    let level = 'low';
    if (points >= 10) level = 'critical';
    else if (points >= 7) level = 'high';
    else if (points >= 4) level = 'moderate';

    return {
        level,
        points,
        reasons
    };
}

/* ---------- Intervention matching ---------- */
function matchInterventions(base, adv) {
    const recs = [];
    const s = (base && base.scores) || {};

    const val = (key) => {
        return s[key] && typeof s[key].value === 'number'
            ? s[key].value
            : 0;
    };

    const ev = (key) => {
        return (s[key] && s[key].evidence ? s[key].evidence : []).slice(0, 2);
    };

    if (val('time_disruption_score') >= 6) {
        recs.push({
            strategy: 'time_boxing',
            rationale: 'Gangguan waktu tinggi. Jadwalkan jendela khusus untuk aktivitas digital dan pasang alarm.',
            evidence: ev('time_disruption_score')
        });
    }

    if (val('emotional_dependency_score') >= 6) {
        recs.push({
            strategy: 'emotion_regulation',
            rationale: 'Ketergantungan emosional terdeteksi. Latih alternatif regulasi emosi sebelum mengakses aplikasi.',
            evidence: ev('emotional_dependency_score')
        });
    }

    if (val('functional_impact_score') >= 6) {
        recs.push({
            strategy: 'environment_design',
            rationale: 'Dampak fungsional tinggi. Ubah lingkungan: hapus shortcut, aktifkan grayscale, pisahkan perangkat kerja.',
            evidence: ev('functional_impact_score')
        });
    }

    if (val('change_difficulty_score') >= 6) {
        recs.push({
            strategy: 'tiny_habits',
            rationale: 'Perubahan terasa sulit. Mulai dari pengurangan kecil, jangan berhenti total mendadak.',
            evidence: ev('change_difficulty_score')
        });
    }

    if (adv && adv.distortions && adv.distortions.rationalization && adv.distortions.rationalization.present) {
        recs.push({
            strategy: 'cognitive_reframing',
            rationale: 'Terlihat rasionalisasi. Buat catatan biaya nyata setiap kali muncul pikiran "cuma sebentar".',
            evidence: adv.distortions.rationalization.evidence || []
        });
    }

    if (adv && adv.locus && adv.locus.orientation === 'external') {
        recs.push({
            strategy: 'agency_building',
            rationale: 'Locus eksternal dominan. Latih kalimat pilihan: "Saya memilih untuk..." untuk memperkuat kendali.',
            evidence: adv.locus.external_evidence || []
        });
    }

    if (adv && adv.temporal && adv.temporal.bias === 'present') {
        recs.push({
            strategy: 'future_self_visualization',
            rationale: 'Bias masa kini kuat. Tulis surat untuk diri masa depan atau visualisasikan konsekuensi jangka panjang.',
            evidence: adv.temporal.present_evidence || []
        });
    }

    if (recs.length === 0) {
        recs.push({
            strategy: 'maintenance',
            rationale: 'Tidak ada risiko berat terdeteksi. Pertahankan kebiasaan sehat dan lakukan check-in berkala.',
            evidence: []
        });
    }

    return recs;
}

/* ---------- Orchestrator ---------- */
function analyzeAdvanced(text, baseResult) {
    const safeText = String(text || '');
    const base = baseResult || {};

    const causal = extractCausal(safeText);
    const distortions = detectDistortions(safeText);
    const ambivalence = detectAmbivalence(safeText);
    const metacognition = detectMetacognition(safeText);
    const locus = locusOfControl(safeText);
    const temporal = temporalOrientation(safeText);
    const archetypes = digitalArchetypes(safeText);
    const complexity = linguisticComplexity(safeText);

    const adv = {
        causal,
        distortions,
        ambivalence,
        metacognition,
        locus,
        temporal,
        archetypes,
        complexity
    };

    const risk = stratifyRisk(base, adv);
    const interventions = matchInterventions(base, adv);

    return {
        schema_version: 'advanced-1.0',
        causal,
        distortions,
        ambivalence,
        metacognition,
        locus,
        temporal,
        archetypes,
        complexity,
        risk,
        interventions
    };
}

function analyzeFull(text) {
    if (!global.AtlasBehavioralNLP) {
        throw new Error('[AtlasBehavioralAdvanced] AtlasBehavioralNLP belum dimuat.');
    }

    const base = global.AtlasBehavioralNLP.analyzeBehavioral(text);
    const advanced = analyzeAdvanced(text, base);

    return Object.assign({}, base, { advanced });
}

global.AtlasBehavioralAdvanced = {
    analyzeAdvanced,
    analyzeFull,
    stratifyRisk,
    matchInterventions,
    extractCausal,
    detectDistortions,
    detectAmbivalence,
    detectMetacognition,
    locusOfControl,
    temporalOrientation,
    digitalArchetypes,
    linguisticComplexity
};

})(window);