/* =========================================
   ATLAS JIWA — Overall Narrative Summary Engine v3
   ---------------------------------------------------
   PERUBAHAN UTAMA v2 -> v3:

   1. AXIS_LABELS diperluas dengan 4 axis baru (tolerance, withdrawal,
      escapism, relapse) dari keyword-dictionary.js v3.
   2. Menambah buildAddictionComponentProfile(): memetakan agregat
      axis ke 6 komponen "Six-Component Model of Addiction" (Griffiths,
      2005) — salience, mood modification, tolerance, withdrawal,
      conflict, relapse — kerangka klinis standar untuk kecanduan
      perilaku (bukan zat). Ini menjawab kebutuhan analisis yang lebih
      "berdasar teori", bukan cuma penghitungan kata kunci polos.
   3. Menambah computeCompositeRiskIndex(): menggabungkan skor risiko
      kualitatif (dari AtlasNLPEngine.computeAxisRisk, berbasis
      axisRiskPolarity) dengan skor kuantitatif (overallPercent dari
      screening) menjadi SATU indeks risiko 0-100 dengan bobot
      55% kuantitatif : 45% kualitatif ketika data kuantitatif
      tersedia. Ini adalah upgrade paling signifikan: dulu skor
      kuantitatif & kualitatif hanya "disandingkan" via congruence
      check teks, sekarang benar-benar digabung jadi satu angka yang
      bisa dipakai UI/JSON export.

   PERUBAHAN v3 -> v4:
   4. computeCompositeRiskIndex() sekarang menerima synergyBonus (agregat
      dari computeSynergy() nlp-engine.js) supaya kombinasi axis dalam
      satu kalimat tetap tercermin di indeks risiko gabungan, bukan
      hilang saat beberapa jawaban dijumlahkan.
   5. buildOverallSummary() sekarang juga mengembalikan synergyPairs
      (kombinasi axis unik lintas jawaban) dan reliabilityAvg (rata-rata
      keandalan jawaban), plus satu klausa interpretasi baru untuk
      masing-masing saat relevan.

   Dimuat sebagai plain <script>. Harus dimuat SETELAH nlp-engine.js
   dan SEBELUM script.js — buildOverallSummary() memanggil
   window.AtlasNLPEngine.computeAxisRisk() saat dieksekusi (bukan
   saat file dimuat), jadi urutan load tetap aman selama urutan tag
   <script> di HTML dipertahankan.
   ========================================= */

(function (global) {
    'use strict';

    const AXIS_LABELS = {
        distress: { id: 'distres emosional', en: 'emotional distress' },
        lossOfControl: { id: 'kehilangan kendali perilaku', en: 'behavioral loss of control' },
        minimization: { id: 'minimalisasi/penyangkalan', en: 'minimization/denial' },
        selfAwareness: { id: 'kesadaran diri', en: 'self-awareness' },
        socialWithdrawal: { id: 'penarikan sosial', en: 'social withdrawal' },
        physicalSymptoms: { id: 'gejala fisik', en: 'physical symptoms' },
        copingEfficacy: { id: 'strategi coping', en: 'coping strategies' },
        toleranceEscalation: { id: 'eskalasi toleransi', en: 'tolerance escalation' },
        withdrawalSymptoms: { id: 'gejala withdrawal', en: 'withdrawal symptoms' },
        escapism: { id: 'pelarian/regulasi mood', en: 'escapism/mood modification' },
        relapsePattern: { id: 'pola relaps berulang', en: 'recurring relapse pattern' }
    };

    // Pita label risiko komposit — dipertahankan konsisten dengan LEVELS
    // di script.js (ambang 20/40/60/80) supaya penamaan tidak membingungkan
    // antara skor kuantitatif murni dan indeks risiko gabungan.
    const RISK_BANDS = [
        { max: 20, id: 'Minimal', en: 'Minimal' },
        { max: 40, id: 'Ringan', en: 'Mild' },
        { max: 60, id: 'Sedang', en: 'Moderate' },
        { max: 80, id: 'Berat', en: 'Severe' },
        { max: 100, id: 'Sangat Berat', en: 'Very Severe' }
    ];

    function getRiskBand(percent) {
        return RISK_BANDS.find((b) => percent <= b.max) || RISK_BANDS[RISK_BANDS.length - 1];
    }

    // 6 komponen model Griffiths (2005) untuk kecanduan perilaku.
    // Setiap komponen "present" jika total skor axis pemetaannya > 0.
    const ADDICTION_COMPONENTS = [
        { key: 'salience', id: 'Salience (Dominasi Pikiran)', en: 'Salience', axes: ['distress', 'lossOfControl', 'chronicity'] },
        { key: 'moodModification', id: 'Modifikasi Mood (Pelarian)', en: 'Mood Modification (Escapism)', axes: ['escapism'] },
        { key: 'tolerance', id: 'Toleransi', en: 'Tolerance', axes: ['toleranceEscalation'] },
        { key: 'withdrawal', id: 'Withdrawal (Gejala Putus)', en: 'Withdrawal', axes: ['withdrawalSymptoms'] },
        { key: 'conflict', id: 'Konflik (Sosial/Internal)', en: 'Conflict (Social/Internal)', axes: ['socialWithdrawal', 'externalAttribution'] },
        { key: 'relapse', id: 'Relaps', en: 'Relapse', axes: ['relapsePattern'] }
    ];

    function buildAddictionComponentProfile(totals) {
        return ADDICTION_COMPONENTS.map((c) => {
            const score = c.axes.reduce((sum, axisKey) => sum + (totals[axisKey] || 0), 0);
            return {
                key: c.key,
                label: { id: c.id, en: c.en },
                present: score > 0,
                score: Math.round(score * 100) / 100
            };
        });
    }

    function aggregateAxes(analyses) {
        const totals = {};
        analyses.forEach((a) => {
            if (!a.axes) return;
            Object.keys(a.axes).forEach((k) => {
                totals[k] = (totals[k] || 0) + a.axes[k].score;
            });
        });
        return totals;
    }

    // Menjumlahkan synergy bonus (kombinasi axis dalam satu kalimat, lihat
    // computeSynergy di nlp-engine.js) dari semua jawaban naratif, supaya
    // sinyal kombinasi tidak hilang saat beberapa jawaban digabung jadi satu
    // indeks risiko keseluruhan.
    function aggregateSynergyBonus(analyses) {
        return analyses.reduce((sum, a) => sum + ((a.meta && a.meta.synergy && a.meta.synergy.bonus) || 0), 0);
    }

    // Mengumpulkan pasangan sinergi unik (berdasarkan pasangan axis) dari
    // seluruh jawaban, diurutkan dari bobot tertinggi, untuk ditampilkan
    // sebagai wawasan tingkat-keseluruhan (bukan cuma per jawaban).
    function collectSynergyPairs(analyses) {
        const seen = new Map();
        analyses.forEach((a) => {
            const pairs = a.meta && a.meta.synergy && a.meta.synergy.pairs;
            if (!pairs) return;
            pairs.forEach((p) => {
                const key = p.id;
                if (!seen.has(key)) seen.set(key, p);
            });
        });
        return Array.from(seen.values());
    }

    // Rata-rata skor keandalan (reliability) lintas jawaban — dipakai untuk
    // menandai jika keseluruhan refleksi masih tergolong tipis/singkat.
    function averageReliability(analyses) {
        const withReliability = analyses.filter((a) => a.meta && typeof a.meta.reliability === 'number');
        if (withReliability.length === 0) return null;
        const sum = withReliability.reduce((s, a) => s + a.meta.reliability, 0);
        return Math.round(sum / withReliability.length);
    }

    function topAxes(totals, keys, n) {
        return keys
            .map((k) => ({ key: k, score: totals[k] || 0 }))
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, n);
    }

    // Menggabungkan risiko kualitatif (dari axis totals) dengan skor
    // kuantitatif (overallPercent) menjadi satu indeks 0-100.
    function computeCompositeRiskIndex(totals, quantContext, synergyBonus) {
        const engine = global.AtlasNLPEngine;
        const qualRisk = engine && typeof engine.computeAxisRisk === 'function'
            ? engine.computeAxisRisk(totals, synergyBonus || 0)
            : { raw: 0, percent: 0 };

        let score;
        let quantWeight = 0;
        let qualWeight = 1;

        if (quantContext && typeof quantContext.overallPercent === 'number') {
            quantWeight = 0.55;
            qualWeight = 0.45;
            score = Math.round(quantContext.overallPercent * quantWeight + qualRisk.percent * qualWeight);
        } else {
            score = qualRisk.percent;
        }

        const band = getRiskBand(score);
        return {
            score,
            band: { id: band.id, en: band.en },
            qualitativePercent: qualRisk.percent,
            quantitativePercent: quantContext && typeof quantContext.overallPercent === 'number' ? Math.round(quantContext.overallPercent) : null,
            weights: { quantitative: quantWeight, qualitative: qualWeight }
        };
    }

    // analyses: array hasil analyzeQualitative() v3 (sudah difilter, tanpa null)
    // quantContext (opsional): { overallPercent, overallLevel, results: [{id, title, percent, level}] }
    // Mengembalikan { theme, interpretation, tags, confidence, compositeRisk, addictionComponents } atau null jika analyses kosong.
    function buildOverallSummary(analyses, quantContext) {
        if (!analyses || analyses.length === 0) return null;

        const primaryKeys = ['distress', 'lossOfControl', 'minimization', 'selfAwareness', 'socialWithdrawal', 'physicalSymptoms'];
        const totals = aggregateAxes(analyses);
        const top = topAxes(totals, primaryKeys, 2);

        const anyUrgent = analyses.some((a) => a.meta && a.meta.urgent);
        const anyChronic = analyses.some((a) => a.meta && a.meta.chronic);
        const externalCount = analyses.filter((a) => a.meta && a.meta.locus === 'external').length;
        const internalCount = analyses.filter((a) => a.meta && a.meta.locus === 'internal').length;
        const dominantLocus = externalCount > internalCount ? 'external' : internalCount > externalCount ? 'internal' : 'neutral';
        const copingMentioned = (totals.copingEfficacy || 0) > 0;
        const toleranceMentioned = (totals.toleranceEscalation || 0) > 0;
        const withdrawalMentioned = (totals.withdrawalSymptoms || 0) > 0;
        const relapseMentioned = (totals.relapsePattern || 0) > 0;

        const synergyBonusTotal = aggregateSynergyBonus(analyses);
        const synergyPairsOverall = collectSynergyPairs(analyses);
        const reliabilityAvg = averageReliability(analyses);

        // --- Tema dasar dari axis teratas ---
        let themeId;
        let themeEn;
        let bodyId;
        let bodyEn;

        if (top.length === 0) {
            themeId = 'Refleksi Positif & Berkelanjutan';
            themeEn = 'Positive & Sustainable Reflection';
            bodyId = 'Secara keseluruhan, narasi Anda tidak menunjukkan penanda distres atau kehilangan kendali yang kuat. Teruslah membangun kebiasaan baik yang sudah ada.';
            bodyEn = 'Overall, your narrative does not show strong markers of distress or loss of control. Continue building on the good habits you already have.';
        } else if (top.length === 1 || top[0].score >= top[1].score * 1.8) {
            const label = AXIS_LABELS[top[0].key];
            themeId = `Pola Dominan: ${label.id.charAt(0).toUpperCase() + label.id.slice(1)}`;
            themeEn = `Dominant Pattern: ${label.en.charAt(0).toUpperCase() + label.en.slice(1)}`;
            bodyId = `Di antara seluruh jawaban naratif Anda, tema yang paling konsisten muncul adalah ${label.id}. Ini layak jadi fokus utama refleksi Anda ke depan.`;
            bodyEn = `Across all your narrative answers, the most consistent theme is ${label.en}. This is worth making the main focus of your reflection going forward.`;
        } else {
            const l1 = AXIS_LABELS[top[0].key];
            const l2 = AXIS_LABELS[top[1].key];
            themeId = `Dua Pola Berdampingan: ${l1.id.charAt(0).toUpperCase() + l1.id.slice(1)} & ${l2.id}`;
            themeEn = `Two Co-occurring Patterns: ${l1.en.charAt(0).toUpperCase() + l1.en.slice(1)} & ${l2.en}`;
            bodyId = `Narasi Anda menunjukkan dua tema yang berdampingan secara seimbang: ${l1.id} dan ${l2.id}. Keduanya kemungkinan saling memengaruhi satu sama lain.`;
            bodyEn = `Your narrative shows two roughly co-occurring themes: ${l1.en} and ${l2.en}. These likely reinforce one another.`;
        }

        const clauses = [];

        if (anyUrgent) {
            clauses.push({
                id: 'Setidaknya satu jawaban Anda mengandung penanda urgensi — sebaiknya jangan menunda untuk mencari dukungan lebih lanjut.',
                en: 'At least one of your answers contains urgency markers — it is best not to delay seeking further support.'
            });
        } else if (anyChronic) {
            clauses.push({
                id: 'Beberapa jawaban Anda menandakan pola yang sudah berlangsung lama, bukan sekadar fase sementara.',
                en: 'Several of your answers indicate a pattern that has persisted for a long time, not just a temporary phase.'
            });
        }

        if (dominantLocus === 'external' && (top[0] && (top[0].key === 'lossOfControl' || top[0].key === 'minimization'))) {
            clauses.push({
                id: 'Secara umum Anda cenderung mengaitkan pola ini dengan faktor luar. Mencoba mengidentifikasi bagian yang benar-benar berada dalam kendali Anda bisa jadi langkah reflektif berikutnya.',
                en: 'Overall you tend to attribute this pattern to external factors. Trying to identify the part that is genuinely within your control could be a useful next reflective step.'
            });
        } else if (dominantLocus === 'internal') {
            clauses.push({
                id: 'Anda cenderung mengambil kepemilikan pribadi atas pola ini di berbagai jawaban — sikap yang biasanya mendukung perubahan yang bertahan lama.',
                en: 'You tend to take personal ownership of this pattern across your answers — a stance that usually supports lasting change.'
            });
        }

        if (copingMentioned) {
            clauses.push({
                id: 'Beberapa jawaban Anda menyebut upaya atau strategi penanganan tertentu — ini modal yang layak diperkuat secara konsisten.',
                en: 'Several of your answers mention specific coping efforts or strategies — this is a resource worth reinforcing consistently.'
            });
        }

        if (toleranceMentioned && withdrawalMentioned) {
            clauses.push({
                id: 'Kombinasi eskalasi toleransi dan gejala withdrawal muncul bersamaan dalam jawaban Anda — dua komponen inti dari model kecanduan perilaku yang sebaiknya jadi perhatian khusus.',
                en: 'A combination of tolerance escalation and withdrawal symptoms appears together in your answers — two core components of the behavioral addiction model that deserve special attention.'
            });
        }

        if (relapseMentioned) {
            clauses.push({
                id: 'Ada penyebutan siklus mencoba berhenti lalu kembali lagi. Ini bagian normal dari proses perubahan, tapi pola yang berulang layak dibahas dengan pendamping/profesional untuk menemukan pemicu spesifiknya.',
                en: 'There is mention of a cycle of trying to stop and relapsing. This is a normal part of the change process, but a recurring pattern is worth discussing with a companion/professional to identify specific triggers.'
            });
        }

        if (synergyPairsOverall.length > 0) {
            const topPair = synergyPairsOverall[0];
            clauses.push({
                id: `Pola kombinasi berikut muncul dalam kalimat yang sama di jawaban Anda: ${topPair.id.charAt(0).toLowerCase()}${topPair.id.slice(1)}. Kombinasi seperti ini biasanya lebih bermakna daripada masing-masing tema yang berdiri sendiri.`,
                en: `The following compound pattern appears in the same sentence in your answers: ${topPair.en.charAt(0).toLowerCase()}${topPair.en.slice(1)}. A combination like this is usually more meaningful than either theme on its own.`
            });
        }

        if (reliabilityAvg !== null && reliabilityAvg < 30) {
            clauses.push({
                id: 'Catatan metodologis: rata-rata jawaban naratif Anda relatif singkat, sehingga bagian kualitatif dari hasil ini sebaiknya dianggap sebagai indikasi awal. Menulis jawaban yang lebih detail akan membuat analisis ini lebih tajam.',
                en: 'Methodological note: your narrative answers are, on average, fairly brief, so the qualitative portion of this result should be treated as an early indication. Writing more detailed answers would sharpen this analysis.'
            });
        }

        // --- Congruence check terhadap skor kuantitatif ---
        let confidence = analyses.length >= 4 ? 'cukup tinggi' : analyses.length >= 2 ? 'sedang' : 'rendah';
        let confidenceEn = analyses.length >= 4 ? 'fairly high' : analyses.length >= 2 ? 'moderate' : 'low';

        if (quantContext && typeof quantContext.overallPercent === 'number') {
            const pct = Math.round(quantContext.overallPercent);
            const levelLabel = quantContext.overallLevel ? quantContext.overallLevel.label : null;
            const distressLike = (totals.distress || 0) + (totals.lossOfControl || 0) + (totals.physicalSymptoms || 0);
            const minimizeLike = totals.minimization || 0;

            let worstSection = null;
            if (Array.isArray(quantContext.results) && quantContext.results.length > 0) {
                worstSection = quantContext.results.reduce((a, b) => (b.percent > a.percent ? b : a));
            }

            if (pct >= 60 && minimizeLike >= 1 && distressLike <= 1) {
                clauses.push({
                    id: `Ada kesenjangan yang perlu diperhatikan: skor kuantitatif Anda berada pada tingkat "${levelLabel ? levelLabel.id : 'tinggi'}" (${pct}%), namun jawaban naratif Anda cenderung meminimalkan dampaknya. Pola seperti ini — disebut *blind spot* — kadang membuat seseorang menunda mencari bantuan meski skornya sudah menunjukkan tingkat yang signifikan.`,
                    en: `There is a gap worth noting: your quantitative score is at the "${levelLabel ? levelLabel.en : 'high'}" level (${pct}%), yet your narrative answers tend to minimize the impact. A pattern like this — called a blind spot — can sometimes delay someone from seeking help even when the score already indicates a significant level.`
                });
            } else if (pct <= 20 && distressLike >= 3) {
                clauses.push({
                    id: `Menariknya, skor kuantitatif Anda tergolong rendah (${pct}%), tetapi jawaban naratif Anda memuat cukup banyak muatan distres emosional. Skala angka tidak selalu menangkap seluruh beban emosional — pertimbangkan untuk menuliskan lebih lanjut tentang apa yang sebenarnya Anda rasakan.`,
                    en: `Interestingly, your quantitative score is fairly low (${pct}%), yet your narrative answers carry a fair amount of emotional distress content. Numeric scales do not always capture the full emotional weight — consider writing more about what you are actually feeling.`
                });
            } else if (pct >= 40) {
                clauses.push({
                    id: `Pola naratif ini sejalan dengan skor kuantitatif Anda (${pct}%${levelLabel ? `, tingkat "${levelLabel.id}"` : ''}), yang menambah keyakinan bahwa gambaran ini cukup mencerminkan kondisi Anda saat ini.`,
                    en: `This narrative pattern aligns with your quantitative score (${pct}%${levelLabel ? `, "${levelLabel.en}" level` : ''}), which adds confidence that this picture reasonably reflects your current condition.`
                });
            }

            if (worstSection) {
                clauses.push({
                    id: `Secara kuantitatif, dimensi dengan skor tertinggi adalah "${worstSection.title.id}" (${Math.round(worstSection.percent)}%) — akan membantu jika refleksi naratif Anda ke depan difokuskan lebih spesifik ke dimensi ini.`,
                    en: `Quantitatively, the highest-scoring dimension is "${worstSection.title.en}" (${Math.round(worstSection.percent)}%) — it would help to focus your future narrative reflection more specifically on this dimension.`
                });
            }

            confidence = 'cukup tinggi (didukung data kuantitatif)';
            confidenceEn = 'fairly high (supported by quantitative data)';
        }

        const interpretationId = [bodyId, ...clauses.map((c) => c.id)].join(' ');
        const interpretationEn = [bodyEn, ...clauses.map((c) => c.en)].join(' ');

        const tags = [];
        if (anyUrgent) tags.push({ id: 'Perlu Perhatian Segera', en: 'Needs Immediate Attention' });
        if (anyChronic) tags.push({ id: 'Pola Kronis', en: 'Chronic Pattern' });
        if (dominantLocus === 'external') tags.push({ id: 'Atribusi Eksternal', en: 'External Attribution' });
        if (dominantLocus === 'internal') tags.push({ id: 'Kepemilikan Internal', en: 'Internal Ownership' });
        if (copingMentioned) tags.push({ id: 'Ada Strategi Coping', en: 'Coping Strategy Present' });
        if (toleranceMentioned) tags.push({ id: 'Eskalasi Toleransi', en: 'Tolerance Escalation' });
        if (withdrawalMentioned) tags.push({ id: 'Gejala Withdrawal', en: 'Withdrawal Symptoms' });
        if (relapseMentioned) tags.push({ id: 'Pola Relaps', en: 'Relapse Pattern' });

        const compositeRisk = computeCompositeRiskIndex(totals, quantContext, synergyBonusTotal);
        const addictionComponents = buildAddictionComponentProfile(totals);

        if (synergyPairsOverall.length > 0) tags.push({ id: 'Pola Kombinasi Berisiko', en: 'Compound Risk Pattern' });

        return {
            theme: { id: themeId, en: themeEn },
            interpretation: { id: interpretationId, en: interpretationEn },
            tags,
            confidence: { id: confidence, en: confidenceEn },
            compositeRisk,
            addictionComponents,
            axisTotals: totals,
            synergyPairs: synergyPairsOverall,
            reliabilityAvg
        };
    }

    global.AtlasSummaryEngine = { buildOverallSummary, computeCompositeRiskIndex, buildAddictionComponentProfile, getRiskBand };
})(window);
