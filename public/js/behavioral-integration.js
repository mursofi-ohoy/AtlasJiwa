/* =========================================
   ATLAS JIWA — Behavioral Integration Layer v1
   ---------------------------------------------------
   Menghubungkan behavioral-nlp-engine.js dan
   atlas-behavioral-advanced.js (sebelumnya di folder /NLP
   sebagai referensi, belum pernah dimuat di halaman mana pun)
   ke tampilan hasil screening.

   TIDAK MENGUBAH SATU BARIS PUN di:
     script.js, nlp-engine.js, keyword-dictionary.js,
     summary-engine.js, agent-bridge.js, screening-submit.js,
     auth*, HTML/CSS yang sudah ada.

   CARA KERJA (murni aditif / non-invasive):
   1. script.js sudah mengisi <div id="resultsContainer"> lewat
      `container.innerHTML = ...` setiap kali tombol "Hitung Hasil"
      diklik. File ini memasang MutationObserver di elemen tsb.
   2. Begitu render selesai (elemen .qualitative-entry muncul di
      DOM), teks jawaban naratif dibaca ULANG langsung dari DOM
      yang sudah dirender (bukan dari variabel privat script.js
      yang memang sengaja tidak diekspos ke window — supaya modul
      ini benar-benar berdiri sendiri, tidak menyentuh internal
      script.js sama sekali).
   3. Tiap teks dianalisis dengan AtlasBehavioralAdvanced.analyzeFull(),
      yang di baliknya memanggil AtlasBehavioralNLP.analyzeBehavioral()
      -> keduanya REUSE penuh AtlasNLPEngine.analyzeQualitative() dan
      AtlasKeywordDictionary yang sudah teruji (tidak menduplikasi
      logic negasi/intensifier/axis-scan).
   4. Hasil per-bagian diagregasi lintas-bagian (risk stratification,
      archetype pola digital, cognitive distortion, rekomendasi
      intervensi), lalu dirender sebagai PANEL TAMBAHAN yang
      disisipkan setelah panel "Wawasan Naratif Keseluruhan" yang
      sudah ada — tidak mengganti/menghapus apa pun yang sudah tampil.
   5. Fail-safe penuh: kalau salah satu file baru belum termuat, atau
      analisis melempar error, modul ini diam saja (skip) dan TIDAK
      PERNAH membuat renderResults() yang sudah berjalan jadi rusak.

   URUTAN MUAT (tambahkan SETELAH tag <script> yang sudah ada,
   SEBELUM script.js agar konsisten dengan urutan modul lain, atau
   bahkan setelah script.js — urutan tidak masalah karena modul ini
   hanya mengamati DOM, tidak dipanggil langsung oleh script.js):
     ...
     <script src="js/behavioral-nlp-engine.js"></script>
     <script src="js/atlas-behavioral-advanced.js"></script>
     <script src="js/behavioral-integration.js"></script>
     <script src="js/script.js"></script>
   ========================================= */

(function () {
    'use strict';

    /* ---------- Util kecil (duplikat sengaja, supaya modul ini
       tidak bergantung pada fungsi privat di dalam closure script.js) ---------- */
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function bi(idText, enText) {
        return `<span class="bi-id">${idText}</span><span class="bi-sep"> / </span><span class="bi-en">${enText}</span>`;
    }
    function biBlock(idText, enText) {
        return `<div class="bi-id">${idText}</div><div class="bi-en" style="opacity:.8; font-style:italic; margin-top:.35em;">${enText}</div>`;
    }

    /* ---------- Label bilingual untuk output agregat ---------- */
    const RISK_LEVEL_LABEL = {
        low: { id: 'Rendah', en: 'Low' },
        moderate: { id: 'Sedang', en: 'Moderate' },
        high: { id: 'Tinggi', en: 'High' },
        critical: { id: 'Kritis', en: 'Critical' }
    };
    const RISK_LEVEL_CLASS = {
        low: 'band-minimal', moderate: 'band-moderate', high: 'band-severe', critical: 'band-very-severe'
    };
    const RISK_REASON_LABEL = {
        // --- key yang berasal dari computeSeverity() (behavioral-nlp-engine.js) ---
        loss_of_control: { id: 'Kehilangan kendali atas perilaku', en: 'Loss of control over the behavior' },
        excessive_duration: { id: 'Durasi penggunaan berlebihan', en: 'Excessive duration of use' },
        functional_impairment: { id: 'Gangguan fungsi sehari-hari (kerja/akademik)', en: 'Functional impairment (work/academic)' },
        relationship_impact: { id: 'Dampak negatif pada hubungan', en: 'Negative impact on relationships' },
        failed_attempts: { id: 'Upaya berhenti/mengurangi yang gagal berulang', en: 'Repeated failed attempts to stop/reduce' },
        negative_after_effect: { id: 'Perasaan negatif setelah melakukan perilaku', en: 'Negative feelings after the behavior' },
        behavior_escalation: { id: 'Eskalasi perilaku dari waktu ke waktu', en: 'Behavior escalating over time' },
        frequency_pattern: { id: 'Pola frekuensi tinggi/berulang setiap hari', en: 'High-frequency, near-daily pattern' },
        night_pattern: { id: 'Pola penggunaan larut malam', en: 'Late-night usage pattern' },
        external_locus: { id: 'Locus of control eksternal (menyalahkan situasi/orang lain)', en: 'External locus of control (blaming situation/others)' },
        present_bias: { id: 'Bias condong ke kepuasan masa kini', en: 'Present-bias toward immediate gratification' },
        high_ambivalence: { id: 'Ambivalensi / konflik batin soal berubah', en: 'Ambivalence / internal conflict about changing' },
        intensity_amplified: { id: 'Bahasa intensitas tinggi menguatkan bukti di atas', en: 'High-intensity language reinforcing the evidence above' },
        financial_impact_present: { id: 'Dampak finansial terkait perilaku disebutkan', en: 'Financial impact related to the behavior mentioned' },
        financial_debt_reliance: { id: 'Ketergantungan pada utang/paylater untuk membiayai perilaku', en: 'Reliance on debt/pay-later to fund the behavior' },
        high_financial_expenditure: { id: 'Estimasi pengeluaran bulanan tergolong tinggi', en: 'Estimated monthly spending is high' },

        // --- key tambahan dari buildAdvancedLayer() (berbasis skor 0-10) ---
        high_loss_of_control: { id: 'Skor kehilangan kendali tinggi', en: 'High loss-of-control score' },
        high_emotional_dependency: { id: 'Skor ketergantungan emosional tinggi', en: 'High emotional-dependency score' },
        high_functional_impact: { id: 'Skor dampak fungsional tinggi', en: 'High functional-impact score' },
        high_change_difficulty: { id: 'Skor kesulitan berubah tinggi', en: 'High change-difficulty score' },
        catastrophizing: { id: 'Pola pikir katastrofik', en: 'Catastrophizing thought pattern' },
        rationalization: { id: 'Rasionalisasi / pembenaran diri', en: 'Rationalization' },

        // --- key dari sinyal lama analyzeBehavioral (v1), tetap dipertahankan ---
        habit_loop_present: { id: 'Siklus kebiasaan (trigger–reward–consequence) lengkap', en: 'Complete habit loop detected' },
        short_term_reward_long_term_cost_mismatch: { id: 'Reward jangka pendek berlawanan dengan biaya jangka panjang', en: 'Short-term reward vs. long-term cost mismatch' },
        urgency_markers_present: { id: 'Penanda urgensi/kedaruratan dalam narasi', en: 'Urgency markers present in narrative' },
        physical_symptoms_present: { id: 'Gejala fisik disebutkan', en: 'Physical symptoms mentioned' },
        catastrophizing_language: { id: 'Bahasa katastrofik (dari analisis leksikal)', en: 'Catastrophizing language (lexical layer)' }

        // --- v2 (atlas-behavioral-advanced.js): uang, kebiasaan, keyakinan kebutuhan ---
        financial_behavior_present: { id: 'Pola pengeluaran uang terkait perilaku (top up, gacha, checkout impulsif, langganan)', en: 'Spending patterns tied to the behavior (top-ups, gacha, impulsive checkout, subscriptions)' },
        financial_debt_terms: { id: 'Ada bahasa utang/paylater untuk membiayai perilaku', en: 'Debt/pay-later language used to fund the behavior' },
        daily_routine_displacement: { id: 'Rutinitas dasar tergeser (makan, tidur, kewajiban)', en: 'Basic routines displaced (meals, sleep, duties)' },
        habit_automaticity: { id: 'Perilaku berjalan otomatis tanpa niat sadar', en: 'Behavior runs automatically without conscious intent' },
        perceived_necessity: { id: 'Keyakinan "butuh/harus" terhadap perilaku', en: '"Need/must" belief about the behavior' },
        sole_coping_belief: { id: 'Perilaku dipercaya sebagai satu-satunya cara meredakan emosi', en: 'Behavior believed to be the only way to relieve emotions' },
        entitlement_self_reward: { id: 'Pola "self-reward / me time" yang memperkuat perilaku', en: '"Self-reward / me time" pattern reinforcing the behavior' },
        normalization_belief: { id: 'Normalisasi / perbandingan sosial untuk membenarkan perilaku', en: 'Normalization / social comparison justifying the behavior' },
        domain_specific_need: { id: 'Kebutuhan khas konteks (event game, takut ketinggalan info saat scrolling)', en: 'Context-specific needs (game events, fear of missing info while scrolling)' },
    };
    const ARCHETYPE_LABEL = {
        doomscrolling: { id: 'Doomscrolling', en: 'Doomscrolling' },
        revenge_bedtime: { id: 'Revenge Bedtime Procrastination', en: 'Revenge Bedtime Procrastination' },
        fomo: { id: 'FOMO (Takut Ketinggalan)', en: 'FOMO' },
        rage_bait: { id: 'Terpancing Konten Pemicu Amarah', en: 'Rage-Bait Engagement' },
        escapism: { id: 'Pelarian Digital', en: 'Digital Escapism' },
        binge_watching: { id: 'Binge-Watching Maraton', en: 'Binge-Watching' },
        compulsive_shopping: { id: 'Belanja Online Impulsif', en: 'Compulsive Online Shopping' },
        gaming_compulsion: { id: 'Dorongan Bermain Game Berlebihan', en: 'Gaming Compulsion' },
        validation_seeking: { id: 'Mencari Validasi Sosial (Like/Komentar)', en: 'Social Validation-Seeking' },
        social_comparison: { id: 'Perbandingan Sosial dengan Orang Lain', en: 'Social Comparison' }
    };
    const DISTORTION_LABEL = {
        all_or_nothing: { id: 'Berpikir Serba-Hitam-Putih', en: 'All-or-Nothing Thinking' },
        catastrophizing: { id: 'Katastrofisasi', en: 'Catastrophizing' },
        rationalization: { id: 'Rasionalisasi', en: 'Rationalization' },
        minimizing: { id: 'Minimalisasi', en: 'Minimizing' }
    };
    const STRATEGY_LABEL = {
        time_boxing: { id: 'Pembatasan Waktu (Time-Boxing)', en: 'Time-Boxing' },
        emotion_regulation: { id: 'Regulasi Emosi', en: 'Emotion Regulation' },
        environment_design: { id: 'Desain Ulang Lingkungan', en: 'Environment Design' },
        stimulus_control: { id: 'Kontrol Stimulus / Pemicu', en: 'Stimulus Control' },
        tiny_habits: { id: 'Perubahan Kebiasaan Kecil Bertahap', en: 'Tiny Habits' },
        cognitive_reframing: { id: 'Reframing Kognitif', en: 'Cognitive Reframing' },
        agency_building: { id: 'Penguatan Kendali Diri', en: 'Agency Building' },
        future_self_visualization: { id: 'Visualisasi Diri Masa Depan', en: 'Future-Self Visualization' },
        maintenance: { id: 'Pemeliharaan Kebiasaan Sehat', en: 'Maintenance' },
        relationship_repair: { id: 'Pemulihan Hubungan', en: 'Relationship Repair' },
        priority_blocking: { id: 'Pengamanan Prioritas Utama', en: 'Priority Blocking' },
        monitoring: { id: 'Pemantauan Pola Penggunaan', en: 'Usage Monitoring' }
        financial_boundary: { id: 'Batas Finansial (anggaran & pemisahan alat bayar)', en: 'Financial Boundaries (budget & separated payment tools)' },
        routine_replacement: { id: 'Pengganti Rutinitas & Proteksi Jam Dasar', en: 'Routine Replacement & Core-Hour Protection' },
        belief_restructuring: { id: 'Restrukturisasi Keyakinan ("butuh / normal / satu-satunya cara")', en: 'Belief Restructuring ("need it / normal / only way")' },
    };

   const FINANCIAL_BAND_LABEL = {
    minimal: {
        id: 'Minimal (< Rp100.000/bulan ≈ US$6)',
        en: 'Minimal (< US$6/month)'
    },

    moderate: {
        id: 'Sedang (Rp100.000–Rp300.000/bulan ≈ US$6–19)',
        en: 'Moderate (US$6–19/month)'
    },

    high: {
        id: 'Tinggi (Rp300.000–Rp1.000.000/bulan ≈ US$19–63)',
        en: 'High (US$19–63/month)'
    },

    very_high: {
        id: 'Sangat Tinggi (> Rp1.000.000/bulan ≈ US$63)',
        en: 'Very High (> US$63/month)'
    }
};
    };

    function labelOr(map, key) {
        return map[key] || { id: key, en: key };
    }

    function formatRupiah(amount) {
        return 'Rp' + Number(amount).toLocaleString('id-ID');
    }

    /* ---------- Gaya panel (disuntikkan sekali, meniru pola
       injectBilingualStyles() milik script.js) ---------- */
    function injectStyles() {
        if (document.getElementById('atlas-behavioral-integration-style')) return;
        const style = document.createElement('style');
        style.id = 'atlas-behavioral-integration-style';
        style.textContent = `
            .atlas-behavioral-panel {
                margin-top: 1.75rem;
                padding: 1.25rem 1.5rem;
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 10px;
                background: var(--bg-secondary, #f8f9fa);
            }
            .atlas-behavioral-panel h3 { margin-top: 0; }
            .atlas-behavioral-panel .risk-badge {
                display: inline-block;
                padding: 0.25rem 0.75rem;
                border-radius: 999px;
                font-weight: 600;
                font-size: 0.85rem;
                margin-bottom: 0.75rem;
            }
            .atlas-behavioral-panel .abp-section { margin-top: 1rem; }
            .atlas-behavioral-panel .abp-section-title {
                font-weight: 600;
                margin-bottom: 0.4rem;
                color: var(--accent, #4a90e2);
            }
            .atlas-behavioral-panel ul.abp-list { margin: 0; padding-left: 1.2rem; }
            .atlas-behavioral-panel ul.abp-list li { margin-bottom: 0.4rem; }
            .atlas-behavioral-panel .abp-strategy {
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 8px;
                padding: 0.6rem 0.8rem;
                margin-bottom: 0.5rem;
                background: var(--bg-primary, #fff);
            }
            .atlas-behavioral-panel .abp-strategy-name { font-weight: 600; }
            .atlas-behavioral-panel .abp-evidence {
                font-size: 0.85rem;
                opacity: 0.75;
                margin-top: 0.25rem;
                font-style: italic;
            }
        `;
        document.head.appendChild(style);
    }

    /* ---------- Ambil ulang teks jawaban naratif dari DOM hasil render ---------- */
    function extractSectionTexts() {
        const entries = document.querySelectorAll('#resultsContainer .qualitative-entry');
        const out = [];
        entries.forEach((entryEl) => {
            const titleEl = entryEl.querySelector('.qualitative-entry-title');
            const quoteEl = entryEl.querySelector('.qualitative-entry-content > div:first-child');
            if (!quoteEl) return;
            let text = (quoteEl.textContent || '').trim();
            // Kutipan dirender sebagai "teks" oleh script.js — lepas tanda kutip pembungkus.
            text = text.replace(/^"([\s\S]*)"$/, '$1');
            if (text) out.push({ label: titleEl ? titleEl.textContent.trim() : '', text });
        });
        return out;
    }

    /* ---------- Agregasi lintas-bagian ---------- */
    function aggregate(fullResults) {
        let points = 0;
        const reasonSet = new Set();
        const interventionMap = new Map();
        const archetypeHits = {};
        const distortionHits = {};
        let loopCount = 0;
        let escalationCount = 0;
        let financialAmount = null;
        let financialBand = null;
        let financialEvidence = [];
        let debtReliance = false;
        let explicitZeroSpend = false;

        fullResults.forEach((r) => {
            const adv = r.advanced;
            points += adv.risk.points;
            adv.risk.reasons.forEach((rs) => reasonSet.add(rs));
            (adv.interventions || []).forEach((iv) => {
                if (!interventionMap.has(iv.strategy)) interventionMap.set(iv.strategy, iv);
            });
            Object.keys(adv.archetypes || {}).forEach((k) => {
                if (adv.archetypes[k].present) archetypeHits[k] = (archetypeHits[k] || 0) + 1;
            });
            Object.keys(adv.distortions || {}).forEach((k) => {
                if (adv.distortions[k].present) distortionHits[k] = (distortionHits[k] || 0) + 1;
            });
            if (r.habit_loop && r.habit_loop.loop_detected) loopCount += 1;
            if (r.temporal && r.temporal.behavior_escalation) escalationCount += 1;

            // Ambil nominal/istilah finansial dari bagian mana pun yang
            // menyebutkannya (biasanya section "Konsekuensi Finansial",
            // tapi tidak dibatasi hanya section itu).
            const fin = r.functional_impact && r.functional_impact.financial;
            if (fin) {
                if (typeof fin.estimated_monthly_amount === 'number' &&
                    (financialAmount === null || fin.estimated_monthly_amount > financialAmount)) {
                    financialAmount = fin.estimated_monthly_amount;
                    financialBand = fin.spending_band;
                }
                if (fin.debt_reliance) debtReliance = true;
                if (fin.explicit_zero_spend_reported) explicitZeroSpend = true;
                financialEvidence = financialEvidence.concat(fin.evidence || []);
            }
        });

        let level = 'low';
        if (points >= 10) level = 'critical';
        else if (points >= 7) level = 'high';
        else if (points >= 4) level = 'moderate';

        return {
            points, level,
            reasons: Array.from(reasonSet),
            interventions: Array.from(interventionMap.values()),
            archetypeHits, distortionHits,
            loopCount, escalationCount,
            sectionCount: fullResults.length,
            financial: {
                amount: financialAmount,
                band: financialBand,
                debtReliance: debtReliance,
                explicitZeroSpend: explicitZeroSpend,
                evidence: financialEvidence.slice(0, 3)
            }
        };
    }

    /* ---------- Render panel HTML ---------- */
    function buildPanelHtml(agg) {
        const riskLabel = labelOr(RISK_LEVEL_LABEL, agg.level);
        const riskClass = RISK_LEVEL_CLASS[agg.level] || 'band-moderate';

        const reasonsHtml = agg.reasons.length
            ? `<div class="abp-section">
                    <div class="abp-section-title">${bi('Faktor Risiko Perilaku Terdeteksi', 'Detected Behavioral Risk Factors')}</div>
                    <ul class="abp-list">
                        ${agg.reasons.map((r) => `<li>${bi(labelOr(RISK_REASON_LABEL, r).id, labelOr(RISK_REASON_LABEL, r).en)}</li>`).join('')}
                    </ul>
               </div>`
            : '';

        const archetypeKeys = Object.keys(agg.archetypeHits);
        const archetypesHtml = archetypeKeys.length
            ? `<div class="abp-section">
                    <div class="abp-section-title">${bi('Pola Perilaku Digital', 'Digital Behavior Archetypes')}</div>
                    <ul class="abp-list">
                        ${archetypeKeys.map((k) => `<li>${bi(labelOr(ARCHETYPE_LABEL, k).id, labelOr(ARCHETYPE_LABEL, k).en)}</li>`).join('')}
                    </ul>
               </div>`
            : '';

        const distortionKeys = Object.keys(agg.distortionHits);
        const distortionsHtml = distortionKeys.length
            ? `<div class="abp-section">
                    <div class="abp-section-title">${bi('Pola Pikir yang Layak Dicermati', 'Thought Patterns Worth Noting')}</div>
                    <ul class="abp-list">
                        ${distortionKeys.map((k) => `<li>${bi(labelOr(DISTORTION_LABEL, k).id, labelOr(DISTORTION_LABEL, k).en)}</li>`).join('')}
                    </ul>
               </div>`
            : '';

        const interventionsHtml = agg.interventions.length
            ? `<div class="abp-section">
                    <div class="abp-section-title">${bi('Rekomendasi Strategi Perubahan', 'Recommended Change Strategies')}</div>
                    ${agg.interventions.map((iv) => `
                        <div class="abp-strategy">
                            <div class="abp-strategy-name">${bi(labelOr(STRATEGY_LABEL, iv.strategy).id, labelOr(STRATEGY_LABEL, iv.strategy).en)}</div>
                            <div>${iv.rationale_bi ? biBlock(iv.rationale_bi.id, iv.rationale_bi.en) : escapeHtml(iv.rationale || '')}</div>
                            ${iv.evidence && iv.evidence.length ? `<div class="abp-evidence">◈ "${escapeHtml(iv.evidence[0])}"</div>` : ''}
                        </div>
                    `).join('')}
               </div>`
            : '';

        const loopHtml = agg.loopCount > 0
            ? `<div class="abp-section">${bi(
                  `Siklus kebiasaan (pemicu → perilaku → reward → konsekuensi) terdeteksi lengkap pada ${agg.loopCount} dari ${agg.sectionCount} jawaban.`,
                  `A complete habit loop (trigger → behavior → reward → consequence) was detected in ${agg.loopCount} of ${agg.sectionCount} answers.`
              )}</div>`
            : '';

        const fin = agg.financial || {};
        const financialHtml = (fin.amount || fin.debtReliance || fin.explicitZeroSpend)
            ? `<div class="abp-section">
                    <div class="abp-section-title">${bi('Estimasi Dampak Finansial', 'Estimated Financial Impact')}</div>
                    ${typeof fin.amount === 'number'
                        ? `<div>${bi('Perkiraan pengeluaran bulanan yang disebutkan', 'Mentioned estimated monthly spending')}: <strong>${formatRupiah(fin.amount)}</strong>${fin.band ? ` — ${bi(labelOr(FINANCIAL_BAND_LABEL, fin.band).id, labelOr(FINANCIAL_BAND_LABEL, fin.band).en)}` : ''}</div>`
                        : ''}
                    ${fin.debtReliance
                        ? `<div style="margin-top:.4rem;">${bi('Ada indikasi penggunaan utang/paylater untuk membiayai perilaku ini.', 'There are indications of relying on debt/pay-later to fund this behavior.')}</div>`
                        : ''}
                    ${(!fin.amount && !fin.debtReliance && fin.explicitZeroSpend)
                        ? `<div>${bi('Pengguna melaporkan tidak ada pengeluaran finansial terkait perilaku ini.', 'The user reported no financial spending related to this behavior.')}</div>`
                        : ''}
                    ${fin.evidence && fin.evidence.length
                        ? `<div class="abp-evidence">◈ "${escapeHtml(fin.evidence[0])}"</div>`
                        : ''}
               </div>`
            : '';

        return `
            <div class="atlas-behavioral-panel" id="atlasBehavioralPanel">
                <h3>◈ ${bi('Analisis Perilaku Lanjutan', 'Advanced Behavioral Analysis')}</h3>
                <span class="risk-badge ${riskClass}">${bi(riskLabel.id, riskLabel.en)}</span>
                ${loopHtml}
                ${financialHtml}
                ${reasonsHtml}
                ${archetypesHtml}
                ${distortionsHtml}
                ${interventionsHtml}
                <div class="abp-section" style="opacity:.7; font-size:.85rem;">
                    ${biBlock(
                        'Analisis ini adalah lapisan tambahan berbasis pola bahasa (heuristik), bukan diagnosis. Gunakan bersama hasil skor kuantitatif dan ringkasan naratif di atas.',
                        'This is an additional heuristic language-pattern layer, not a diagnosis. Use it alongside the quantitative scores and narrative summary above.'
                    )}
                </div>
            </div>`;
    }

    /* ---------- Orkestrasi: dipanggil setiap kali #resultsContainer berubah ---------- */
    let observer = null;

    function processResults() {
        if (!window.AtlasBehavioralAdvanced || typeof window.AtlasBehavioralAdvanced.analyzeFull !== 'function') {
            return; // Fail-safe: file belum termuat, jangan lakukan apa pun.
        }
        const container = document.getElementById('resultsContainer');
        if (!container) return;

        const sections = extractSectionTexts();
        if (!sections.length) return; // Belum ada jawaban naratif untuk dianalisis.

        let fullResults;
        try {
            fullResults = sections.map((s) => window.AtlasBehavioralAdvanced.analyzeFull(s.text));
        } catch (err) {
            console.warn('[AtlasBehavioralIntegration] Analisis lanjutan gagal, dilewati:', err);
            return;
        }

        const agg = aggregate(fullResults);
        const panelHtml = buildPanelHtml(agg);

        // Lepas observer sementara supaya penyisipan panel kita sendiri
        // tidak memicu loop tak berkesudahan lewat MutationObserver.
        if (observer) observer.disconnect();

        const old = document.getElementById('atlasBehavioralPanel');
        if (old) old.remove();

        const wrapper = document.createElement('div');
        wrapper.innerHTML = panelHtml;
        const panelEl = wrapper.firstElementChild;

        const anchor = container.querySelector('.overall-qualitative-insight');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(panelEl, anchor.nextSibling);
        } else {
            const noteEl = container.querySelector('.note');
            if (noteEl && noteEl.parentNode) {
                noteEl.parentNode.insertBefore(panelEl, noteEl);
            } else {
                container.appendChild(panelEl);
            }
        }

        if (observer) observer.observe(container, { childList: true });
    }

    document.addEventListener('DOMContentLoaded', () => {
        injectStyles();
        const container = document.getElementById('resultsContainer');
        if (!container) return;
        observer = new MutationObserver(() => processResults());
        observer.observe(container, { childList: true });
    });

})();
