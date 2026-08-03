/* =========================================
ATLAS JIWA — Behavioral Advanced Engine v2 (BILINGUAL ID/EN)
---------------------------------------------------
PERUBAHAN v1 -> v2:
1. SELURUH rationale intervensi kini bilingual: field `rationale`
   tetap string gabungan "ID / EN" (backward-compatible dengan
   behavioral-integration.js lama), ditambah `rationale_bi:{id,en}`
   untuk renderer baru yang menampilkannya bertumpuk.
2. Kamus deteksi diperluas dua bahasa (ID & EN) supaya jawaban
   berbahasa Inggris terdeteksi sama baiknya.
3. DIMENSI BARU (bilingual, evidence-based):
   - financial_behavior : kosakata uang/pengeluaran/utang
     (top up, gacha, loot box, checkout impulsif, paylater, dst.)
   - habit_displacement : perilaku menggeser rutinitas dasar
     (lupa makan/tidur, menunda, otomatis tanpa sadar, dst.)
   - need_beliefs       : pandangan/keyakinan kebutuhan akan
     scrolling/game ("satu-satunya cara", "me time", "semua orang
     juga", "team butuh saya", "takut ketinggalan info", dst.)
4. Archetype diperluas (binge_watching, compulsive_shopping,
   gaming_compulsion, validation_seeking, social_comparison) —
   label bilingualnya SUDAH ADA di behavioral-integration.js.
TIDAK MENGUBAH: nlp-engine.js, keyword-dictionary.js,
summary-engine.js, script.js, auth, JWT, D1, Gemini, src/index.js.
API lama tetap dipertahankan (analyzeAdvanced, analyzeFull,
stratifyRisk, matchInterventions, dst.) — hanya menambah.
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

/* ---------- Causal reasoning (ID/EN) ---------- */
const CAUSAL_MARKERS = [
    'karena', 'sebab', 'gara-gara', 'akibat', 'akibatnya', 'sehingga',
    'bikin', 'membuat', 'due to', 'because', 'so that', 'as a result',
    'makes me', 'bikin saya'
];
function extractCausal(text) {
    const evidence = sentencesWithTerms(text, CAUSAL_MARKERS);
    return { present: evidence.length > 0, marker_count: evidence.length, evidence: evidence.slice(0, 5).map((e) => e.sentence) };
}

/* ---------- Cognitive distortions (ID/EN) ---------- */
const DISTORTION_DICT = {
    all_or_nothing: [
        'selalu', 'tidak pernah', 'nggak pernah', 'pasti', 'mustahil',
        'semua orang', 'tidak ada yang', 'always', 'never', 'impossible',
        'everyone', 'no one', 'all or nothing', 'semua atau tidak sama sekali'
    ],
    catastrophizing: [
        'hancur', 'tamat', 'gak ada harapan', 'rusak', 'berantakan',
        'gagal total', 'kiamat', 'ruined', 'destroyed', 'hopeless',
        'no hope', 'my life is over', 'everything is ruined', 'disaster',
        'hancur lebur', 'tamat riwayatku'
    ],
    rationalization: [
        'ya udahlah', 'gapapa sih', 'cuma sebentar', 'nanti aja', 'besok aja',
        'once in a while', 'gak masalah kok', "it's fine", 'just a little',
        'only for a moment', 'just this once', 'no big deal', 'besok saja', 'later aja'
    ],
    minimizing: [
        'cuma', 'sedikit doang', 'gak banyak', 'biasa aja', 'only a bit',
        'not much', "it's nothing", 'biasa saja', 'not a big deal'
    ]
};
function detectDistortions(text) {
    const result = {};
    Object.keys(DISTORTION_DICT).forEach((key) => {
        const evidence = sentencesWithTerms(text, DISTORTION_DICT[key]);
        result[key] = { present: evidence.length > 0, evidence: evidence.slice(0, 3).map((e) => e.sentence) };
    });
    return result;
}

/* ---------- Ambivalence (ID/EN) ---------- */
const AMBIVALENCE_MARKERS = [
    'tapi', 'namun', 'walaupun', 'meskipun', 'sebenarnya', 'sejujurnya',
    'di satu sisi', 'but', 'however', 'although', 'even though', 'actually',
    'honestly', 'on one side', 'di sisi lain', 'jujurnya'
];
function detectAmbivalence(text) {
    const evidence = sentencesWithTerms(text, AMBIVALENCE_MARKERS);
    return { present: evidence.length > 0, conflict_signal_count: evidence.length, evidence: evidence.slice(0, 5).map((e) => e.sentence) };
}

/* ---------- Metacognition (ID/EN) ---------- */
const METACOGNITION_TERMS = [
    'saya sadar', 'aku sadar', 'saya paham', 'baru sadar', 'ternyata',
    'saya mengerti', 'menyadari', 'saya tahu bahwa', 'i realize', 'i realized',
    'i am aware', 'now i understand', 'turns out', 'i know that', 'baru menyadari'
];
function detectMetacognition(text) {
    const evidence = sentencesWithTerms(text, METACOGNITION_TERMS);
    const insightLevel = evidence.length >= 2 ? 'high' : evidence.length === 1 ? 'moderate' : 'low';
    return { present: evidence.length > 0, insight_level: insightLevel, evidence: evidence.slice(0, 3).map((e) => e.sentence) };
}

/* ---------- Locus of control (ID/EN) ---------- */
const AGENCY_TERMS = [
    'saya memilih', 'aku memilih', 'saya memutuskan', 'saya bisa', 'aku bisa',
    'saya kendalikan', 'saya berusaha', 'i choose', 'i decided', 'i can',
    'i control', 'i am trying', 'saya mau berubah'
];
const EXTERNAL_TERMS = [
    'terpaksa', 'gak bisa nahan', 'tidak bisa menahan', 'di luar kendali',
    'gak kuasa', 'dibuat', 'terjebak', 'forced', "can't help it", 'trapped',
    'made me', 'beyond my control'
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
        orientation, agency_count: a, external_count: e,
        agency_evidence: agencyEvidence.slice(0, 3).map((x) => x.sentence),
        external_evidence: externalEvidence.slice(0, 3).map((x) => x.sentence)
    };
}

/* ---------- Temporal orientation (ID/EN) ---------- */
const PRESENT_BIAS_TERMS = [
    'nikmat sekarang', 'senang dulu', 'puas sekarang', 'gak peduli nanti',
    'yang penting sekarang', 'enjoy now', 'pleasure first', "don't care about later",
    'now matters', 'later is later'
];
const FUTURE_TERMS = [
    'masa depan', 'besok', 'nanti', 'jangka panjang', 'tujuan', 'cita-cita',
    'future', 'tomorrow', 'later', 'long term', 'goals', 'dreams'
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
        bias, present_count: p, future_count: f,
        present_evidence: presentEvidence.slice(0, 3).map((x) => x.sentence),
        future_evidence: futureEvidence.slice(0, 3).map((x) => x.sentence)
    };
}

/* ---------- Digital archetypes (ID/EN, diperluas) ---------- */
const ARCHETYPE_DICT = {
    doomscrolling: [
        'doomscroll', 'berita buruk', 'scroll berita', 'konten negatif',
        'scroll sampai lupa waktu', 'bad news', 'negative content', 'doomscrolling'
    ],
    revenge_bedtime: [
        'begadang', 'balas dendam', 'melek sampai pagi', 'stay up late',
        'tidur larut', 'revenge bedtime', 'staying up late as revenge'
    ],
    fomo: [
        'takut ketinggalan', 'fomo', 'takut gak update', 'takut ketinggalan info',
        'afraid of missing out', 'fear of missing out', 'scared to miss out'
    ],
    rage_bait: [
        'marah karena konten', 'kesal lihat konten', 'emosi lihat konten',
        'geram lihat konten', 'konten bikin kesel', 'angered by content',
        'outraged by posts', 'rage bait'
    ],
    escapism: [
        'pelarian', 'lari dari masalah', 'biar lupa', 'menghindar',
        'escape from problems', 'running away from problems', 'to forget it all'
    ],
    binge_watching: [
        'nonton maraton', 'binge watching', 'binge-watching', 'lanjut episode terus',
        'auto-play episode berikutnya', 'gak berhenti nonton', 'nggak berhenti nonton',
        'can't stop watching', 'next episode automatically'
    ],
    compulsive_shopping: [
        'checkout terus', 'belanja online terus', 'impulsive buying', 'belanja gak kepakai',
        'nyesel abis belanja online', 'keranjang belanja penuh terus', 'diskon flash sale bikin checkout',
        'compulsive shopping', 'full cart', 'flash sale makes me checkout'
    ],
    gaming_compulsion: [
        'push rank', 'grinding game', 'ngegrind game', 'gacha terus', 'top up terus',
        'susah logout game', 'susah stop main game', 'main game sampai lupa waktu',
        'can't stop playing', 'keep grinding', 'one more match'
    ],
    validation_seeking: [
        'cek like terus', 'cek notifikasi terus', 'nunggu komentar', 'nunggu di-notice',
        'butuh validasi', 'insecure kalau gak dapat like', 'checking for likes',
        'checking notifications constantly', 'waiting for comments'
    ],
    social_comparison: [
        'ngebandingin diri', 'membandingkan diri dengan orang lain',
        'ngerasa hidup orang lain lebih bagus', 'iri lihat pencapaian orang',
        'insecure lihat feed orang lain', 'comparing myself to others',
        'others' lives look better', 'jealous of people's achievements'
    ]
};
function digitalArchetypes(text) {
    const result = {};
    Object.keys(ARCHETYPE_DICT).forEach((key) => {
        const evidence = sentencesWithTerms(text, ARCHETYPE_DICT[key]);
        result[key] = { present: evidence.length > 0, evidence: evidence.slice(0, 2).map((e) => e.sentence) };
    });
    return result;
}

/* =========================================================
   DIMENSI BARU v2 — kosakata bilingual
   ========================================================= */

/* ---------- 1) Perilaku finansial (uang) ---------- */
const FINANCIAL_SPEND_TERMS = [
    // scrolling / belanja
    'boros', 'belanja impulsif', 'checkout impulsif', 'kalap belanja', 'belanja online',
    'flash sale', 'keranjang penuh', 'jajan online', 'bayar konten', 'konten berbayar',
    'langganan', 'subscription', 'kuota', 'paket data', 'langganan numpuk',
    'uang habis', 'duit habis', 'habis banyak uang', 'mengeluarkan uang', 'gaji habis',
    'tabungan habis', 'impulsive buying', 'overspending', 'wasteful', 'spent a lot',
    'money gone', 'drained my savings', 'data package', 'paid content', 'full cart',
    // gaming
    'top up', 'topup', 'gacha', 'loot box', 'buka loot box', 'battle pass', 'beli skin',
    'buy skin', 'beli item', 'buy item', 'in-app purchase', 'mikrotransaksi', 'microtransaction',
    'top up terus', 'keep topping up', 'spending on the game', 'habis buat top up'
];
const FINANCIAL_DEBT_TERMS = [
    'pinjol', 'paylater', 'pay later', 'kartu kredit', 'credit card', 'utang', 'debt',
    'ngutang', 'pinjam uang', 'borrow money', 'nunggak', 'cicilan', 'installment',
    'gali lubang tutup lubang', 'kredit macet', 'behind on payments', 'in debt'
];
function detectFinancialBehavior(text) {
    const spend = sentencesWithTerms(text, FINANCIAL_SPEND_TERMS);
    const debt = sentencesWithTerms(text, FINANCIAL_DEBT_TERMS);
    return {
        present: spend.length > 0 || debt.length > 0,
        spend_present: spend.length > 0,
        debt_present: debt.length > 0,
        evidence: spend.slice(0, 3).map((e) => e.sentence),
        debt_evidence: debt.slice(0, 2).map((e) => e.sentence)
    };
}

/* ---------- 2) Kebiasaan manusia (pergeseran rutinitas & otomatisme) ---------- */
const ROUTINE_DISPLACEMENT_TERMS = [
    'lupa makan', 'melewatkan makan', 'telat makan', 'skip meals', 'miss breakfast',
    'lupa mandi', 'skip shower', 'lupa tidur', 'kurang tidur', 'lose sleep', 'sleep less',
    'begadang', 'stay up late', 'staying up late', 'nunda tidur', 'delay sleep',
    'bangun kesiangan', 'kesiangan', 'oversleep', 'telat kerja', 'late for work',
    'telat sekolah', 'late for school', 'menunda tugas', 'menunda-nunda', 'postpone tasks',
    'procrastinate', 'putting things off', 'lupa kewajiban', 'mengabaikan tugas rumah',
    'neglect chores', 'ignore housework', 'rumah berantakan', 'house messy',
    'scrolling saat makan', 'scroll during meals', 'main game saat makan',
    'play games while eating', 'makan sambil main', 'eat while playing',
    'bawa hp ke kamar mandi', 'phone in the bathroom', 'scrolling di kamar mandi'
];
const AUTOMATICITY_TERMS = [
    'otomatis', 'automatically', 'without thinking', 'tanpa pikir', 'refleks', 'reflex',
    'kebiasaan', 'habit', 'hal pertama', 'first thing', 'begitu bangun', 'right after waking',
    'sebelum tidur', 'before bed', 'cek hp dulu', 'check my phone first', 'buka game dulu',
    'open the game first', 'tanpa sadar', 'unconsciously', 'kompulsif', 'compulsively'
];
function detectHabitDisplacement(text) {
    const displacement = sentencesWithTerms(text, ROUTINE_DISPLACEMENT_TERMS);
    const automaticity = sentencesWithTerms(text, AUTOMATICITY_TERMS);
    return {
        present: displacement.length > 0 || automaticity.length > 0,
        displacement_present: displacement.length > 0,
        automaticity_present: automaticity.length > 0,
        evidence: displacement.slice(0, 3).map((e) => e.sentence),
        automaticity_evidence: automaticity.slice(0, 2).map((e) => e.sentence)
    };
}

/* ---------- 3) Pandangan/keyakinan kebutuhan (scrolling & game) ---------- */
const NECESSITY_TERMS = [
    'saya butuh', 'aku butuh', 'butuh banget', 'kebutuhan saya', 'harus ada', 'must have',
    'tidak bisa tanpa', "can't live without", 'can't do without', 'really need', 'i need it',
    'need it to cope', 'tanpa itu saya', 'without it i', 'tidak bisa lepas dari',
    "can't stay away", 'harus scroll', 'have to scroll', 'harus main', 'have to play',
    'pokoknya harus', 'wajib buat saya'
];
const SOLE_COPING_TERMS = [
    'satu-satunya cara', 'cara satu-satunya', 'only way', 'the only thing that',
    'satu-satunya hiburan', 'only entertainment', 'only thing that relaxes me',
    'satu-satunya yang bikin rileks', 'pelarian utama', 'main escape', 'only escape',
    'penenang saya', 'cara terbaik untuk lupa', 'best way to forget',
    'stres hilang cuma lewat', 'my coping', 'coping saya'
];
const ENTITLEMENT_TERMS = [
    'me time', 'waktunya saya', 'my time', 'saya berhak', 'i deserve', 'reward diri',
    'self reward', 'self-reward', 'hadiah untuk diri', 'treat myself', 'hak saya', 'my right',
    'saya layak', 'i earned it', 'setelah hari yang panjang', 'after a long day',
    'kerja keras jadi boleh', 'worked hard so i can', 'balas dendam waktu', 'revenge time'
];
const NORMALIZATION_TERMS = [
    'semua orang juga', 'everyone does', 'everyone else', 'normal kok', "it's normal",
    'wajar', 'reasonable', 'tidak salah', 'not wrong', 'tidak merugikan', 'hurts no one',
    'selama tidak mengganggu', "as long as it doesn't interfere", 'orang lain lebih parah',
    'others are worse', 'masih mending', 'kan cuma', "it's just", 'hanya hiburan',
    'just entertainment', 'just for fun', 'cuma hiburan', 'nothing wrong'
];
const DOMAIN_SPECIFIC_NEED_TERMS = [
    // kebutuhan khas GAME
    'team butuh saya', 'my team needs me', 'guild butuh', 'guild needs me',
    'tanggung jawab ke tim', 'team responsibility', 'kasihan kalau tidak login',
    'daily reward sayang', 'waste daily reward', 'event terbatas', 'limited event',
    'sayang kalau dilewatkan', 'takut ketinggalan event', 'afraid to miss the event',
    'rank turun', 'rank drops', 'progress hilang', 'lose progress',
    // kebutuhan khas SCROLLING
    'butuh tahu info', 'need to stay updated', 'harus update', 'must stay updated',
    'takut ketinggalan berita', 'afraid of missing news', 'biar nyambung ngobrol',
    'so i can join conversations', 'supaya nyambung', 'to stay in the loop',
    'informasi penting', 'important information', 'merasa terhubung', 'feel connected',
    'konten bikin terhubung', 'content keeps me connected'
];
function detectNeedBeliefs(text) {
    const necessity = sentencesWithTerms(text, NECESSITY_TERMS);
    const soleCoping = sentencesWithTerms(text, SOLE_COPING_TERMS);
    const entitlement = sentencesWithTerms(text, ENTITLEMENT_TERMS);
    const normalization = sentencesWithTerms(text, NORMALIZATION_TERMS);
    const domainSpecific = sentencesWithTerms(text, DOMAIN_SPECIFIC_NEED_TERMS);
    const evidence = []
        .concat(necessity, soleCoping, entitlement, normalization, domainSpecific)
        .slice(0, 3).map((e) => e.sentence);
    return {
        present: necessity.length > 0 || soleCoping.length > 0 || entitlement.length > 0 ||
            normalization.length > 0 || domainSpecific.length > 0,
        perceived_necessity: necessity.length > 0,
        sole_coping: soleCoping.length > 0,
        entitlement: entitlement.length > 0,
        normalization: normalization.length > 0,
        domain_specific: domainSpecific.length > 0,
        evidence
    };
}

/* ---------- Linguistic complexity ---------- */
function linguisticComplexity(text) {
    const safeText = String(text || '');
    const sentences = splitSentences(safeText);
    const words = safeText.split(/\s+/).filter(Boolean);
    const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
    const avgSentenceLength = sentences.length ? words.length / sentences.length : 0;
    const diversity = words.length ? uniqueWords.size / words.length : 0;
    const hedging = countMatches(safeText, ['mungkin', 'kayaknya', 'sepertinya', 'kurang tahu', 'gak yakin', 'maybe', 'perhaps']);
    const certainty = countMatches(safeText, ['pasti', 'yakin', 'jelas', 'tentu', 'certain']);
    return {
        sentence_count: sentences.length, word_count: words.length,
        avg_sentence_length: Math.round(avgSentenceLength * 10) / 10,
        lexical_diversity: Math.round(diversity * 100) / 100,
        hedging_count: hedging.length, certainty_count: certainty.length
    };
}

/* ---------- Risk stratification (diperluas v2) ---------- */
function stratifyRisk(base, adv) {
    let points = 0;
    const reasons = [];
    if (base && base.temporal && base.temporal.behavior_escalation) { points += 2; reasons.push('behavior_escalation'); }
    if (base && base.habit_loop && base.habit_loop.loop_detected) { points += 2; reasons.push('habit_loop_present'); }
    if (base && base.emotional_analysis && base.emotional_analysis.pattern && base.emotional_analysis.pattern.mismatch) { points += 2; reasons.push('short_term_reward_long_term_cost'); }
    if (base && base.scores) {
        const s = base.scores;
        if (s.loss_of_control_score && s.loss_of_control_score.value >= 7) { points += 2; reasons.push('high_loss_of_control'); }
        if (s.emotional_dependency_score && s.emotional_dependency_score.value >= 7) { points += 2; reasons.push('high_emotional_dependency'); }
        if (s.functional_impact_score && s.functional_impact_score.value >= 7) { points += 2; reasons.push('high_functional_impact'); }
        if (s.change_difficulty_score && s.change_difficulty_score.value >= 7) { points += 1; reasons.push('high_change_difficulty'); }
    }
    if (adv && adv.distortions) {
        if (adv.distortions.catastrophizing && adv.distortions.catastrophizing.present) { points += 2; reasons.push('catastrophizing'); }
        if (adv.distortions.rationalization && adv.distortions.rationalization.present) { points += 1; reasons.push('rationalization'); }
    }
    if (adv && adv.locus && adv.locus.orientation === 'external') { points += 1; reasons.push('external_locus'); }
    if (adv && adv.temporal && adv.temporal.bias === 'present') { points += 1; reasons.push('present_bias'); }
    if (adv && adv.ambivalence && adv.ambivalence.conflict_signal_count >= 3) { points += 1; reasons.push('high_ambivalence'); }
    /* --- v2: finansial --- */
    if (adv && adv.financial_behavior && adv.financial_behavior.present) { points += 2; reasons.push('financial_behavior_present'); }
    if (adv && adv.financial_behavior && adv.financial_behavior.debt_present) { points += 2; reasons.push('financial_debt_terms'); }
    /* --- v2: kebiasaan --- */
    if (adv && adv.habit_displacement && adv.habit_displacement.displacement_present) { points += 1; reasons.push('daily_routine_displacement'); }
    if (adv && adv.habit_displacement && adv.habit_displacement.automaticity_present) { points += 1; reasons.push('habit_automaticity'); }
    /* --- v2: pandangan/keyakinan kebutuhan --- */
    if (adv && adv.need_beliefs) {
        if (adv.need_beliefs.perceived_necessity) { points += 1; reasons.push('perceived_necessity'); }
        if (adv.need_beliefs.sole_coping) { points += 2; reasons.push('sole_coping_belief'); }
        if (adv.need_beliefs.entitlement) { points += 1; reasons.push('entitlement_self_reward'); }
        if (adv.need_beliefs.normalization) { points += 1; reasons.push('normalization_belief'); }
        if (adv.need_beliefs.domain_specific) { points += 1; reasons.push('domain_specific_need'); }
    }
    let level = 'low';
    if (points >= 10) level = 'critical';
    else if (points >= 7) level = 'high';
    else if (points >= 4) level = 'moderate';
    return { level, points, reasons };
}

/* ---------- Intervention matching (rationale BILINGUAL v2) ---------- */
function biRationale(id, en) {
    return { rationale: id + ' / ' + en, rationale_bi: { id: id, en: en } };
}
function matchInterventions(base, adv) {
    const recs = [];
    const s = (base && base.scores) || {};
    const val = (key) => (s[key] && typeof s[key].value === 'number') ? s[key].value : 0;
    const ev = (key) => (s[key] && s[key].evidence ? s[key].evidence : []).slice(0, 2);

    if (val('time_disruption_score') >= 6) {
        recs.push(Object.assign({ strategy: 'time_boxing', evidence: ev('time_disruption_score') },
            biRationale('Gangguan waktu tinggi. Jadwalkan jendela khusus untuk aktivitas digital dan pasang alarm.',
                'High time disruption. Schedule dedicated windows for digital activity and set an external alarm.')));
    }
    if (val('emotional_dependency_score') >= 6) {
        recs.push(Object.assign({ strategy: 'emotion_regulation', evidence: ev('emotional_dependency_score') },
            biRationale('Ketergantungan emosional terdeteksi. Latih alternatif regulasi emosi sebelum mengakses aplikasi.',
                'Emotional dependency detected. Practice emotion-regulation alternatives before opening the app.')));
    }
    if (val('functional_impact_score') >= 6) {
        recs.push(Object.assign({ strategy: 'environment_design', evidence: ev('functional_impact_score') },
            biRationale('Dampak fungsional tinggi. Ubah lingkungan: hapus shortcut, aktifkan grayscale, pisahkan perangkat kerja.',
                'High functional impact. Redesign the environment: remove shortcuts, enable grayscale, separate work devices.')));
    }
    if (val('change_difficulty_score') >= 6) {
        recs.push(Object.assign({ strategy: 'tiny_habits', evidence: ev('change_difficulty_score') },
            biRationale('Perubahan terasa sulit. Mulai dari pengurangan kecil, jangan berhenti total mendadak.',
                'Change feels hard. Start with small reductions instead of quitting abruptly.')));
    }
    if (adv && adv.distortions && adv.distortions.rationalization && adv.distortions.rationalization.present) {
        recs.push(Object.assign({ strategy: 'cognitive_reframing', evidence: adv.distortions.rationalization.evidence || [] },
            biRationale('Terlihat rasionalisasi. Buat catatan biaya nyata setiap kali muncul pikiran "cuma sebentar".',
                'Rationalization detected. Keep a real-cost note whenever "just a moment" thoughts appear.')));
    }
    if (adv && adv.locus && adv.locus.orientation === 'external') {
        recs.push(Object.assign({ strategy: 'agency_building', evidence: adv.locus.external_evidence || [] },
            biRationale('Locus eksternal dominan. Latih kalimat pilihan: "Saya memilih untuk..." untuk memperkuat kendali.',
                'External locus dominant. Practice choice statements: "I choose to..." to strengthen control.')));
    }
    if (adv && adv.temporal && adv.temporal.bias === 'present') {
        recs.push(Object.assign({ strategy: 'future_self_visualization', evidence: adv.temporal.present_evidence || [] },
            biRationale('Bias masa kini kuat. Tulis surat untuk diri masa depan atau visualisasikan konsekuensi jangka panjang.',
                'Strong present bias. Write a letter to your future self or visualize long-term consequences.')));
    }
    /* --- v2: intervensi baru untuk 3 dimensi baru --- */
    if (adv && adv.financial_behavior && adv.financial_behavior.present) {
        recs.push(Object.assign({ strategy: 'financial_boundary', evidence: adv.financial_behavior.evidence || [] },
            biRationale('Ada pola pengeluaran terkait perilaku. Pisahkan alat pembayaran, hapus metode bayar tersimpan, dan tetapkan anggaran hiburan bulanan.',
                'Spending patterns tied to the behavior exist. Separate payment tools, remove saved payment methods, and set a monthly entertainment budget.')));
    }
    if (adv && adv.habit_displacement && adv.habit_displacement.present) {
        recs.push(Object.assign({ strategy: 'routine_replacement', evidence: adv.habit_displacement.evidence || [] },
            biRationale('Perilaku menggeser rutinitas dasar (makan, tidur, kewajiban). Letakkan perangkat di luar kamar dan jadwalkan jam makan/tidur yang tetap.',
                'The behavior displaces basic routines (meals, sleep, duties). Keep the device out of the bedroom and fix meal/sleep times.')));
    }
    if (adv && adv.need_beliefs && adv.need_beliefs.present) {
        recs.push(Object.assign({ strategy: 'belief_restructuring', evidence: adv.need_beliefs.evidence || [] },
            biRationale('Perilaku diperkuat keyakinan "butuh / normal / satu-satunya cara". Uji keyakinan itu dengan bukti: catat hari tanpa perilaku dan bagaimana perasaan Anda.',
                'The behavior is reinforced by "need it / it\'s normal / only way" beliefs. Test them with evidence: log days without the behavior and how you feel.')));
    }
    if (recs.length === 0) {
        recs.push(Object.assign({ strategy: 'maintenance', evidence: [] },
            biRationale('Tidak ada risiko berat terdeteksi. Pertahankan kebiasaan sehat dan lakukan check-in berkala.',
                'No severe risk detected. Maintain healthy habits and do periodic check-ins.')));
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
    const financialBehavior = detectFinancialBehavior(safeText);   // BARU v2
    const habitDisplacement = detectHabitDisplacement(safeText);   // BARU v2
    const needBeliefs = detectNeedBeliefs(safeText);               // BARU v2
    const adv = {
        causal, distortions, ambivalence, metacognition, locus, temporal,
        archetypes, complexity,
        financial_behavior: financialBehavior,
        habit_displacement: habitDisplacement,
        need_beliefs: needBeliefs
    };
    const risk = stratifyRisk(base, adv);
    const interventions = matchInterventions(base, adv);
    return {
        schema_version: 'advanced-2.0-bilingual',
        causal, distortions, ambivalence, metacognition, locus, temporal,
        archetypes, complexity,
        financial_behavior: financialBehavior,
        habit_displacement: habitDisplacement,
        need_beliefs: needBeliefs,
        risk, interventions
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
    analyzeAdvanced, analyzeFull, stratifyRisk, matchInterventions,
    extractCausal, detectDistortions, detectAmbivalence, detectMetacognition,
    locusOfControl, temporalOrientation, digitalArchetypes, linguisticComplexity,
    detectFinancialBehavior, detectHabitDisplacement, detectNeedBeliefs
};
})(window);