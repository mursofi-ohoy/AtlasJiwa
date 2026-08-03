/* =========================================
   ATLAS JIWA — Behavioral Understanding Engine v1
   ---------------------------------------------------
   MODUL BARU, TERPISAH & REUSABLE.

   Tujuan: mengubah output nlp-engine.js (axis-based, sudah ada)
   menjadi struktur "Behavioral Understanding" yang lebih kaya —
   temporal reasoning, emotion transition, habit loop, functional
   impact per-domain, change readiness, dan skor kuantitatif
   ber-evidence — sesuai skema di bagian 10 dokumen tugas.

   PENTING — TIDAK MENGUBAH:
   - nlp-engine.js, keyword-dictionary.js, summary-engine.js, script.js
   - auth, JWT, D1 schema, integrasi Gemini, src/index.js

   Modul ini HANYA MEMBACA hasil AtlasNLPEngine.analyzeQualitative()
   dan AtlasKeywordDictionary yang sudah ada (reuse, tidak duplikasi
   logic negasi/intensifier/axis-scan yang sudah teruji), lalu
   menambah layer analisis baru di atasnya.

   Dimuat sebagai plain <script>, SETELAH keyword-dictionary.js
   dan nlp-engine.js (opsional — tidak wajib dipakai skrip lain
   sampai diintegrasikan secara sadar oleh developer).
   ========================================= */

(function (global) {
    'use strict';

    function requireDeps() {
        if (!global.AtlasKeywordDictionary || !global.AtlasNLPEngine) {
            throw new Error(
                '[AtlasBehavioralNLP] Membutuhkan keyword-dictionary.js dan nlp-engine.js ' +
                'dimuat terlebih dahulu.'
            );
        }
    }

    function splitSentences(text) {
        return text
            .split(/(?<=[.!?\n])\s+|\n+/)
            .map((s) => s.trim())
            .filter(Boolean);
    }

    function countMatches(text, terms) {
        const lower = text.toLowerCase();
        const hits = [];
        terms.forEach((t) => {
            const term = Array.isArray(t) ? t[0] : t;
            const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
            const m = lower.match(re);
            if (m) hits.push(term);
        });
        return hits;
    }

    /* ---------- 3. Temporal Reasoning ---------- */
    // Kamus kecil khusus temporal, TIDAK ada di keyword-dictionary.js
    // (yang fokus ke axis psikologis, bukan pola waktu).
    const ESCALATION_PATTERNS = [
        /dulu\s+(?:hanya|cuma)?\s*[\w\s]{0,20}?(\d+)\s*(menit|jam|hari)[\s\S]{0,40}?sekarang\s+[\w\s]{0,20}?(\d+)\s*(menit|jam|hari)/i,
        /(?:used to|before|previously)[\s\S]{0,40}?(\d+)\s*(minutes?|hours?|days?)[\s\S]{0,40}?now[\s\S]{0,30}?(\d+)\s*(minutes?|hours?|days?)/i
    ];
    const DURATION_REGEX = /(\d+)\s*(menit|jam|hari|minutes?|hours?|days?)/gi;
    const FREQUENCY_TERMS = [
        'setiap hari', 'tiap hari', 'terus-terusan', 'terus menerus', 'berkali-kali', 'sering banget',
        'every day', 'constantly', 'repeatedly', 'all the time', 'again and again'
    ];
    const NIGHT_PATTERN_TERMS = [
        'malam', 'begadang', 'tengah malam', 'subuh', 'sampai pagi',
        'at night', 'late at night', 'until morning', 'all night'
    ];

    function extractTemporal(text) {
        const durations = [];
        let m;
        const re = new RegExp(DURATION_REGEX);
        while ((m = re.exec(text)) !== null) {
            durations.push(`${m[1]} ${m[2]}`);
        }
        let escalation = false;
        let escalationEvidence = null;
        ESCALATION_PATTERNS.some((pattern) => {
            const match = text.match(pattern);
            if (match) {
                escalation = true;
                escalationEvidence = match[0];
                return true;
            }
            return false;
        });
        const frequencyHits = countMatches(text, FREQUENCY_TERMS);
        const nightHits = countMatches(text, NIGHT_PATTERN_TERMS);

        return {
            durations_mentioned: durations,
            frequency_markers: frequencyHits,
            night_pattern: nightHits.length > 0,
            night_pattern_evidence: nightHits,
            behavior_escalation: escalation,
            severity: escalation ? 'high' : (durations.length > 1 ? 'moderate' : 'low'),
            evidence: escalationEvidence ? [escalationEvidence] : []
        };
    }

    /* ---------- 4. Emotion Transition Analysis ---------- */
    // Menggunakan ulang axis "distress" (before/after) dan "escapism"/
    // "selfAwareness" (during) dari keyword-dictionary.js, dipisah
    // berdasarkan posisi relatif terhadap kata penghubung waktu
    // ("sebelum", "saat", "setelah", dst).
    const TRANSITION_MARKERS = {
        before: ['sebelum', 'awalnya', 'sebelumnya', 'before', 'initially'],
        during: ['saat', 'ketika', 'selagi', 'while', 'during', 'as i'],
        after: ['setelah', 'sesudah', 'habis itu', 'lalu jadi', 'after', 'afterwards', 'once i']
    };
    const AFTER_NEGATIVE_TERMS = [
        'menyesal', 'bersalah', 'kosong', 'hampa', 'lelah', 'sia-sia', 'buang waktu',
        'regret', 'guilty', 'empty', 'exhausted', 'waste of time', 'ashamed'
    ];
    const DURING_POSITIVE_TERMS = [
        'senang', 'nyaman', 'terhibur', 'lega', 'tenang', 'asik',
        'happy', 'comfortable', 'entertained', 'relieved', 'calm', 'fun'
    ];

    function analyzeEmotionTransition(text, qualResult) {
        const sentences = splitSentences(text);
        const distressBefore = [];
        const positiveDuring = [];
        const negativeAfter = [];

        sentences.forEach((s) => {
            const lower = s.toLowerCase();
            const hasBeforeMarker = TRANSITION_MARKERS.before.some((w) => lower.includes(w));
            const hasDuringMarker = TRANSITION_MARKERS.during.some((w) => lower.includes(w));
            const hasAfterMarker = TRANSITION_MARKERS.after.some((w) => lower.includes(w));

            const distressHits = countMatches(s, (global.AtlasKeywordDictionary.axes.distress || []));
            const duringHits = countMatches(s, DURING_POSITIVE_TERMS);
            const afterHits = countMatches(s, AFTER_NEGATIVE_TERMS);

            if (distressHits.length && (hasBeforeMarker || !hasDuringMarker && !hasAfterMarker)) {
                distressBefore.push({ sentence: s, terms: distressHits });
            }
            if (duringHits.length && (hasDuringMarker || (!hasBeforeMarker && !hasAfterMarker))) {
                positiveDuring.push({ sentence: s, terms: duringHits });
            }
            if (afterHits.length && (hasAfterMarker || afterHits.length)) {
                negativeAfter.push({ sentence: s, terms: afterHits });
            }
        });

        const shortTermReward = positiveDuring.length > 0;
        const longTermCost = negativeAfter.length > 0;

        return {
            before: { state: distressBefore.length ? 'negative' : 'unclear', evidence: distressBefore },
            during: { state: positiveDuring.length ? 'positive' : 'unclear', evidence: positiveDuring },
            after: { state: negativeAfter.length ? 'negative' : 'unclear', evidence: negativeAfter },
            pattern: {
                short_term_reward: shortTermReward,
                long_term_cost: longTermCost,
                mismatch: shortTermReward && longTermCost // pola klasik reinforcement negatif
            }
        };
    }

    /* ---------- 5. Functional Impact Extraction ---------- */
    // academic & professional belum ada di keyword-dictionary.js —
    // ditambahkan di sini sebagai kamus lokal modul ini supaya
    // keyword-dictionary.js (dipakai banyak modul lain) tidak perlu diubah.
    const ACADEMIC_TERMS = [
        'tugas tertunda', 'nilai turun', 'bolos', 'telat mengerjakan tugas', 'sulit konsentrasi belajar',
        'nilai jadi jelek', 'prestasi menurun', 'ngerjain tugas jadi molor',
        'assignments overdue', 'grades dropping', 'skipping class', 'trouble focusing on studying'
    ];
    const PROFESSIONAL_TERMS = [
        'produktivitas menurun', 'kerjaan tertunda', 'telat deadline', 'sering telat kerja',
        'susah fokus kerja', 'performa kerja menurun', 'bolos kerja',
        'productivity dropping', 'missing deadlines', 'late for work', 'trouble focusing at work'
    ];

    function extractFunctionalImpact(text) {
        const dict = global.AtlasKeywordDictionary;
        const socialHits = countMatches(text, dict.axes.socialWithdrawal || []);
        const healthHits = countMatches(text, dict.axes.physicalSymptoms || []);
        const academicHits = countMatches(text, ACADEMIC_TERMS);
        const professionalHits = countMatches(text, PROFESSIONAL_TERMS);

        return {
            academic: { present: academicHits.length > 0, evidence: academicHits },
            professional: { present: professionalHits.length > 0, evidence: professionalHits },
            social: { present: socialHits.length > 0, evidence: socialHits },
            health: { present: healthHits.length > 0, evidence: healthHits }
        };
    }

    /* ---------- 6. Habit Loop Detection ---------- */
    // Trigger = distress/escapism (alasan melakukan), Routine = perilaku
    // itu sendiri (diambil dari kalimat pemicu, generik karena domain
    // perilaku tidak ditentukan di layer ini), Reward = escapism/mood-
    // regulation terpenuhi, Consequence = withdrawal/physicalSymptoms/
    // distress-after yang disebut setelahnya.
    function detectHabitLoop(text, qualResult, emotionTransition) {
        const dict = global.AtlasKeywordDictionary;
        const escapismHits = countMatches(text, dict.axes.escapism || []);
        const withdrawalHits = countMatches(text, dict.axes.withdrawalSymptoms || []);

        const triggerEvidence = emotionTransition.before.evidence.map((e) => e.sentence);
        const rewardEvidence = escapismHits.length
            ? escapismHits
            : emotionTransition.during.evidence.map((e) => e.sentence);
        const consequenceEvidence = emotionTransition.after.evidence
            .map((e) => e.sentence)
            .concat(withdrawalHits);

        const complete = triggerEvidence.length > 0 && rewardEvidence.length > 0;

        // routine.evidence sebelumnya selalu [] walau lossOfControl axis
        // punya skor — sekarang diambil dari evidence axis yang sama
        // yang sudah dihitung nlp-engine.js (bukan sumber baru).
        const lossOfControlEntry = (qualResult.evidence || []).find((e) => e.axis === 'lossOfControl');
        const routineEvidence = lossOfControlEntry
            ? lossOfControlEntry.allQuotes.map((q) => q.sentence).slice(0, 3)
            : [];

        return {
            trigger: { present: triggerEvidence.length > 0, evidence: triggerEvidence },
            routine: { present: qualResult.axes.lossOfControl.score > 0, evidence: routineEvidence },
            reward: { present: rewardEvidence.length > 0, evidence: rewardEvidence },
            consequence: { present: consequenceEvidence.length > 0, evidence: consequenceEvidence },
            loop_detected: complete && consequenceEvidence.length > 0
        };
    }

    /* ---------- 7. Change Readiness Analysis ---------- */
    const STAGE_TERMS = {
        precontemplation: [
            'gak masalah', 'nggak masalah', 'gak perlu berubah', 'biasa aja', 'fine as it is',
            "don't see a problem", 'no need to change',
            'santai aja', 'gak apa-apa kok', 'nggak apa-apa kok', 'wajar kok', 'semua orang juga gitu',
            'gak segitunya', 'nggak segitunya', "it's not a big deal", 'this is normal'
        ],
        contemplation: [
            'kepikiran mau berhenti', 'kadang kepikiran untuk mengurangi', 'mikir-mikir mau berubah',
            'thinking about cutting down', 'considering stopping', 'sometimes think i should change',
            'sebenarnya pengen berubah', 'kadang mikir ini udah kebablasan', 'jadi kepikiran juga',
            'mulai sadar ini masalah', 'mungkin harus mulai berubah', 'i wonder if i should stop',
            'starting to realize this is a problem'
        ],
        preparation: [
            'mau mulai coba kurangi', 'lagi cari cara', 'niat mulai minggu depan',
            'planning to start reducing', 'looking for ways to', 'about to try',
            'udah nyusun rencana', 'lagi nyari cara buat berhenti', 'niatnya mau detox',
            'mau install aplikasi pembatas', 'siap-siap buat mulai', 'getting ready to start',
            'making a plan to cut down'
        ],
        action: [
            'lagi coba kurangi', 'sudah mulai batasi', 'sudah mengurangi', 'lagi berusaha berhenti',
            'currently cutting down', 'started limiting', 'actively trying to stop',
            'sekarang lagi batasi waktu', 'udah pasang aplikasi pembatas', 'lagi jalanin digital detox',
            'seminggu ini udah kurangi', 'lagi disiplin batasi diri', 'i am currently limiting',
            'actively working on reducing'
        ],
        maintenance: [
            'sudah berhasil mengurangi selama', 'sudah bertahan tanpa', 'sudah konsisten',
            'have maintained this for', 'been consistent for', 'kept it up for',
            'udah sebulan konsisten', 'udah beberapa minggu bertahan', 'alhamdulillah bertahan',
            'berhasil jaga komitmen', "i've stayed consistent for", 'managed to keep this up'
        ]
    };

    function assessChangeReadiness(text) {
        const scores = {};
        Object.keys(STAGE_TERMS).forEach((stage) => {
            scores[stage] = countMatches(text, STAGE_TERMS[stage]);
        });
        let bestStage = 'precontemplation';
        let bestCount = -1;
        Object.keys(scores).forEach((stage) => {
            if (scores[stage].length > bestCount) {
                bestCount = scores[stage].length;
                bestStage = stage;
            }
        });
        // Kalau tidak ada satupun sinyal stage yang cocok, jangan
        // memaksakan klaim "precontemplation" — tandai unknown.
        const anySignal = Object.values(scores).some((arr) => arr.length > 0);
        return {
            stage: anySignal ? bestStage : 'unknown',
            evidence_by_stage: scores
        };
    }

    /* ---------- 8 & 9. Quantitative Feature Generation + Explainable Evidence ---------- */
    // Normalisasi weightedScore axis (dari nlp-engine.js, sudah evidence-
    // based lewat negasi/intensifier) ke skala 0-10, TIDAK membuat angka
    // baru tanpa dasar — evidence diambil dari evidenceByAxis yang sama.
    function normalizeToTen(score) {
        return Math.max(0, Math.min(10, Math.round(score * 2 * 10) / 10));
    }

    function computeQuantitativeScores(qualResult, temporal, functionalImpact, emotionTransition) {
        const axes = qualResult.axes;
        const evidenceMap = {};
        qualResult.evidence.forEach((e) => { evidenceMap[e.axis] = e.allQuotes.map((q) => q.sentence); });

        const lossOfControlScore = normalizeToTen(axes.lossOfControl.score);
        const timeDisruptionScore = normalizeToTen(
            axes.lossOfControl.score * 0.4 + (temporal.behavior_escalation ? 2 : 0) + (temporal.night_pattern ? 1 : 0)
        );
        const emotionalDependencyScore = normalizeToTen(
            (axes.withdrawalSymptoms ? axes.withdrawalSymptoms.score : 0) * 0.6 +
            (axes.escapism ? axes.escapism.score : 0) * 0.6
        );
        const functionalImpactCount = Object.values(functionalImpact).filter((v) => v.present).length;
        const functionalImpactScore = normalizeToTen(functionalImpactCount * 1.3 + (axes.physicalSymptoms.score * 0.3));
        const changeDifficultyScore = normalizeToTen(
            (axes.relapsePattern ? axes.relapsePattern.score : 0) * 0.8 +
            (axes.minimization.score * 0.4)
        );

        const evidenceFor = (axisKey, extra) => {
            const list = (evidenceMap[axisKey] || []).slice(0, 2);
            return extra ? list.concat(extra).slice(0, 3) : list;
        };

        return {
            loss_of_control_score: {
                value: lossOfControlScore,
                evidence: evidenceFor('lossOfControl')
            },
            time_disruption_score: {
                value: timeDisruptionScore,
                evidence: evidenceFor('lossOfControl', temporal.evidence)
            },
            emotional_dependency_score: {
                value: emotionalDependencyScore,
                evidence: evidenceFor('withdrawalSymptoms', evidenceMap.escapism)
            },
            functional_impact_score: {
                value: functionalImpactScore,
                evidence: [].concat(
                    functionalImpact.social.evidence,
                    functionalImpact.health.evidence,
                    functionalImpact.academic.evidence,
                    functionalImpact.professional.evidence
                ).slice(0, 3)
            },
            change_difficulty_score: {
                value: changeDifficultyScore,
                evidence: evidenceFor('relapsePattern', evidenceMap.minimization)
            }
        };
    }

    /* ---------- 2. Behavioral Pattern Extraction (ringkasan berlabel) ---------- */
    function extractBehaviorPatterns(qualResult) {
        const patterns = [];
        const axes = qualResult.axes;
        if (axes.lossOfControl.score >= 1) {
            patterns.push({ pattern: 'loss_of_control', confidence: Math.min(1, axes.lossOfControl.score / 4) });
        }
        if (axes.withdrawalSymptoms && axes.withdrawalSymptoms.score >= 1) {
            patterns.push({ pattern: 'compulsive_behavior', confidence: Math.min(1, axes.withdrawalSymptoms.score / 3) });
        }
        if (axes.escapism && axes.escapism.score >= 1) {
            patterns.push({ pattern: 'emotional_coping', confidence: Math.min(1, axes.escapism.score / 3) });
        }
        if (axes.toleranceEscalation && axes.toleranceEscalation.score >= 1) {
            patterns.push({ pattern: 'reward_seeking', confidence: Math.min(1, axes.toleranceEscalation.score / 3) });
        }
        return patterns;
    }

    /* =========================================================
ATLAS JIWA — Behavioral Semantic Extraction Layer
UPGRADE NLP: jangan hapus fungsi lama.
Tambahkan blok ini sebelum analyzeBehavioral().
========================================================= */

/* ---------- Behavioral phrase dictionaries ---------- */

const LOSS_OF_CONTROL_PHRASES = [
    'tidak bisa berhenti', 'nggak bisa berhenti', 'tidak dapat berhenti',
    'tidak mampu berhenti', 'tidak bisa mengendalikan', 'tidak bisa mengontrol',
    'tidak bisa menahan', 'tidak kuasa berhenti', 'terus menerus', 'terus-menerus',
    'berulang kali', 'berulang-ulang', 'tidak berhenti', 'nggak berhenti',
    'kebablasan', 'tanpa sadar', 'otomatis', 'reflek', 'tidak sadar',
    'gagal berhenti', 'gagal mengurangi', 'tidak berhasil berhenti',
    'tidak berhasil mengurangi', 'tidak bisa menghentikan', 'tidak bisa lepas',
    'selalu gagal berhenti',
    // --- tambahan: variasi kolokial yang umum dipakai pengguna ---
    'susah berhenti', 'susah lepas', 'gatel kalau gak', 'gatal kalau nggak',
    'udah kayak candu', 'kaya kecanduan', 'tangan otomatis buka',
    'tanpa mikir langsung buka', 'refleks buka hp', 'gak ngeh udah berjam-jam',
    'nggak ngeh udah berjam-jam', 'baru sadar udah lama', 'susah kontrol diri',
    'kontrol diri lemah', 'impulsif banget', 'gak bisa nolak buka',
    'nggak bisa nolak buka', "can't stop", "unable to stop",
    "can't control myself", "out of control", "compulsively", "compulsive urge"
];

const EXCESSIVE_DURATION_PHRASES = [
    'berjam-jam', 'berjam jam', 'berjam', 'sepanjang hari', 'sampai pagi',
    'hingga pagi', 'tengah malam', 'begadang', 'jam tanpa henti',
    'jam tanpa berhenti', 'lama sekali', 'berjam-jam lamanya',
    'sampai lupa waktu', 'kehilangan waktu', 'lupa waktu',
    'satu jam', 'dua jam', 'tiga jam', 'empat jam', 'lima jam',
    'enam jam', '7 jam', '8 jam',
    // --- tambahan ---
    'seharian penuh', 'nonstop', 'non-stop', 'tanpa jeda', 'sampai mata perih',
    'sampai baterai habis', 'sampai lowbat', 'sampai kuota habis',
    'sampai ketiduran pegang hp', 'gak berasa udah malam', 'nggak berasa udah malam',
    'time flies', 'hours pass', 'lost track of time', 'all day long', 'all night'
];

const FUNCTIONAL_IMPAIRMENT_PHRASES = [
    'pekerjaan terganggu', 'kerjaan terganggu', 'pekerjaan menurun',
    'kinerja menurun', 'nilai turun', 'nilai jelek', 'nilai anjlok',
    'prestasi turun', 'bolos', 'tidak masuk kerja', 'telat deadline',
    'melewati deadline', 'tugas terbengkalai', 'tugas tertunda',
    'hubungan rusak', 'hubungan terganggu', 'keluarga terganggu',
    'pasangan terganggu', 'tidak memerhatikan', 'tidak memperhatikan',
    'mengabaikan keluarga', 'mengabaikan pasangan', 'mengabaikan anak',
    'mengabaikan teman', 'mengabaikan tanggung jawab',
    'tanggung jawab terbengkalai', 'dipecat', 'dikeluarkan', 'ditegur',
    'dimarahi atasan', 'tidak fokus kerja', 'tidak fokus belajar',
    // --- tambahan ---
    'produktivitas turun', 'susah konsentrasi', 'sulit fokus', 'gampang terdistraksi',
    'sering ketiduran di kelas', 'sering ketiduran di kantor', 'telat bangun',
    'kesiangan terus', 'lupa makan', 'lupa mandi', 'lupa kewajiban',
    'nilai ujian jelek', 'ipk turun', 'skripsi terbengkalai',
    'kena SP', 'surat peringatan', 'performa kerja anjlok',
    'missing deadlines', 'grades dropped', 'productivity has dropped',
    'skipping responsibilities', 'falling behind at work'
];

const RELATIONSHIP_IMPACT_PHRASES = [
    'dimarahi istri', 'dimarahi suami', 'dimarahi pasangan',
    'dimarahi keluarga', 'dimarahi orang tua', 'pasangan marah',
    'istri marah', 'suami marah', 'keluarga marah', 'konflik',
    'bertengkar', 'tidak memerhatikan', 'tidak memperhatikan',
    'mengabaikan', 'tidak peduli', 'menjauh', 'hubungan renggang',
    'hubungan rusak', 'hubungan memburuk', 'pasangan kecewa',
    'keluarga kecewa', 'teman kecewa', 'tidak hadir',
    'tidak mendengarkan', 'tidak merespons', 'tidak menjawab',
    // --- tambahan ---
    'anak ngambek karena hp', 'anak minta ditemenin tapi sibuk hp',
    'pasangan ngerasa diabaikan', 'diprotes keluarga', 'dinasihati orang tua',
    'ditegur pasangan', 'sering berantem gara-gara hp', 'sering berantem gara-gara game',
    'jarang ngobrol sama keluarga', 'jarang quality time',
    'partner feels ignored', 'family complained', 'fighting because of my phone'
];

const FAILED_ATTEMPTS_PHRASES = [
    'sudah mencoba berhenti', 'mencoba berhenti', 'mencoba mengurangi',
    'sudah mencoba mengurangi', 'gagal berhenti', 'gagal mengurangi',
    'berkali-kali gagal', 'berkali kali gagal', 'tidak berhasil',
    'kambuh', 'mulai lagi', 'mengulang lagi', 'berusaha berhenti tapi',
    'berusaha mengurangi tapi', 'sudah berusaha tapi',
    'tidak mampu mengubah', 'selalu gagal', 'berkali-kali mencoba',
    // --- tambahan ---
    'sudah uninstall tapi install lagi', 'hapus aplikasi tapi pasang lagi',
    'niat detox gagal', 'digital detox gagal', 'coba puasa hp tapi gagal',
    'relapse', 'balik lagi ke kebiasaan lama', 'gak tahan lama', 'nggak tahan lama',
    'tried to quit but', 'tried to cut down but', 'keep relapsing', 'fell back into it'
];

const AWARENESS_PHRASES = [
    'saya sadar', 'aku sadar', 'saya tahu', 'aku tahu',
    'saya paham', 'aku paham', 'saya mengerti', 'menyadari',
    'saya menyadari', 'saya tahu saya', 'saya paham saya',
    'saya punya masalah', 'aku punya masalah', 'memang bermasalah',
    'saya kecanduan', 'aku kecanduan', 'saya mengakui',
    'aku mengakui', 'saya akui'
];

const CATASTROPHIZING_PHRASES = [
    'hidup saya selesai', 'hidupku selesai', 'semuanya hancur',
    'hidup hancur', 'masa depan hancur', 'tidak ada harapan',
    'semuanya berantakan', 'dunia kiamat', 'tidak ada gunanya',
    'saya gagal total', 'hidup saya berantakan', 'semuanya hilang'
];

const EMOTION_TRIGGER_TERMS = [
    'stres', 'bosan', 'sedih', 'cemas', 'kesepian', 'marah',
    'gelisah', 'jenuh', 'lelah', 'tekanan', 'banyak pikiran',
    'penat', 'frustasi', 'kecewa'
];

const EMOTION_REWARD_TERMS = [
    'tenang', 'nyaman', 'lega', 'terhibur', 'lupa', 'escape',
    'pelarian', 'damai', 'rileks', 'senang', 'puas', 'teralihkan'
];

const EMOTION_AFTER_TERMS = [
    'menyesal', 'putus asa', 'kehilangan waktu', 'bersalah',
    'kosong', 'hampa', 'kecewa', 'malu', 'sia-sia', 'buang waktu',
    'lelah', 'tidak produktif'
];

const ARCHETYPE_DICT = {
    doomscrolling: [
        'doomscroll', 'berita buruk', 'scroll berita',
        'konten negatif', 'scroll sampai lupa waktu'
    ],
    revenge_bedtime: [
        'begadang', 'balas dendam', 'melek sampai pagi',
        'stay up late', 'tidur larut', 'revenge bedtime',
        'me time malam hari', 'satu-satunya waktu bebas cuma malam'
    ],
    fomo: [
        'takut ketinggalan', 'fomo', 'takut gak update',
        'takut ketinggalan info', 'takut ketinggalan tren',
        'takut ketinggalan gosip', 'harus selalu update'
    ],
    rage_bait: [
        'marah karena konten', 'kesal lihat konten', 'emosi lihat konten',
        'geram lihat konten', 'konten bikin kesel', 'baper gara-gara komen',
        'debat di kolom komentar', 'ikutan war di sosmed'
    ],
    escapism: [
        'pelarian', 'lari dari masalah', 'biar lupa',
        'menghindar', 'supaya lupa', 'biar gak mikir masalah',
        'daripada mikirin masalah', 'pengalih perhatian dari masalah'
    ],
    // --- tambahan archetype ---
    binge_watching: [
        'nonton maraton', 'binge watching', 'binge-watching',
        'lanjut episode terus', 'auto-play episode berikutnya',
        'gak berhenti nonton', 'nggak berhenti nonton'
    ],
    compulsive_shopping: [
        'checkout terus', 'belanja online terus', 'impulsive buying',
        'belanja gak kepakai', 'nyesel abis belanja online',
        'keranjang belanja penuh terus', 'diskon flash sale bikin checkout'
    ],
    gaming_compulsion: [
        'push rank', 'grinding game', 'ngegrind game', 'gacha terus',
        'top up terus', 'susah logout game', 'susah stop main game',
        'main game sampai lupa waktu'
    ],
    validation_seeking: [
        'cek like terus', 'cek notifikasi terus', 'nunggu komentar',
        'nunggu di-notice', 'butuh validasi', 'insecure kalau gak dapat like',
        'checking for likes', 'checking notifications constantly'
    ],
    social_comparison: [
        'ngebandingin diri', 'membandingkan diri dengan orang lain',
        'ngerasa hidup orang lain lebih bagus', 'iri lihat pencapaian orang',
        'insecure lihat feed orang lain', 'comparing myself to others'
    ]
};

/* ---------- Locus of control, present-bias, ambivalensi ---------- */

const EXTERNAL_LOCUS_PHRASES = [
    'gara-gara', 'gara gara', 'bukan salah saya', 'bukan salah aku',
    'ya gimana lagi', 'terpaksa karena', 'kepaksa karena', 'karena orang lain',
    'karena lingkungan', 'karena keadaan', 'situasinya emang gitu',
    'semua orang juga gitu', 'karena stres kerjaan jadi', 'karena dipaksa',
    "it's not my fault", 'because of the situation', 'everyone else does it too',
    'i had no choice', "can't help it because"
];

const PRESENT_BIAS_PHRASES = [
    'yang penting sekarang', 'nanti dipikir belakangan', 'besok baru mikir',
    'yang penting seneng dulu', 'urusan nanti aja', 'mikirin besok belakangan',
    'nikmatin dulu aja', 'yaudah nanggung', 'toh cuma sekali ini',
    'live in the moment', "i'll deal with it later", 'worry about it tomorrow',
    'just enjoy it now'
];

const AMBIVALENCE_MARKERS = [
    'tapi di sisi lain', 'walaupun begitu', 'meskipun begitu', 'tapi juga',
    'di satu sisi', 'tapi sebenarnya', 'sebenarnya pengen berhenti tapi',
    'pengen berubah tapi susah', 'mau berhenti tapi belum bisa',
    'on the other hand', 'even though', 'but at the same time',
    'i want to stop but'
];

const INTENSITY_MODIFIERS = [
    'sangat', 'banget', 'bgt', 'parah', 'sekali', 'amat', 'sungguh',
    'ekstrem', 'ekstrim', 'luar biasa', 'gila-gilaan', 'gilaan',
    'very', 'extremely', 'so much', 'a lot'
];

/* Hitung berapa banyak modifier intensitas hadir dalam teks —
   dipakai sebagai pengali ringan pada skor keparahan, bukan
   sumber deteksi baru berdiri sendiri. */
function computeIntensity(text) {
    const hits = countMatches(text, INTENSITY_MODIFIERS);
    return {
        present: hits.length > 0,
        count: hits.length,
        // pengali 1.0 - 1.3, dibatasi supaya tidak mendominasi skor evidence-based
        multiplier: 1 + Math.min(0.3, hits.length * 0.1),
        evidence: hits
    };
}

const DISTORTION_DICT = {
    all_or_nothing: [
        'selalu', 'tidak pernah', 'nggak pernah', 'pasti gagal',
        'mustahil', 'semua orang', 'tidak ada yang'
    ],
    catastrophizing: CATASTROPHIZING_PHRASES,
    rationalization: [
        'ya udahlah', 'gapapa sih', 'cuma sebentar', 'nanti aja',
        'besok aja', 'once in a while', 'gak masalah kok'
    ],
    minimizing: [
        'cuma', 'sedikit doang', 'gak banyak', 'biasa aja'
    ]
};


/* ---------- Phrase evidence extractor ---------- */

function findPhraseEvidence(text, phrases) {
    const safeText = String(text || '');
    const lowerText = safeText.toLowerCase();
    const sentences = splitSentences(safeText);

    const matchedPhrases = [];

    (phrases || []).forEach((phrase) => {
        const p = String(phrase || '').toLowerCase();
        if (!p) return;

        if (lowerText.includes(p)) {
            matchedPhrases.push(phrase);
        }
    });

    if (!matchedPhrases.length) {
        return {
            present: false,
            phrases: [],
            evidence: []
        };
    }

    const evidence = [];

    sentences.forEach((sentence) => {
        const lowerSentence = sentence.toLowerCase();
        const found = matchedPhrases.filter((phrase) =>
            lowerSentence.includes(String(phrase).toLowerCase())
        );

        if (found.length) {
            evidence.push({
                sentence: sentence,
                phrases: found
            });
        }
    });

    return {
        present: true,
        phrases: matchedPhrases,
        evidence: evidence.slice(0, 3).map((e) => e.sentence)
    };
}


/* ---------- Behavioral feature extraction ---------- */

function extractBehavioralFeatures(text) {
    const safeText = String(text || '');

    const lossOfControl = findPhraseEvidence(safeText, LOSS_OF_CONTROL_PHRASES);
    const excessiveDuration = findPhraseEvidence(safeText, EXCESSIVE_DURATION_PHRASES);
    const functionalImpairment = findPhraseEvidence(safeText, FUNCTIONAL_IMPAIRMENT_PHRASES);
    const relationshipImpact = findPhraseEvidence(safeText, RELATIONSHIP_IMPACT_PHRASES);
    const failedAttempts = findPhraseEvidence(safeText, FAILED_ATTEMPTS_PHRASES);
    const catastrophizing = findPhraseEvidence(safeText, CATASTROPHIZING_PHRASES);

    const emotionTriggers = findPhraseEvidence(safeText, EMOTION_TRIGGER_TERMS);
    const emotionRewards = findPhraseEvidence(safeText, EMOTION_REWARD_TERMS);
    const emotionAfter = findPhraseEvidence(safeText, EMOTION_AFTER_TERMS);

    const externalLocus = findPhraseEvidence(safeText, EXTERNAL_LOCUS_PHRASES);
    const presentBias = findPhraseEvidence(safeText, PRESENT_BIAS_PHRASES);
    const ambivalence = findPhraseEvidence(safeText, AMBIVALENCE_MARKERS);
    const intensity = computeIntensity(safeText);

    return {
        loss_of_control: lossOfControl,
        excessive_duration: excessiveDuration,
        functional_impairment: functionalImpairment,
        relationship_impact: relationshipImpact,
        failed_attempts: failedAttempts,
        catastrophizing: catastrophizing,
        external_locus: externalLocus,
        present_bias: presentBias,
        ambivalence: ambivalence,
        intensity: intensity,
        emotional_regulation: {
            trigger_present: emotionTriggers.present,
            reward_present: emotionRewards.present,
            negative_after: emotionAfter.present,
            evidence: []
                .concat(
                    emotionTriggers.evidence,
                    emotionRewards.evidence,
                    emotionAfter.evidence
                )
                .slice(0, 3)
        }
    };
}


/* ---------- Awareness vs severity separation ---------- */

function computeAwareness(text) {
    const safeText = String(text || '');
    const awareness = findPhraseEvidence(safeText, AWARENESS_PHRASES);

    const hasProblemAcknowledgment = /saya (punya|memiliki) masalah|aku (punya|memiliki) masalah|saya kecanduan|aku kecanduan|memang bermasalah/i.test(safeText);

    let level = 'LOW';

    if (awareness.present && hasProblemAcknowledgment) {
        level = 'HIGH';
    } else if (awareness.present) {
        level = 'MODERATE';
    }

    return {
        level: level,
        present: awareness.present,
        evidence: awareness.evidence
    };
}


function computeSeverity(features, temporal) {
    let score = 0;
    const reasons = [];
    const evidence = [];

    function addEvidence(list) {
        (list || []).forEach((item) => {
            if (evidence.length < 5) {
                evidence.push(item);
            }
        });
    }

    if (features.loss_of_control.present) {
        score += 2;
        reasons.push('loss_of_control');
        addEvidence(features.loss_of_control.evidence);
    }

    if (features.excessive_duration.present) {
        score += 2;
        reasons.push('excessive_duration');
        addEvidence(features.excessive_duration.evidence);
    }

    if (features.functional_impairment.present) {
        score += 3;
        reasons.push('functional_impairment');
        addEvidence(features.functional_impairment.evidence);
    }

    if (features.relationship_impact.present) {
        score += 3;
        reasons.push('relationship_impact');
        addEvidence(features.relationship_impact.evidence);
    }

    if (features.failed_attempts.present) {
        score += 2;
        reasons.push('failed_attempts');
        addEvidence(features.failed_attempts.evidence);
    }

    if (features.emotional_regulation.negative_after) {
        score += 1;
        reasons.push('negative_after_effect');
        addEvidence(features.emotional_regulation.evidence);
    }

    if (temporal && temporal.behavior_escalation) {
        score += 1;
        reasons.push('behavior_escalation');
        addEvidence(temporal.evidence);
    }

    if (temporal && temporal.frequency_markers && temporal.frequency_markers.length) {
        score += 1;
        reasons.push('frequency_pattern');
    }

    if (temporal && temporal.night_pattern) {
        score += 1;
        reasons.push('night_pattern');
    }

    if (features.external_locus && features.external_locus.present) {
        score += 1;
        reasons.push('external_locus');
        addEvidence(features.external_locus.evidence);
    }

    if (features.present_bias && features.present_bias.present) {
        score += 1;
        reasons.push('present_bias');
        addEvidence(features.present_bias.evidence);
    }

    if (features.ambivalence && features.ambivalence.present) {
        score += 1;
        reasons.push('high_ambivalence');
        addEvidence(features.ambivalence.evidence);
    }

    // Pengali intensitas: hanya diterapkan pada skor yang SUDAH
    // punya evidence konkret (score > 0) — modifier seperti "banget"/
    // "parah" tidak pernah jadi sumber skor berdiri sendiri, hanya
    // memperkuat bukti perilaku yang sudah terdeteksi.
    const intensity = features.intensity || { multiplier: 1, present: false, evidence: [] };
    const rawScore = score;
    if (score > 0 && intensity.present) {
        score = Math.round(score * intensity.multiplier * 10) / 10;
        reasons.push('intensity_amplified');
    }

    let level = 'LOW';

    if (score >= 9) {
        level = 'VERY_HIGH';
    } else if (score >= 6) {
        level = 'HIGH';
    } else if (score >= 3) {
        level = 'MODERATE';
    }

    return {
        level: level,
        score: score,
        raw_score: rawScore,
        intensity_multiplier: intensity.present ? intensity.multiplier : 1,
        reasons: reasons,
        evidence: evidence
    };
}


/* ---------- Reliability based on behavioral evidence ---------- */

function computeReliability(text, features, temporal) {
    const safeText = String(text || '');
    let score = 0;
    const factors = [];

    if (temporal && temporal.durations_mentioned && temporal.durations_mentioned.length) {
        score += 25;
        factors.push('time_evidence');
    } else if (/\d+\s*(jam|menit|hari)/i.test(safeText)) {
        score += 20;
        factors.push('time_evidence');
    }

    if (features.functional_impairment.present) {
        score += 25;
        factors.push('impact_evidence');
    }

    if (features.relationship_impact.present) {
        score += 10;
        factors.push('relationship_impact_evidence');
    }

    if (features.loss_of_control.present) {
        score += 15;
        factors.push('behavioral_evidence');
    }

    if (features.failed_attempts.present) {
        score += 15;
        factors.push('failed_attempt_evidence');
    }

    if (features.excessive_duration.present) {
        score += 10;
        factors.push('duration_evidence');
    }

    const words = safeText.split(/\s+/).filter(Boolean);

    if (words.length > 30) {
        score += 10;
        factors.push('specificity');
    } else if (words.length > 15) {
        score += 5;
        factors.push('some_detail');
    }

    return {
        score: Math.min(100, score),
        factors: factors
    };
}


/* ---------- Risk dimensions ---------- */

function buildRiskDimensions(features, severity) {
    return {
        control: features.loss_of_control.present,
        duration: features.excessive_duration.present,
        functional: features.functional_impairment.present,
        relationship: features.relationship_impact.present,
        relapse: features.failed_attempts.present,
        emotional: features.emotional_regulation.negative_after,
        severity_level: severity.level
    };
}


/* ---------- Detected patterns ---------- */

function getDetectedPatterns(features) {
    const patterns = [];

    if (features.loss_of_control.present) {
        patterns.push('Loss of control');
    }

    if (features.excessive_duration.present) {
        patterns.push('Excessive duration');
    }

    if (features.functional_impairment.present) {
        patterns.push('Functional impairment');
    }

    if (features.relationship_impact.present) {
        patterns.push('Relationship impact');
    }

    if (features.failed_attempts.present) {
        patterns.push('Failed attempts');
    }

    if (features.emotional_regulation.trigger_present) {
        patterns.push('Emotional trigger');
    }

    if (features.emotional_regulation.negative_after) {
        patterns.push('Negative after-effect');
    }

    if (features.external_locus && features.external_locus.present) {
        patterns.push('External locus of control');
    }

    if (features.present_bias && features.present_bias.present) {
        patterns.push('Present-bias reasoning');
    }

    if (features.ambivalence && features.ambivalence.present) {
        patterns.push('Ambivalence toward change');
    }

    return patterns;
}


/* ---------- Explainable behavioral summary ---------- */

function generateBehavioralSummary(features, severity, awareness) {
    const patternLabels = [];

    if (features.loss_of_control.present) {
        patternLabels.push('kehilangan kontrol');
    }

    if (features.excessive_duration.present) {
        patternLabels.push('durasi berlebihan');
    }

    if (features.relationship_impact.present) {
        patternLabels.push('dampak hubungan');
    }

    if (features.functional_impairment.present) {
        patternLabels.push('gangguan fungsi');
    }

    if (features.failed_attempts.present) {
        patternLabels.push('upaya berhenti yang gagal');
    }

    if (!patternLabels.length) {
        return {
            id: 'Narasi belum memberikan bukti perilaku yang cukup spesifik untuk pola risiko.',
            en: 'The narrative does not yet provide sufficient specific behavioral evidence for risk patterns.'
        };
    }

    const id =
        'Narasi menunjukkan pola perilaku dengan tanda ' +
        patternLabels.join(', ') +
        '. Tingkat keparahan berbasis bukti: ' + severity.level +
        '. Kesadaran pengguna: ' + awareness.level + '.';

    const en =
        'The narrative indicates behavioral patterns with signs of ' +
        patternLabels.join(', ') +
        '. Evidence-based severity: ' + severity.level +
        '. User awareness: ' + awareness.level + '.';

    return {
        id: id,
        en: en
    };
}


/* ---------- Strategy recommendation based on evidence ---------- */

function generateRecommendedStrategy(features, distortions, changeReadinessStage) {
    const strategies = [];
    const safeDistortions = distortions || {};

    if (features.loss_of_control.present) {
        strategies.push({
            strategy: 'stimulus_control',
            rationale:
                'Kurangi pemicu langsung: hapus shortcut, logout, atau pisahkan perangkat dari jangkauan saat jam rawan. / Reduce immediate triggers: remove shortcuts, log out, or keep the device out of reach during high-risk hours.',
            evidence: features.loss_of_control.evidence.slice(0, 1)
        });
    }

    if (features.excessive_duration.present) {
        strategies.push({
            strategy: 'time_boxing',
            rationale:
                'Tetapkan jendela waktu spesifik dan alarm eksternal untuk menghentikan sesi. / Set a specific time window and use an external alarm to stop the session.',
            evidence: features.excessive_duration.evidence.slice(0, 1)
        });
    }

    if (features.relationship_impact.present) {
        strategies.push({
            strategy: 'relationship_repair',
            rationale:
                'Buat kesepakatan waktu bebas gadget dengan pasangan/keluarga dan latih kehadiran penuh. / Create gadget-free agreements with partner/family and practice full presence.',
            evidence: features.relationship_impact.evidence.slice(0, 1)
        });
    }

    if (features.functional_impairment.present) {
        strategies.push({
            strategy: 'priority_blocking',
            rationale:
                'Amankan tugas utama terlebih dahulu; gunakan blokir aplikasi selama jam kerja/belajar. / Protect priority tasks first; use app blockers during work/study hours.',
            evidence: features.functional_impairment.evidence.slice(0, 1)
        });
    }

    if (features.failed_attempts.present) {
        strategies.push({
            strategy: 'tiny_habits',
            rationale:
                'Mulai dari pengurangan sangat kecil dan konsisten, bukan berhenti total mendadak. / Start with very small, consistent reductions rather than abrupt total stopping.',
            evidence: features.failed_attempts.evidence.slice(0, 1)
        });
    }

    if (features.emotional_regulation.trigger_present) {
        strategies.push({
            strategy: 'emotion_regulation',
            rationale:
                'Siapkan alternatif regulasi emosi seperti napas, jalan singkat, atau journaling sebelum mengakses perilaku. / Prepare emotion-regulation alternatives such as breathing, short walks, or journaling before engaging in the behavior.',
            evidence: features.emotional_regulation.evidence.slice(0, 1)
        });
    }

    if ((safeDistortions.catastrophizing && safeDistortions.catastrophizing.present) ||
        (safeDistortions.rationalization && safeDistortions.rationalization.present) ||
        (safeDistortions.all_or_nothing && safeDistortions.all_or_nothing.present)) {
        strategies.push({
            strategy: 'cognitive_reframing',
            rationale:
                'Latih mengenali dan menantang pola pikir serba-hitam-putih atau katastrofik dengan bukti yang lebih seimbang. / Practice noticing and challenging all-or-nothing or catastrophic thoughts with more balanced evidence.',
            evidence: [].concat(
                (safeDistortions.catastrophizing && safeDistortions.catastrophizing.evidence) || [],
                (safeDistortions.rationalization && safeDistortions.rationalization.evidence) || []
            ).slice(0, 1)
        });
    }

    if (features.external_locus && features.external_locus.present) {
        strategies.push({
            strategy: 'agency_building',
            rationale:
                'Bantu identifikasi bagian mana dari situasi yang sebenarnya bisa dikendalikan pengguna, sekecil apa pun. / Help identify which parts of the situation the user can actually control, however small.',
            evidence: features.external_locus.evidence.slice(0, 1)
        });
    }

    if (features.present_bias && features.present_bias.present) {
        strategies.push({
            strategy: 'future_self_visualization',
            rationale:
                'Ajak membayangkan konsekuensi jangka panjang secara konkret untuk mengimbangi dorongan kepuasan instan. / Encourage concretely imagining long-term consequences to balance the pull of instant gratification.',
            evidence: features.present_bias.evidence.slice(0, 1)
        });
    }

    if (changeReadinessStage === 'maintenance') {
        strategies.push({
            strategy: 'maintenance',
            rationale:
                'Perkuat kebiasaan sehat yang sudah berjalan dan siapkan rencana pencegahan kambuh (relapse prevention). / Reinforce the healthy habit already in place and prepare a relapse-prevention plan.',
            evidence: []
        });
    }

    if (!strategies.length) {
        strategies.push({
            strategy: 'monitoring',
            rationale:
                'Lakukan pencatatan pola penggunaan untuk meningkatkan kesadaran sebelum intervensi lebih lanjut. / Track usage patterns to increase awareness before further intervention.',
            evidence: []
        });
    }

    return strategies;
}


/* ---------- Archetypes ---------- */

function detectArchetypes(text) {
    const safeText = String(text || '');
    const result = {};

    Object.keys(ARCHETYPE_DICT).forEach((key) => {
        result[key] = findPhraseEvidence(safeText, ARCHETYPE_DICT[key]);
    });

    return result;
}


/* ---------- Cognitive distortions ---------- */

function detectDistortions(text) {
    const safeText = String(text || '');
    const result = {};

    Object.keys(DISTORTION_DICT).forEach((key) => {
        result[key] = findPhraseEvidence(safeText, DISTORTION_DICT[key]);
    });

    return result;
}


/* ---------- Advanced compatibility layer ---------- */

// Ambang batas skor 0-10 untuk menandai satu dimensi kuantitatif
// sebagai "tinggi" — dipakai untuk melengkapi reasons di severity
// dengan sinyal dari layer skor (bukan hanya keyword mentah).
const HIGH_SCORE_THRESHOLD = 7;

function buildAdvancedLayer(baseResult) {
    const severity = baseResult.severity || { level: 'LOW', score: 0, reasons: [] };
    const strategies = baseResult.recommended_strategy || [];
    const archetypes = baseResult.archetypes || {};
    const distortions = baseResult.distortions || {};
    const scores = baseResult.scores || {};

    const reasons = severity.reasons.slice();
    const addReason = (key) => { if (reasons.indexOf(key) === -1) reasons.push(key); };

    if (scores.loss_of_control_score && scores.loss_of_control_score.value >= HIGH_SCORE_THRESHOLD) {
        addReason('high_loss_of_control');
    }
    if (scores.emotional_dependency_score && scores.emotional_dependency_score.value >= HIGH_SCORE_THRESHOLD) {
        addReason('high_emotional_dependency');
    }
    if (scores.functional_impact_score && scores.functional_impact_score.value >= HIGH_SCORE_THRESHOLD) {
        addReason('high_functional_impact');
    }
    if (scores.change_difficulty_score && scores.change_difficulty_score.value >= HIGH_SCORE_THRESHOLD) {
        addReason('high_change_difficulty');
    }
    if (distortions.rationalization && distortions.rationalization.present) {
        addReason('rationalization');
    }
    if (distortions.catastrophizing && distortions.catastrophizing.present) {
        addReason('catastrophizing');
    }

    return {
        schema_version: 'advanced-behavioral-2.1',
        risk: {
            level: severity.level,
            points: severity.score,
            reasons: reasons
        },
        interventions: strategies,
        archetypes: archetypes,
        distortions: distortions
    };
}


function analyzeFull(text) {
    const base = analyzeBehavioral(text);
    const advanced = buildAdvancedLayer(base);

    return Object.assign({}, base, { advanced: advanced });
}

    /* ---------- Orchestrator ---------- */
    function analyzeBehavioral(text) {
        requireDeps();
        const safeText = String(text || '');
        const qualResult = global.AtlasNLPEngine.analyzeQualitative(safeText);

        const temporal = extractTemporal(safeText);
        const emotionTransition = analyzeEmotionTransition(safeText, qualResult);
        const functionalImpact = extractFunctionalImpact(safeText);
        const habitLoop = detectHabitLoop(safeText, qualResult, emotionTransition);
        const changeReadiness = assessChangeReadiness(safeText);
        const scores = computeQuantitativeScores(qualResult, temporal, functionalImpact, emotionTransition);
        const behaviorPatterns = extractBehaviorPatterns(qualResult);

        const riskIndicators = [];
        if (temporal.behavior_escalation) riskIndicators.push('behavior_escalation');
        if (habitLoop.loop_detected) riskIndicators.push('habit_loop_present');
        if (emotionTransition.pattern.mismatch) riskIndicators.push('short_term_reward_long_term_cost_mismatch');
        if (qualResult.meta.urgent) riskIndicators.push('urgency_markers_present');
        if (functionalImpact.health.present) riskIndicators.push('physical_symptoms_present');

        const protectiveFactors = [];
        if (qualResult.axes.selfAwareness.score >= 1) protectiveFactors.push('self_awareness_present');
        if (qualResult.axes.copingEfficacy.score >= 1) protectiveFactors.push('coping_strategy_present');
        if (changeReadiness.stage === 'action' || changeReadiness.stage === 'maintenance') {
            protectiveFactors.push('active_change_effort');
        }

        // Confidence keseluruhan: gabungan reliability (panjang/keragaman
        // jawaban, sudah dihitung nlp-engine.js) dengan jumlah axis yang
        // punya evidence nyata — bukan angka arbitrer.
        const axesWithEvidence = qualResult.evidence.length;
        const confidence = Math.max(0, Math.min(1,
            (qualResult.meta.reliability / 100) * 0.6 + Math.min(1, axesWithEvidence / 5) * 0.4
        ));

        /* ---------- Layer semantik perilaku (v2) ----------
           PENTING: sebelumnya fungsi-fungsi ini (extractBehavioralFeatures,
           computeSeverity, computeAwareness, dst.) SUDAH ADA di file ini
           tapi TIDAK PERNAH dipanggil dari sini — akibatnya analyzeFull()
           selalu menghasilkan advanced layer kosong (severity LOW, tanpa
           archetype/distortion/strategy apa pun) apa pun isi narasinya.
           Disatukan di sini supaya analyzeBehavioral() jadi satu-satunya
           sumber kebenaran yang benar-benar lengkap. */
        const behavioralFeatures = extractBehavioralFeatures(safeText);
        const awareness = computeAwareness(safeText);
        const severity = computeSeverity(behavioralFeatures, temporal);
        const reliability = computeReliability(safeText, behavioralFeatures, temporal);
        const riskDimensions = buildRiskDimensions(behavioralFeatures, severity);
        const detectedPatterns = getDetectedPatterns(behavioralFeatures);
        const behavioralSummary = generateBehavioralSummary(behavioralFeatures, severity, awareness);
        const archetypes = detectArchetypes(safeText);
        const distortions = detectDistortions(safeText);
        const recommendedStrategy = generateRecommendedStrategy(behavioralFeatures, distortions, changeReadiness.stage);

        if (behavioralFeatures.loss_of_control.present && riskIndicators.indexOf('loss_of_control') === -1) {
            riskIndicators.push('loss_of_control');
        }
        if (behavioralFeatures.excessive_duration.present && riskIndicators.indexOf('excessive_duration') === -1) {
            riskIndicators.push('excessive_duration');
        }
        if (behavioralFeatures.functional_impairment.present && riskIndicators.indexOf('functional_impairment') === -1) {
            riskIndicators.push('functional_impairment');
        }
        if (behavioralFeatures.relationship_impact.present && riskIndicators.indexOf('relationship_impact') === -1) {
            riskIndicators.push('relationship_impact');
        }
        if (behavioralFeatures.failed_attempts.present && riskIndicators.indexOf('failed_attempts') === -1) {
            riskIndicators.push('failed_attempts');
        }
        if (behavioralFeatures.catastrophizing.present && riskIndicators.indexOf('catastrophizing_language') === -1) {
            riskIndicators.push('catastrophizing_language');
        }
        if (behavioralFeatures.external_locus.present && riskIndicators.indexOf('external_locus') === -1) {
            riskIndicators.push('external_locus');
        }
        if (behavioralFeatures.present_bias.present && riskIndicators.indexOf('present_bias') === -1) {
            riskIndicators.push('present_bias');
        }
        if (awareness.level === 'HIGH' && protectiveFactors.indexOf('high_problem_awareness') === -1) {
            protectiveFactors.push('high_problem_awareness');
        }
        if (behavioralFeatures.ambivalence.present && protectiveFactors.indexOf('ambivalence_present') === -1) {
            // Ambivalensi ("mau berhenti tapi susah") justru sinyal ada
            // motivasi berubah, bukan murni negatif — dicatat sebagai
            // faktor protektif SEKALIGUS risk indicator di atas, karena
            // dua sisi ambivalensi sama validnya untuk ditinjau konselor.
            protectiveFactors.push('ambivalence_present');
        }

        return {
            profile: {
                theme: qualResult.theme,
                word_count: qualResult.meta.wordCount,
                lexical_diversity: qualResult.meta.lexicalDiversity
            },
            behavior_patterns: behaviorPatterns,
            emotional_analysis: emotionTransition,
            habit_loop: habitLoop,
            functional_impact: functionalImpact,
            temporal: temporal,
            change_readiness: changeReadiness,
            risk_indicators: riskIndicators,
            protective_factors: protectiveFactors,
            scores: scores,
            evidence: qualResult.evidence,
            confidence: Math.round(confidence * 100) / 100,

            /* ---------- Output layer semantik baru ---------- */
            behavioral_features: behavioralFeatures,
            detected_patterns: detectedPatterns,
            awareness: awareness,
            awareness_level: awareness.level,
            severity: severity,
            severity_level: severity.level,
            reliability: reliability,
            reliability_score: reliability.score,
            risk_dimensions: riskDimensions,
            behavioral_summary: behavioralSummary,
            recommended_strategy: recommendedStrategy,
            archetypes: archetypes,
            distortions: distortions
        };
    }

    global.AtlasBehavioralNLP = {
        analyzeBehavioral,
        extractTemporal,
        analyzeEmotionTransition,
        extractFunctionalImpact,
        detectHabitLoop,
        assessChangeReadiness,
        computeQuantitativeScores,

        /* layer semantik v2 — diekspos juga satu-satu supaya bisa
           dipakai independen kalau dibutuhkan modul lain */
        extractBehavioralFeatures,
        computeAwareness,
        computeSeverity,
        computeReliability,
        buildRiskDimensions,
        getDetectedPatterns,
        generateBehavioralSummary,
        generateRecommendedStrategy,
        detectArchetypes,
        detectDistortions,
        buildAdvancedLayer,
        analyzeFull
    };

    /* Kompatibilitas: behavioral-integration.js memanggil
       window.AtlasBehavioralAdvanced.analyzeFull(). Kalau file
       atlas-behavioral-advanced.js terpisah belum ada, sediakan
       fallback yang kompatibel di sini — TIDAK menimpa jika sudah ada. */
    if (!global.AtlasBehavioralAdvanced || typeof global.AtlasBehavioralAdvanced !== 'object') {
        global.AtlasBehavioralAdvanced = {};
    }
    if (typeof global.AtlasBehavioralAdvanced.analyzeFull !== 'function') {
        global.AtlasBehavioralAdvanced.analyzeFull = analyzeFull;
    }
})(window);
