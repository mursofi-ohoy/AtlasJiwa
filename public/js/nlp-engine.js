/* =========================================
   ATLAS JIWA — Client-Side Heuristic NLP Engine v3
   ---------------------------------------------------
   PERUBAHAN UTAMA v2 -> v3:

   1. Negasi sekarang "clause-bounded": scanAxis tidak lagi berhenti
      di jendela N-kata secara buta. Saat menelusuri kata-kata sebelum
      sebuah kecocokan (dari yang paling dekat ke yang paling jauh),
      pemindaian BERHENTI begitu bertemu token penghubung klausa
      ("tapi", "namun", "karena", dst — lihat clauseBoundaries di
      keyword-dictionary.js) SEBELUM bertemu negator. Ini memperbaiki
      salah baca seperti "saya tidak apa-apa, tapi cemas kalau
      ketinggalan info" — dulu berisiko dibaca "cemas" ternegasi
      karena "tidak" ada di jendela kata, sekarang "tapi" memutus
      jangkauan negasi sehingga "cemas" tetap terhitung.
   2. Mendukung 4 axis baru (tolerance, withdrawal, escapism, relapse)
      dari keyword-dictionary.js v3 — otomatis ikut terpindai karena
      scanAxis men-generalisasi seluruh dict.axes, tapi butuh label,
      template tema, dan klausa modular baru supaya tampil bermakna
      di UI (lihat AXIS_LABELS, BASE_TEMPLATES, buildModifierClauses).
   3. Menambah computeAxisRisk(): kalkulator skor risiko komposit
      berbasis polaritas axis (axisRiskPolarity di kamus), dipakai
      bersama oleh summary-engine.js supaya rumus risiko gabungan
      kualitatif+kuantitatif tidak terduplikasi di banyak file.
   4. Menambah evidence multi-kutipan (maks 2 kalimat per axis,
      bukan cuma 1) supaya bukti yang ditampilkan lebih representatif
      untuk jawaban panjang yang menyebut istilah sama beberapa kali
      dengan konteks berbeda.

   PERUBAHAN v3 -> v4:
   5. Menambah computeSynergy(): mendeteksi pasangan axis yang muncul
      dalam SATU kalimat yang sama (mis. tolerance + withdrawal) dan
      menambah "synergy bonus" ke skor risiko — pola gabungan seperti
      ini lebih bermakna secara klinis daripada axis independen yang
      dijumlahkan begitu saja. computeAxisRisk() sekarang menerima
      parameter kedua opsional untuk bonus ini (backward-compatible).
   6. Menambah computeReliability(): skor 0-100 seberapa banyak "modal"
      yang bisa dipercaya dari sebuah jawaban (panjang, keragaman kosa
      kata, jumlah kalimat) — dipakai untuk memberi catatan metodologis
      saat jawaban terlalu singkat untuk sinyal kuat, tanpa mengubah
      skor axis itu sendiri.

   Dimuat sebagai plain <script>. Harus dimuat SETELAH
   keyword-dictionary.js dan SEBELUM script.js.
   ========================================= */

(function (global) {
    'use strict';

    /* ---------- Util: normalisasi entri kamus ---------- */
    function normalizeEntry(entry) {
        if (Array.isArray(entry)) return { term: entry[0], weight: entry[1] };
        return { term: entry, weight: 1 };
    }

    function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /* ---------- Util: kalimat & jendela kata sebelum sebuah match ---------- */
    function splitSentences(text) {
        const raw = text.split(/(?<=[.!?\n])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
        if (raw.length === 0) return [{ text: text.trim(), start: 0, end: text.length }];
        const sentences = [];
        let cursor = 0;
        raw.forEach((s) => {
            const idx = text.indexOf(s, cursor);
            const start = idx === -1 ? cursor : idx;
            const end = start + s.length;
            sentences.push({ text: s, start, end });
            cursor = end;
        });
        return sentences;
    }

    function sentenceForIndex(sentences, index) {
        const found = sentences.find((s) => index >= s.start && index <= s.end);
        return found ? found.text : sentences[0].text;
    }

    // Mengembalikan kata-kata sebelum matchIndex, terurut dari yang PALING
    // DEKAT ke yang paling jauh (index 0 = kata tepat sebelum match). Urutan
    // ini penting supaya pemeriksaan negasi/boundary bisa berhenti di
    // penghalang klausa terdekat, bukan menyapu N-kata secara buta.
    function precedingWordsNearestFirst(text, matchIndex, n) {
        const before = text.slice(0, matchIndex);
        const words = before.trim().split(/\s+/).filter(Boolean);
        return words
            .slice(-n)
            .map((w) => w.replace(/[^\wà-ÿ']/gi, ''))
            .reverse();
    }

    /* ---------- Pemindaian satu axis ---------- */
    // Mengembalikan { weightedScore, rawCount, negatedCount, matches: [{term, weight, multiplier, index}] }
    function scanAxis(lowerText, axisEntries, dict) {
        const negators = dict.negators;
        const intensifiers = dict.intensifiers;
        const diminishers = dict.diminishers;
        const clauseBoundaries = dict.clauseBoundaries || [];

        let weightedScore = 0;
        let rawCount = 0;
        let negatedCount = 0;
        const matches = [];

        axisEntries.forEach((rawEntry) => {
            const { term, weight } = normalizeEntry(rawEntry);
            const firstWordOfTerm = term.split(/\s+/)[0].toLowerCase();
            const isNegationPhrase = negators.includes(firstWordOfTerm);

            const regex = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi');
            let m;
            while ((m = regex.exec(lowerText)) !== null) {
                // Jendela lebih lebar (5 kata) karena sekarang dibatasi oleh
                // clause boundary, bukan cuma panjang jendela.
                const ctxWords = precedingWordsNearestFirst(lowerText, m.index, 5);

                let negated = false;
                if (!isNegationPhrase) {
                    for (const w of ctxWords) {
                        if (clauseBoundaries.includes(w)) break; // jangkauan negasi terputus
                        if (negators.includes(w)) {
                            negated = true;
                            break;
                        }
                    }
                }

                let multiplier = 1;
                if (!negated) {
                    const closeWords = ctxWords.slice(0, 2); // 2 kata terdekat (sudah nearest-first)
                    if (closeWords.some((w) => intensifiers.includes(w))) {
                        multiplier = 1.5;
                    } else if (closeWords.some((w) => diminishers.includes(w))) {
                        multiplier = 0.5;
                    }
                }

                if (negated) {
                    negatedCount += 1;
                } else {
                    rawCount += 1;
                    weightedScore += weight * multiplier;
                    matches.push({ term, weight, multiplier, index: m.index });
                }

                if (regex.lastIndex === m.index) regex.lastIndex += 1; // guard zero-width
            }
        });

        return { weightedScore: Math.round(weightedScore * 100) / 100, rawCount, negatedCount, matches };
    }

    /* ---------- Label per axis (untuk tags & evidence) ---------- */
    const AXIS_LABELS = {
        distress: { id: 'Distres Emosional', en: 'Emotional Distress' },
        lossOfControl: { id: 'Kehilangan Kendali', en: 'Loss of Control' },
        minimization: { id: 'Minimalisasi/Penyangkalan', en: 'Minimization/Denial' },
        selfAwareness: { id: 'Kesadaran Diri', en: 'Self-Awareness' },
        socialWithdrawal: { id: 'Penarikan Sosial', en: 'Social Withdrawal' },
        physicalSymptoms: { id: 'Gejala Fisik', en: 'Physical Symptoms' },
        copingEfficacy: { id: 'Strategi Coping', en: 'Coping Strategy' },
        externalAttribution: { id: 'Atribusi Eksternal', en: 'External Attribution' },
        internalAttribution: { id: 'Atribusi Internal', en: 'Internal Attribution' },
        chronicity: { id: 'Kronisitas', en: 'Chronicity' },
        urgency: { id: 'Urgensi', en: 'Urgency' },
        toleranceEscalation: { id: 'Eskalasi Toleransi', en: 'Tolerance Escalation' },
        withdrawalSymptoms: { id: 'Gejala Putus (Withdrawal)', en: 'Withdrawal Symptoms' },
        escapism: { id: 'Pelarian/Regulasi Mood', en: 'Escapism / Mood Modification' },
        relapsePattern: { id: 'Pola Relaps Berulang', en: 'Recurring Relapse Pattern' }
    };

    const PRIMARY_AXES = [
        'distress', 'lossOfControl', 'minimization', 'selfAwareness', 'socialWithdrawal',
        'physicalSymptoms', 'copingEfficacy', 'toleranceEscalation', 'withdrawalSymptoms',
        'escapism', 'relapsePattern'
    ];

    /* ---------- Template dasar per tema utama ---------- */
    const BASE_TEMPLATES = {
        distressLossOfControl: {
            theme: { id: 'Perjuangan Pengendalian Diri & Distres Emosional', en: 'Struggle with Self-Control & Emotional Distress' },
            body: {
                id: 'Narasi Anda mengindikasikan distres emosional yang signifikan disertai kesulitan mengatur perilaku.',
                en: 'Your narrative indicates significant emotional distress accompanied by difficulty regulating behavior.'
            }
        },
        lossOfControl: {
            theme: { id: 'Kesulitan Mengendalikan Perilaku', en: 'Difficulty Controlling Behavior' },
            body: {
                id: 'Jawaban Anda berpusat pada kesulitan mengendalikan perilaku ini, lebih daripada pada muatan emosinya.',
                en: 'Your answer centers on difficulty controlling this behavior, more than on its emotional weight.'
            }
        },
        distress: {
            theme: { id: 'Beban Emosional yang Menonjol', en: 'Prominent Emotional Burden' },
            body: {
                id: 'Jawaban Anda didominasi oleh muatan emosi negatif terkait perilaku ini.',
                en: 'Your answer is dominated by negative emotional content related to this behavior.'
            }
        },
        selfAwarenessHealthy: {
            theme: { id: 'Kesadaran Diri & Regulasi Sehat', en: 'Self-Awareness & Healthy Regulation' },
            body: {
                id: 'Jawaban Anda mencerminkan introspeksi yang baik dan upaya regulasi diri yang sehat.',
                en: 'Your answer reflects good introspection and healthy self-regulation efforts.'
            }
        },
        minimizationShort: {
            theme: { id: 'Mekanisme Pertahanan / Minimalisasi', en: 'Defense Mechanism / Minimization' },
            body: {
                id: 'Jawaban singkat dan cenderung meminimalkan masalah — dalam psikologi ini bisa jadi mekanisme pertahanan (denial) untuk menghindari ketidaknyamanan.',
                en: 'The answer is brief and tends to minimize the issue — in psychology this can be a defense mechanism (denial) to avoid discomfort.'
            }
        },
        socialWithdrawal: {
            theme: { id: 'Penarikan Diri dari Interaksi Sosial', en: 'Withdrawal from Social Interaction' },
            body: {
                id: 'Jawaban Anda menonjolkan tema menjauh atau menarik diri dari orang-orang di sekitar Anda.',
                en: 'Your answer highlights a theme of distancing or withdrawing from the people around you.'
            }
        },
        physicalSymptoms: {
            theme: { id: 'Gejala Fisik yang Menyertai', en: 'Accompanying Physical Symptoms' },
            body: {
                id: 'Jawaban Anda menyebutkan gejala fisik yang tampaknya terkait dengan perilaku ini — aspek yang sering luput dari skala kuantitatif.',
                en: 'Your answer mentions physical symptoms that appear related to this behavior — an aspect often missed by quantitative scales.'
            }
        },
        toleranceEscalation: {
            theme: { id: 'Eskalasi Toleransi', en: 'Tolerance Escalation' },
            body: {
                id: 'Jawaban Anda menunjukkan pola khas "tolerance" pada kecanduan perilaku: durasi atau intensitas yang dibutuhkan untuk merasa "cukup" semakin bertambah dari waktu ke waktu.',
                en: 'Your answer shows a pattern typical of "tolerance" in behavioral addiction: the duration or intensity needed to feel "enough" keeps increasing over time.'
            }
        },
        withdrawalSymptoms: {
            theme: { id: 'Gejala Putus (Withdrawal)', en: 'Withdrawal Symptoms' },
            body: {
                id: 'Jawaban Anda menyebut kegelisahan, kecemasan, atau ketidaknyamanan emosional saat tidak bisa mengakses perilaku ini — pola yang dalam literatur kecanduan perilaku disebut gejala withdrawal.',
                en: 'Your answer mentions restlessness, anxiety, or emotional discomfort when unable to access this behavior — a pattern known in behavioral addiction literature as a withdrawal symptom.'
            }
        },
        escapism: {
            theme: { id: 'Pelarian dari Masalah (Mood Modification)', en: 'Escapism (Mood Modification)' },
            body: {
                id: 'Jawaban Anda mengindikasikan perilaku ini dipakai sebagai cara mengalihkan diri dari masalah atau mengubah suasana hati, bukan sekadar hiburan biasa.',
                en: 'Your answer indicates this behavior is used as a way to distract from problems or shift mood, rather than as ordinary entertainment.'
            }
        },
        relapsePattern: {
            theme: { id: 'Siklus Relaps yang Berulang', en: 'Recurring Relapse Cycle' },
            body: {
                id: 'Jawaban Anda menonjolkan siklus mencoba berhenti lalu kembali lagi — pola relaps berulang yang layak jadi perhatian utama.',
                en: 'Your answer highlights a cycle of trying to stop and then relapsing — a recurring pattern worth making a primary focus.'
            }
        },
        broadImpact: {
            theme: { id: 'Dampak Multi-Dimensi', en: 'Multi-Dimensional Impact' },
            body: {
                id: 'Jawaban Anda menyentuh beberapa dimensi sekaligus (emosi, kendali perilaku, fisik, dan/atau sosial), menandakan dampak yang cukup meluas, bukan hanya pada satu aspek.',
                en: 'Your answer touches several dimensions at once (emotional, behavioral control, physical, and/or social), suggesting a fairly broad impact rather than one isolated aspect.'
            }
        },
        deepIntrospection: {
            theme: { id: 'Introspeksi Mendalam', en: 'Deep Introspection' },
            body: {
                id: 'Anda memberikan refleksi yang detail dan komprehensif. Tantangan berikutnya adalah mengubah wawasan ini menjadi tindakan nyata dan terukur.',
                en: 'You provided a detailed and comprehensive reflection. The next challenge is turning this insight into concrete, measurable action.'
            }
        },
        balanced: {
            theme: { id: 'Gambaran Umum yang Seimbang', en: 'Balanced General Picture' },
            body: {
                id: 'Narasi Anda memberikan gambaran yang cukup seimbang antara kesadaran akan masalah dan upaya pengendalian.',
                en: 'Your narrative provides a fairly balanced picture between awareness of the issue and control efforts.'
            }
        },
        minimal: {
            theme: { id: 'Refleksi Minimal', en: 'Minimal Reflection' },
            body: {
                id: 'Jawaban terlalu singkat untuk dianalisis secara mendalam. Refleksi yang lebih jujur dan detail mengenai pola perilaku, pemicu, dan dampaknya akan sangat membantu.',
                en: 'The answer is too brief for in-depth analysis. A more honest and detailed reflection on behavioral patterns, triggers, and impact would help a great deal.'
            }
        }
    };

    /* ---------- Klausa modular tambahan ---------- */
    function buildModifierClauses(flags, evidenceByAxis) {
        const clauses = [];

        if (flags.urgent) {
            clauses.push({
                id: 'Ada penanda urgensi dalam jawaban Anda ("sudah tidak tahan", "harus segera", dsb.) — ini sinyal kuat untuk segera mencari dukungan, jangan ditunda.',
                en: 'There are urgency markers in your answer ("can\'t take it anymore", "need help now", etc.) — this is a strong signal to seek support soon, not to delay.'
            });
        } else if (flags.chronic) {
            clauses.push({
                id: 'Anda menyebut pola ini sebagai sesuatu yang sudah berlangsung lama atau berulang secara konsisten, bukan kejadian sesekali.',
                en: 'You describe this pattern as something that has gone on for a long time or repeats consistently, not an occasional event.'
            });
        }

        if (flags.locus === 'external' && (flags.baseKey === 'lossOfControl' || flags.baseKey === 'minimizationShort' || flags.baseKey === 'distressLossOfControl')) {
            clauses.push({
                id: 'Anda cenderung mengaitkan perilaku ini dengan faktor di luar diri (pekerjaan, orang lain, situasi). Ini bisa valid, tapi juga layak dicek: adakah bagian yang sepenuhnya berada dalam kendali Anda?',
                en: 'You tend to attribute this behavior to factors outside yourself (work, other people, circumstances). That may be valid, but it is also worth checking: is there a part that is fully within your control?'
            });
        } else if (flags.locus === 'internal' && (flags.baseKey === 'selfAwarenessHealthy' || flags.baseKey === 'balanced')) {
            clauses.push({
                id: 'Anda mengambil tanggung jawab pribadi atas pola ini alih-alih menyalahkan keadaan — sikap ini biasanya jadi fondasi kuat untuk perubahan yang bertahan.',
                en: 'You take personal responsibility for this pattern rather than blaming circumstances — this stance is usually a strong foundation for lasting change.'
            });
        }

        if (flags.copingPresent && ['distress', 'lossOfControl', 'distressLossOfControl', 'broadImpact'].includes(flags.baseKey)) {
            const ev = evidenceByAxis.copingEfficacy;
            clauses.push({
                id: ev
                    ? `Meski demikian, Anda juga menyebutkan upaya penanganan (mis. "${ev.term}") — modal ini sebaiknya diperkuat dan dibuat lebih konsisten.`
                    : 'Meski demikian, Anda juga menyebutkan adanya upaya penanganan — modal ini sebaiknya diperkuat dan dibuat lebih konsisten.',
                en: ev
                    ? `That said, you also mention a coping effort (e.g. "${ev.term}") — this resource is worth reinforcing and making more consistent.`
                    : 'That said, you also mention some coping effort — this resource is worth reinforcing and making more consistent.'
            });
        }

        if (flags.physicalPresent && flags.baseKey !== 'physicalSymptoms') {
            clauses.push({
                id: 'Anda juga menyinggung gejala fisik (mis. gangguan tidur, sakit kepala, kelelahan) yang sebaiknya tidak diabaikan meski bukan fokus utama jawaban Anda.',
                en: 'You also touch on physical symptoms (e.g. sleep disruption, headaches, fatigue) that should not be ignored even though they are not the main focus of your answer.'
            });
        }

        if (flags.socialPresent && flags.baseKey !== 'socialWithdrawal') {
            clauses.push({
                id: 'Ada juga jejak penarikan diri dari orang-orang terdekat dalam jawaban Anda — dimensi ini sering berdampak besar meski jarang disadari.',
                en: 'There are also traces of withdrawing from close relationships in your answer — this dimension often has a large impact even when it goes unnoticed.'
            });
        }

        if (flags.tolerancePresent && flags.baseKey !== 'toleranceEscalation') {
            clauses.push({
                id: 'Anda juga menyinggung kebutuhan durasi/porsi yang makin bertambah dari waktu ke waktu — penanda "tolerance" yang sebaiknya dipantau.',
                en: 'You also mention needing more time or amount over time — a "tolerance" marker worth monitoring.'
            });
        }

        if (flags.withdrawalPresent && flags.baseKey !== 'withdrawalSymptoms') {
            clauses.push({
                id: 'Ada jejak kegelisahan atau ketidaknyamanan saat tidak bisa mengakses perilaku ini — mirip gejala withdrawal pada kecanduan perilaku.',
                en: 'There are traces of restlessness or discomfort when unable to access this behavior — similar to a withdrawal symptom in behavioral addiction.'
            });
        }

        if (flags.escapismPresent && flags.baseKey !== 'escapism') {
            clauses.push({
                id: 'Jawaban Anda juga menyiratkan perilaku ini dipakai untuk melarikan diri dari masalah atau mengubah suasana hati — layak digali lebih jauh apa yang sebenarnya sedang dihindari.',
                en: 'Your answer also implies this behavior is used to escape problems or shift mood — worth exploring further what is actually being avoided.'
            });
        }

        if (flags.relapsePresent && flags.baseKey !== 'relapsePattern') {
            clauses.push({
                id: 'Anda menyebut adanya percobaan berhenti yang berulang kali gagal — ini wajar terjadi pada proses perubahan perilaku, bukan tanda kegagalan pribadi.',
                en: 'You mention repeated attempts to stop that have failed — this is a normal part of the behavior-change process, not a personal failure.'
            });
        }

        // --- Klausa pola kombinasi (synergy) — maks 2 kombinasi berbobot tertinggi ---
        if (flags.synergyPairs && flags.synergyPairs.length > 0) {
            flags.synergyPairs.slice(0, 2).forEach((p) => {
                clauses.push({
                    id: `Pola kombinasi yang layak dicermati: ${p.label.id.charAt(0).toLowerCase()}${p.label.id.slice(1)} — kombinasi seperti ini biasanya menandakan sinyal yang lebih kuat daripada tiap axis yang berdiri sendiri.`,
                    en: `A compound pattern worth noting: ${p.label.en.charAt(0).toLowerCase()}${p.label.en.slice(1)} — a combination like this usually signals something stronger than either dimension alone.`
                });
            });
        }

        // --- Klausa keandalan (reliability) rendah ---
        if (typeof flags.reliability === 'number' && flags.reliability < 30) {
            clauses.push({
                id: 'Catatan metodologis: jawaban ini relatif singkat/kurang beragam, sehingga sinyal kualitatifnya sebaiknya dibaca sebagai indikasi awal, bukan kesimpulan kuat.',
                en: 'Methodological note: this answer is relatively short or repetitive, so its qualitative signal should be read as an early indication rather than a strong conclusion.'
            });
        }

        return clauses;
    }

    /* ---------- Kalkulator risiko komposit (dipakai bersama summary-engine.js) ---------- */
    // totals: objek { axisKey: skorTerbobot } — bisa dari satu jawaban atau
    // agregat lintas jawaban. extraBonus (opsional): bobot tambahan di luar
    // totals per-axis, mis. dari computeSynergy() (kombinasi axis dalam satu
    // kalimat). Mengembalikan { raw, percent } dengan percent sudah
    // dinormalisasi 0-100 lewat fungsi saturasi (bukan linear murni) supaya
    // beberapa istilah kuat saja tidak langsung memaksa skor ke 100.
    function computeAxisRisk(totals, extraBonus) {
        const dict = global.AtlasKeywordDictionary;
        const polarity = (dict && dict.axisRiskPolarity) || {};
        let raw = 0;
        Object.keys(totals || {}).forEach((k) => {
            raw += (totals[k] || 0) * (polarity[k] || 0);
        });
        raw += extraBonus || 0;
        raw = Math.round(raw * 100) / 100;
        const percent = raw <= 0 ? 0 : Math.round(100 * (1 - Math.exp(-raw / 9)));
        return { raw, percent: Math.min(100, Math.max(0, percent)) };
    }

    /* ---------- Deteksi sinergi antar-axis dalam kalimat yang sama ---------- */
    // Kata kunci dua axis yang berbeda tapi muncul di KALIMAT yang sama sering
    // menandakan pola yang lebih kuat daripada penjumlahan axis independen
    // (mis. "makin lama makin banyak, dan kalau nggak megang HP saya jadi
    // gelisah" = tolerance + withdrawal dalam satu napas, bukan kebetulan).
    // Mengembalikan { bonus, found: [{axes:[a,b], weight, label:{id,en}}] }.
    function computeSynergy(axisResults, sentences, dict) {
        const pairs = (dict && dict.axisSynergyPairs) || [];
        if (!pairs.length || !sentences.length) return { bonus: 0, found: [] };

        // Peta index kalimat -> Set axis yang punya match (tak-ternegasi) di kalimat itu
        const sentenceAxes = sentences.map(() => new Set());
        Object.keys(axisResults).forEach((axisKey) => {
            axisResults[axisKey].matches.forEach((m) => {
                const sIdx = sentences.findIndex((s) => m.index >= s.start && m.index <= s.end);
                if (sIdx >= 0) sentenceAxes[sIdx].add(axisKey);
            });
        });

        let bonus = 0;
        const found = [];
        pairs.forEach((p) => {
            const coOccurs = sentenceAxes.some((set) => set.has(p.a) && set.has(p.b));
            if (coOccurs) {
                bonus += p.weight;
                found.push({ axes: [p.a, p.b], weight: p.weight, label: { id: p.id, en: p.en } });
            }
        });

        return { bonus: Math.round(bonus * 100) / 100, found: found.sort((a, b) => b.weight - a.weight) };
    }

    /* ---------- Skor keandalan (reliability) sebuah jawaban naratif ---------- */
    // Mengukur seberapa banyak "modal" yang bisa dipercaya dari sebuah jawaban
    // untuk ditarik kesimpulan kualitatif: jawaban pendek/repetitif seharusnya
    // menghasilkan sinyal yang lebih hati-hati daripada jawaban panjang &
    // beragam kosakatanya. 0-100, dipakai UI untuk memberi konteks ("modal
    // analisis rendah karena jawaban singkat") tanpa mengubah skor axis itu
    // sendiri.
    function computeReliability(wordCount, lexicalDiversity, sentenceCount) {
        const lengthScore = Math.min(100, (wordCount / 50) * 100); // saturasi di ~50 kata
        const diversityScore = Math.min(100, (lexicalDiversity || 0) * 140);
        const structureScore = Math.min(100, (sentenceCount / 4) * 100); // saturasi di 4 kalimat
        const reliability = Math.round(lengthScore * 0.5 + diversityScore * 0.3 + structureScore * 0.2);
        return Math.min(100, Math.max(0, reliability));
    }

    /* ---------- Fungsi utama ---------- */
    function analyzeQualitative(text) {
        if (!text || text.trim().length < 10) {
            const t = BASE_TEMPLATES.minimal;
            return {
                theme: t.theme,
                interpretation: t.body,
                tags: [],
                evidence: [],
                axes: null,
                meta: { wordCount: text ? text.trim().split(/\s+/).filter(Boolean).length : 0 }
            };
        }

        const dict = global.AtlasKeywordDictionary;
        const lowerText = text.toLowerCase();
        const words = lowerText.split(/\s+/).filter(Boolean);
        const wordCount = words.length;
        const sentences = splitSentences(text);

        const axisResults = {};
        Object.keys(dict.axes).forEach((axisKey) => {
            axisResults[axisKey] = scanAxis(lowerText, dict.axes[axisKey], dict);
        });

        // --- Bukti (evidence): sampai 2 kalimat asli unik per axis ---
        const evidenceByAxis = {};
        Object.keys(axisResults).forEach((axisKey) => {
            const res = axisResults[axisKey];
            if (res.matches.length === 0) return;
            const sorted = [...res.matches].sort((a, b) => b.weight * b.multiplier - a.weight * a.multiplier);
            const seen = new Set();
            const picked = [];
            sorted.forEach((mtch) => {
                const sentText = sentenceForIndex(sentences, mtch.index).slice(0, 160);
                if (seen.has(sentText) || picked.length >= 2) return;
                seen.add(sentText);
                picked.push({ term: mtch.term, sentence: sentText });
            });
            evidenceByAxis[axisKey] = { term: picked[0].term, sentence: picked[0].sentence, all: picked };
        });

        // --- Skor & flags turunan ---
        const locusScore = axisResults.internalAttribution.weightedScore - axisResults.externalAttribution.weightedScore;
        const locus = locusScore > 0.4 ? 'internal' : locusScore < -0.4 ? 'external' : 'neutral';
        const chronic = axisResults.chronicity.weightedScore > 0;
        const urgent = axisResults.urgency.weightedScore > 0;
        const copingPresent = axisResults.copingEfficacy.weightedScore > 0;
        const physicalPresent = axisResults.physicalSymptoms.weightedScore > 0;
        const socialPresent = axisResults.socialWithdrawal.weightedScore > 0;
        const tolerancePresent = axisResults.toleranceEscalation.weightedScore > 0;
        const withdrawalPresent = axisResults.withdrawalSymptoms.weightedScore > 0;
        const escapismPresent = axisResults.escapism.weightedScore > 0;
        const relapsePresent = axisResults.relapsePattern.weightedScore > 0;

        const elevatedPrimaryCount = PRIMARY_AXES.filter(
            (k) => k !== 'copingEfficacy' && axisResults[k].weightedScore >= 1
        ).length;

        let primaryWinner = null;
        let primaryWinnerScore = 0;
        PRIMARY_AXES.forEach((k) => {
            if (axisResults[k].weightedScore > primaryWinnerScore) {
                primaryWinnerScore = axisResults[k].weightedScore;
                primaryWinner = k;
            }
        });

        // --- Pilih template dasar ---
        let baseKey;
        if (axisResults.distress.weightedScore >= 2 && axisResults.lossOfControl.weightedScore >= 2) {
            baseKey = 'distressLossOfControl';
        } else if (relapsePresent) {
            // Diprioritaskan sebelum selfAwarenessHealthy: kata seperti "berhenti"
            // ambigu — bisa muncul di "berhasil berhenti" (sehat) maupun di
            // "gagal lagi setelah berhenti" (relaps). Jika axis relapsePattern
            // sendiri sudah terdeteksi (frasa relaps yang lebih spesifik daripada
            // kata "berhenti" saja), pola relaps yang lebih dipercaya.
            baseKey = 'relapsePattern';
        } else if (axisResults.selfAwareness.weightedScore >= 2 && axisResults.distress.weightedScore <= 1
            && !tolerancePresent && !withdrawalPresent) {
            baseKey = 'selfAwarenessHealthy';
        } else if (axisResults.minimization.weightedScore >= 2 && wordCount < 25) {
            baseKey = 'minimizationShort';
        } else if (elevatedPrimaryCount >= 3) {
            baseKey = 'broadImpact';
        } else if (primaryWinner === 'socialWithdrawal') {
            baseKey = 'socialWithdrawal';
        } else if (primaryWinner === 'physicalSymptoms') {
            baseKey = 'physicalSymptoms';
        } else if (primaryWinner === 'toleranceEscalation') {
            baseKey = 'toleranceEscalation';
        } else if (primaryWinner === 'withdrawalSymptoms') {
            baseKey = 'withdrawalSymptoms';
        } else if (primaryWinner === 'escapism') {
            baseKey = 'escapism';
        } else if (primaryWinner === 'relapsePattern') {
            baseKey = 'relapsePattern';
        } else if (primaryWinner === 'lossOfControl') {
            baseKey = 'lossOfControl';
        } else if (primaryWinner === 'distress') {
            baseKey = 'distress';
        } else if (!primaryWinner && wordCount > 40) {
            baseKey = 'deepIntrospection';
        } else if (!primaryWinner) {
            baseKey = 'balanced';
        } else {
            baseKey = 'balanced';
        }

        // --- Sinergi antar-axis dalam kalimat yang sama & keandalan jawaban ---
        const synergy = computeSynergy(axisResults, sentences, dict);
        const lexicalDiversity = Math.round((new Set(words).size / wordCount) * 100) / 100;
        const reliability = computeReliability(wordCount, lexicalDiversity, sentences.length);

        const base = BASE_TEMPLATES[baseKey];
        const flags = {
            urgent, chronic, locus, baseKey, copingPresent, physicalPresent, socialPresent,
            tolerancePresent, withdrawalPresent, escapismPresent, relapsePresent,
            synergyPairs: synergy.found, reliability
        };
        const modifierClauses = buildModifierClauses(flags, evidenceByAxis);

        // --- Klausa kutipan bukti (grounding) ---
        const groundingAxis = primaryWinner || Object.keys(evidenceByAxis)[0];
        const groundingEvidence = groundingAxis ? evidenceByAxis[groundingAxis] : null;
        const evidenceClauses = [];
        if (groundingEvidence) {
            evidenceClauses.push({
                id: `Salah satu bagian yang menonjol dari jawaban Anda: “${groundingEvidence.sentence}”.`,
                en: `One part of your answer that stands out: "${groundingEvidence.sentence}".`
            });
        }

        const interpretationId = [base.body.id, ...modifierClauses.map((c) => c.id), ...evidenceClauses.map((c) => c.id)].join(' ');
        const interpretationEn = [base.body.en, ...modifierClauses.map((c) => c.en), ...evidenceClauses.map((c) => c.en)].join(' ');

        // --- Tags (badge ringkas untuk UI) ---
        const tags = [];
        if (urgent) tags.push({ id: 'Perlu Perhatian Segera', en: 'Needs Immediate Attention' });
        if (chronic) tags.push({ id: 'Pola Kronis', en: 'Chronic Pattern' });
        if (locus === 'external') tags.push({ id: 'Atribusi Eksternal', en: 'External Attribution' });
        if (locus === 'internal') tags.push({ id: 'Kepemilikan Internal', en: 'Internal Ownership' });
        if (copingPresent) tags.push({ id: 'Ada Strategi Coping', en: 'Coping Strategy Present' });
        if (physicalPresent) tags.push({ id: 'Gejala Fisik', en: 'Physical Symptoms' });
        if (socialPresent) tags.push({ id: 'Penarikan Sosial', en: 'Social Withdrawal' });
        if (tolerancePresent) tags.push({ id: 'Eskalasi Toleransi', en: 'Tolerance Escalation' });
        if (withdrawalPresent) tags.push({ id: 'Gejala Withdrawal', en: 'Withdrawal Symptoms' });
        if (escapismPresent) tags.push({ id: 'Pelarian/Mood', en: 'Escapism/Mood' });
        if (relapsePresent) tags.push({ id: 'Pola Relaps', en: 'Relapse Pattern' });
        if (elevatedPrimaryCount >= 3) tags.push({ id: 'Dampak Multi-Dimensi', en: 'Multi-Dimensional' });
        if (synergy.found.length > 0) tags.push({ id: 'Pola Kombinasi Berisiko', en: 'Compound Risk Pattern' });

        // --- Ringkasan axes untuk konsumen lain (mis. summary-engine.js) ---
        const axesSummary = {};
        const totalsOnly = {};
        Object.keys(axisResults).forEach((k) => {
            axesSummary[k] = {
                score: axisResults[k].weightedScore,
                density: Math.round((axisResults[k].weightedScore / wordCount) * 1000) / 10 // per 100 kata, 1 desimal
            };
            totalsOnly[k] = axisResults[k].weightedScore;
        });

        const qualRisk = computeAxisRisk(totalsOnly, synergy.bonus);

        return {
            theme: base.theme,
            interpretation: { id: interpretationId, en: interpretationEn },
            tags,
            evidence: Object.keys(evidenceByAxis).map((k) => ({
                axis: k,
                axisLabel: AXIS_LABELS[k] || { id: k, en: k },
                term: evidenceByAxis[k].term,
                sentence: evidenceByAxis[k].sentence,
                allQuotes: evidenceByAxis[k].all
            })),
            axes: axesSummary,
            meta: {
                wordCount,
                sentenceCount: sentences.length,
                elaboration: Math.min(100, Math.round((wordCount / 60) * 100)),
                lexicalDiversity,
                locus,
                locusScore,
                chronic,
                urgent,
                reliability,
                synergy: { bonus: synergy.bonus, pairs: synergy.found.map((f) => f.label) },
                qualitativeRisk: qualRisk
            }
        };
    }

    global.AtlasNLPEngine = { analyzeQualitative, computeAxisRisk, computeSynergy, computeReliability, AXIS_LABELS };
})(window);
