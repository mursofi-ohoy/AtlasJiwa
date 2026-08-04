/* =========================================
   ATLAS JIWA — Screening Test Logic
   Versi rapi + Qualitative NLP:
   - LEVELS & getLevel() jadi satu sumber kebenaran
     (menghilangkan duplikasi if/else level "minimal..sangat berat"
     yang sebelumnya ditulis 2x: per-bagian & overall)
   - Bug diperbaiki: renderResults() sebelumnya memakai variabel
     `data` yang tidak pernah dideklarasikan di scope-nya sendiri
     (ReferenceError saat klik "Hitung Hasil"). Sekarang `data`
     diambil eksplisit dari screeningData[currentTest].
   - Konstanta localStorage key dikumpulkan di satu tempat agar
     tidak ada "magic string" berulang.
   - Modularisasi: heuristic NLP engine, kamus kata kunci, dan
     ringkasan naratif keseluruhan sekarang berada di file terpisah
     (nlp-engine.js, keyword-dictionary.js, summary-engine.js).
     File ini HANYA memanggil fungsi-fungsi tersebut lewat
     window.AtlasNLPEngine dan window.AtlasSummaryEngine — tidak
     ada lagi logika NLP/kata kunci yang didefinisikan di sini.

   URUTAN MUAT SCRIPT (di HTML) — WAJIB dalam urutan ini:
     1. keyword-dictionary.js
     2. nlp-engine.js
     3. summary-engine.js
     4. script.js  (file ini, paling akhir)
   Semua file di atas adalah plain <script> biasa (bukan ES module),
   masing-masing mendaftarkan namespace-nya sendiri di `window`
   (AtlasKeywordDictionary, AtlasNLPEngine, AtlasSummaryEngine),
   sehingga tag <script> yang sudah ada di HTML tidak perlu diubah
   jadi type="module" — cukup tambahkan 3 tag <script> baru sebelum
   tag script.js yang sudah ada.
   ========================================= */

document.addEventListener('DOMContentLoaded', () => {
    console.log('[ATLAS] Screening Test initializing...');

    if (!window.AtlasNLPEngine || !window.AtlasSummaryEngine) {
        console.error(
            '[ATLAS] Modul nlp-engine.js / summary-engine.js belum dimuat. ' +
            'Pastikan urutan <script> di HTML: keyword-dictionary.js, nlp-engine.js, summary-engine.js, lalu script.js.'
        );
    }

    /* ---------- Bilingual Result Styling ---------- */
    // Style minimal untuk .bi-id / .bi-en / .bi-sep yang dipakai di panel
    // hasil (lihat bi()/biBlock() di bawah). Disuntikkan lewat JS supaya
    // tidak perlu menambah aturan baru ke file CSS terpisah.
    (function injectBilingualStyles() {
        if (document.getElementById('atlas-bilingual-style')) return;
        const style = document.createElement('style');
        style.id = 'atlas-bilingual-style';
        style.textContent = `
            .bi-id { font-weight: inherit; }
            .bi-sep { opacity: .45; margin: 0 .3em; }
            .bi-en { opacity: .75; font-style: italic; }
            div.bi-en { display: block; }

            /* Qualitative Analysis Styles */
            .qualitative-entry {
                background: var(--bg-secondary, #f8f9fa);
                border: 1px solid var(--border-color, #e0e0e0);
                border-radius: 8px;
                padding: 1.25rem;
                margin-bottom: 1rem;
                transition: transform 0.2s ease;
            }
            .qualitative-entry:hover { transform: translateY(-2px); }
            .qualitative-entry-title {
                font-weight: 600;
                margin-bottom: 0.75rem;
                color: var(--text-primary, #333);
            }
            .qualitative-entry-content {
                font-size: 0.95rem;
                line-height: 1.6;
            }
            .qualitative-analysis-box {
                margin-top: 1rem;
                padding: 1rem;
                background: var(--bg-primary, #ffffff);
                border-left: 4px solid var(--accent, #4a90e2);
                border-radius: 0 6px 6px 0;
                font-size: 0.9rem;
                box-shadow: 0 2px 4px rgba(0,0,0,0.03);
            }
            .overall-qualitative-insight {
                background: var(--bg-secondary, #f0f4f8);
                border-left: 4px solid var(--accent, #4a90e2);
                padding: 1.5rem;
                border-radius: 0 8px 8px 0;
                margin-bottom: 2rem;
                box-shadow: 0 4px 6px rgba(0,0,0,0.04);
            }
            .analysis-tags {
                display: flex;
                flex-wrap: wrap;
                gap: 0.4rem;
                margin: 0.5rem 0 0.75rem;
            }
            .analysis-tag {
                display: inline-block;
                font-size: 0.75rem;
                font-weight: 600;
                letter-spacing: 0.02em;
                padding: 0.2rem 0.6rem;
                border-radius: 999px;
                background: var(--accent, #4a90e2);
                color: #fff;
                opacity: 0.85;
                white-space: nowrap;
            }
            .analysis-evidence {
                margin-top: 0.85rem;
                padding-top: 0.75rem;
                border-top: 1px dashed var(--border-color, #e0e0e0);
            }
            .evidence-item {
                font-size: 0.85rem;
                font-style: italic;
                color: var(--text-muted, #666);
                margin-top: 0.35rem;
                line-height: 1.5;
            }
            .analysis-confidence {
                font-size: 0.78rem;
                color: var(--text-muted, #666);
                margin-top: 0.75rem;
                opacity: 0.85;
            }

            /* Composite Risk Gauge */
            .composite-risk-panel {
                display: flex;
                align-items: center;
                gap: 1.25rem;
                margin: 1rem 0 1.25rem;
                padding: 1rem 1.25rem;
                background: var(--bg-primary, #fff);
                border-radius: 8px;
                border: 1px solid var(--border-color, #e0e0e0);
                flex-wrap: wrap;
            }
            .composite-risk-ring { flex-shrink: 0; }
            .composite-risk-meta { flex: 1; min-width: 180px; }
            .composite-risk-score {
                font-size: 1.6rem;
                font-weight: 700;
                color: var(--accent, #4a90e2);
                line-height: 1.1;
            }
            .composite-risk-band {
                display: inline-block;
                font-size: 0.75rem;
                font-weight: 600;
                padding: 0.15rem 0.55rem;
                border-radius: 999px;
                margin-top: 0.3rem;
            }
            .composite-risk-band.band-minimal, .composite-risk-band.band-mild { background: var(--success-bg, rgba(45,122,79,.08)); color: var(--success, #2d7a4f); }
            .composite-risk-band.band-moderate { background: rgba(200,130,50,0.15); color: #a86830; }
            .composite-risk-band.band-severe, .composite-risk-band.band-very-severe { background: var(--warning-bg, rgba(184,84,80,.06)); color: var(--warning, #b85450); }
            .composite-risk-breakdown {
                font-size: 0.78rem;
                color: var(--text-muted, #666);
                margin-top: 0.5rem;
                line-height: 1.5;
            }

            /* Addiction Component (Griffiths) Profile */
            .addiction-profile { margin: 1.25rem 0; }
            .addiction-profile-title {
                font-size: 0.85rem;
                font-weight: 600;
                margin-bottom: 0.6rem;
                color: var(--text-primary, #333);
            }
            .addiction-component-row {
                display: grid;
                grid-template-columns: 150px 1fr auto;
                align-items: center;
                gap: 0.6rem;
                margin-bottom: 0.4rem;
                font-size: 0.78rem;
            }
            .addiction-component-label { color: var(--text-muted, #666); }
            .addiction-component-label.is-present { color: var(--text-primary, #333); font-weight: 600; }
            .addiction-component-track {
                height: 6px;
                background: var(--bg-secondary, #eee);
                border-radius: 999px;
                overflow: hidden;
            }
            .addiction-component-fill {
                height: 100%;
                background: var(--accent, #4a90e2);
                border-radius: 999px;
                transition: width 0.4s ease;
            }
            .addiction-component-fill.is-absent { background: var(--border-color, #ccc); }
            .addiction-component-score { font-size: 0.72rem; color: var(--text-muted, #666); min-width: 2.2em; text-align: right; }

            /* Radar chart wrapper */
            .axis-radar-wrap {
                margin: 1.25rem 0;
                text-align: center;
            }
            .axis-radar-wrap svg { max-width: 100%; height: auto; overflow: visible; }
            .axis-radar-wrap { max-width: 560px; margin-left: auto; margin-right: auto; }
            .axis-radar-title {
                font-size: 0.85rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
                color: var(--text-primary, #333);
                text-align: left;
            }

            /* Reliability / synergy badges */
            .reliability-note {
                font-size: 0.78rem;
                color: var(--text-muted, #666);
                margin-top: 0.6rem;
                padding-top: 0.6rem;
                border-top: 1px dashed var(--border-color, #e0e0e0);
            }
            .history-trend {
                font-size: 0.8rem;
                margin-top: 0.75rem;
                padding: 0.6rem 0.85rem;
                background: var(--accent-bg, rgba(74,144,226,0.08));
                border-radius: 6px;
                color: var(--text-primary, #333);
            }
        `;
        document.head.appendChild(style);
    })();

    /* ---------- Storage Keys ---------- */
    const STORAGE_KEYS = {
        theme: 'atlas-theme-screening',
        lang: 'atlas-lang-screening',
        answers: 'atlas-screening-answers',
    };

    const html = document.documentElement;
    let currentTest = 'scrolling';
    let currentLang = localStorage.getItem(STORAGE_KEYS.lang) || 'id';

    /* ---------- Level Interpretation (single source of truth) ---------- */
    // Menggantikan 2 blok if/else identik (per-bagian & overall) yang ada
    // di versi sebelumnya dengan satu tabel + satu fungsi lookup.
    const LEVELS = [
        {
            max: 20,
            levelClass: 'level-minimal',
            label: { id: 'Minimal', en: 'Minimal' },
            interpretation: {
                id: 'Pola perilaku Anda saat ini tampak sehat dan terkendali. Terus pertahankan keseimbangan ini.',
                en: 'Your current behavioral pattern appears healthy and controlled. Continue maintaining this balance.',
            },
        },
        {
            max: 40,
            levelClass: 'level-ringan',
            label: { id: 'Ringan', en: 'Mild' },
            interpretation: {
                id: 'Terdapat beberapa tanda awal yang perlu diperhatikan. Pertimbangkan untuk membuat batasan yang lebih jelas.',
                en: 'There are some early signs to notice. Consider setting clearer boundaries.',
            },
        },
        {
            max: 60,
            levelClass: 'level-sedang',
            label: { id: 'Sedang', en: 'Moderate' },
            interpretation: {
                id: 'Pola perilaku mulai menunjukkan dampak signifikan. Disarankan untuk melakukan evaluasi lebih dalam dan mempertimbangkan strategi pengurangan.',
                en: 'Behavioral patterns are showing significant impact. Deeper evaluation and reduction strategies are recommended.',
            },
        },
        {
            max: 80,
            levelClass: 'level-berat',
            label: { id: 'Berat', en: 'Severe' },
            interpretation: {
                id: 'Terdapat indikasi gangguan yang cukup serius. Konsultasi dengan profesional sangat disarankan untuk mendapatkan penanganan yang tepat.',
                en: 'There are indications of fairly serious impairment. Professional consultation is highly recommended for appropriate treatment.',
            },
        },
        {
            max: 100,
            levelClass: 'level-sangat-berat',
            label: { id: 'Sangat Berat', en: 'Very Severe' },
            interpretation: {
                id: 'Pola perilaku menunjukkan tingkat gangguan yang sangat tinggi. Segera cari bantuan profesional untuk mendapatkan dukungan yang diperlukan.',
                en: 'Behavioral patterns show very high levels of impairment. Seek professional help immediately for necessary support.',
            },
        },
    ];

    function getLevel(percent) {
        return LEVELS.find((level) => percent <= level.max) ?? LEVELS[LEVELS.length - 1];
    }

    /* ---------- Bilingual Text Helper (khusus panel Hasil) ---------- */
    // Panel hasil screening SELALU menampilkan Bahasa Indonesia & English
    // sekaligus, terlepas dari toggle bahasa (currentLang) yang mengatur
    // sisa antarmuka (pertanyaan, tombol, dsb).
    // - bi(): teks pendek, ditampilkan sebaris "ID / EN"
    // - biBlock(): teks panjang (interpretasi, disclaimer), ditampilkan
    //   bertumpuk (ID lalu EN miring) agar tetap enak dibaca
    function bi(idText, enText) {
        return `<span class="bi-id">${idText}</span><span class="bi-sep"> / </span><span class="bi-en">${enText}</span>`;
    }

    function biBlock(idText, enText) {
        return `<div class="bi-id">${idText}</div><div class="bi-en" style="opacity:.8; font-style:italic; margin-top:.35em;">${enText}</div>`;
    }

    // Menyisipkan teks dari pengguna (jawaban naratif, kutipan bukti NLP) ke
    // dalam HTML dengan aman — mencegah karakter seperti <, >, & merusak markup.
    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /* ---------- Composite Risk Gauge (ring SVG + label) ---------- */
    function bandClass(bandId) {
        const map = {
            Minimal: 'band-minimal',
            Ringan: 'band-mild',
            Sedang: 'band-moderate',
            Berat: 'band-severe',
            'Sangat Berat': 'band-very-severe',
        };
        return map[bandId] || 'band-moderate';
    }

    function renderCompositeRiskGauge(compositeRisk) {
        if (!compositeRisk) return '';
        const r = 34;
        const circumference = 2 * Math.PI * r;
        const offset = circumference * (1 - compositeRisk.score / 100);
        const quantPart = compositeRisk.quantitativePercent !== null
            ? `${bi('Kuantitatif', 'Quantitative')} ${compositeRisk.quantitativePercent}% (${Math.round(compositeRisk.weights.quantitative * 100)}%) + ${bi('Kualitatif', 'Qualitative')} ${compositeRisk.qualitativePercent}% (${Math.round(compositeRisk.weights.qualitative * 100)}%)`
            : `${bi('Berbasis kualitatif saja', 'Qualitative only')} — ${bi('lengkapi skor kuantitatif untuk indeks gabungan', 'complete the quantitative score for a combined index')}`;

        return `
            <div class="composite-risk-panel">
                <svg class="composite-risk-ring" width="88" height="88" viewBox="0 0 88 88">
                    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--bg-secondary, #eee)" stroke-width="8"/>
                    <circle cx="44" cy="44" r="${r}" fill="none" stroke="var(--accent, #4a90e2)" stroke-width="8"
                        stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
                        transform="rotate(-90 44 44)"/>
                    <text x="44" y="49" text-anchor="middle" font-size="18" font-weight="700" fill="var(--text-primary, #333)">${compositeRisk.score}%</text>
                </svg>
                <div class="composite-risk-meta">
                    <div class="composite-risk-score">${bi('Indeks Risiko Gabungan', 'Composite Risk Index')}</div>
                    <span class="composite-risk-band ${bandClass(compositeRisk.band.id)}">${bi(compositeRisk.band.id, compositeRisk.band.en)}</span>
                    <div class="composite-risk-breakdown">${quantPart}</div>
                </div>
            </div>`;
    }

    /* ---------- Addiction Component Profile (Griffiths 6-component model) ---------- */
    function renderAddictionProfile(components) {
        if (!components || components.length === 0) return '';
        const maxScore = Math.max(1, ...components.map((c) => c.score));
        const rows = components
            .map((c) => {
                const widthPct = Math.round((c.score / maxScore) * 100);
                return `
                <div class="addiction-component-row">
                    <div class="addiction-component-label${c.present ? ' is-present' : ''}">${bi(c.label.id, c.label.en)}</div>
                    <div class="addiction-component-track">
                        <div class="addiction-component-fill${c.present ? '' : ' is-absent'}" style="width:${c.present ? Math.max(widthPct, 6) : 0}%"></div>
                    </div>
                    <div class="addiction-component-score">${c.score}</div>
                </div>`;
            })
            .join('');
        return `
            <div class="addiction-profile">
                <div class="addiction-profile-title">◈ ${bi('Profil 6 Komponen Kecanduan Perilaku (Griffiths, 2005)', 'Six-Component Behavioral Addiction Profile (Griffiths, 2005)')}</div>
                ${rows}
            </div>`;
    }

    /* ---------- SVG Radar Chart untuk profil axis kualitatif ---------- */
    function renderAxisRadar(axisTotals, labels) {
        if (!axisTotals) return '';
        const keys = Object.keys(axisTotals).filter((k) => k !== 'minimization' && k !== 'externalAttribution' && k !== 'internalAttribution');
        if (keys.length < 3) return '';

        const size = 680;
        const center = size / 2;
        const maxRadius = center - 210;
        const labelRadius = maxRadius + 34;
        const maxVal = Math.max(2, ...keys.map((k) => axisTotals[k] || 0));
        const angleStep = (2 * Math.PI) / keys.length;

        function pointFor(i, value) {
            const angle = angleStep * i - Math.PI / 2;
            const radius = (Math.min(value, maxVal) / maxVal) * maxRadius;
            return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
        }

        const dataPoints = keys.map((k, i) => pointFor(i, axisTotals[k] || 0));
        const dataPath = dataPoints.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

        const gridRings = [0.25, 0.5, 0.75, 1].map((frac) => {
            const ringPoints = keys.map((k, i) => {
                const angle = angleStep * i - Math.PI / 2;
                return `${(center + frac * maxRadius * Math.cos(angle)).toFixed(1)},${(center + frac * maxRadius * Math.sin(angle)).toFixed(1)}`;
            }).join(' ');
            return `<polygon points="${ringPoints}" fill="none" stroke="var(--border-color, #ddd)" stroke-width="1" opacity="0.6"/>`;
        }).join('');

        // Pecah label panjang jadi maksimal 2 baris (di spasi terdekat tengah)
        // supaya tidak melebar terlalu jauh secara horizontal dan terpotong
        // oleh batas viewBox SVG.
        function wrapLabel(text) {
            if (text.length <= 16) return [text];
            const words = text.split(' ');
            if (words.length < 2) return [text];
            let bestSplit = 1;
            let bestDiff = Infinity;
            for (let s = 1; s < words.length; s++) {
                const l1 = words.slice(0, s).join(' ').length;
                const l2 = words.slice(s).join(' ').length;
                const diff = Math.abs(l1 - l2);
                if (diff < bestDiff) { bestDiff = diff; bestSplit = s; }
            }
            return [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
        }

        const axisLines = keys.map((k, i) => {
            const angle = angleStep * i - Math.PI / 2;
            const x2 = center + maxRadius * Math.cos(angle);
            const y2 = center + maxRadius * Math.sin(angle);
            const labelX = center + labelRadius * Math.cos(angle);
            const labelY = center + labelRadius * Math.sin(angle);
            const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle';
            const label = labels[k] ? (currentLang === 'id' ? labels[k].id : labels[k].en) : k;
            const lines = wrapLabel(label);
            const lineHeight = 12;
            const startDy = -((lines.length - 1) * lineHeight) / 2;
            const tspans = lines.map((line, li) => `<tspan x="${labelX.toFixed(1)}" dy="${li === 0 ? startDy : lineHeight}">${escapeHtml(line)}</tspan>`).join('');
            return `
                <line x1="${center}" y1="${center}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="var(--border-color, #ddd)" stroke-width="1" opacity="0.6"/>
                <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" font-size="11" fill="var(--text-muted, #666)" text-anchor="${anchor}" dominant-baseline="middle">${tspans}</text>`;
        }).join('');

        return `
            <div class="axis-radar-wrap">
                <div class="axis-radar-title">◈ ${bi('Peta Profil Axis Kualitatif', 'Qualitative Axis Profile Map')}</div>
                <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
                    ${gridRings}
                    ${axisLines}
                    <polygon points="${dataPath}" fill="var(--accent, #4a90e2)" fill-opacity="0.22" stroke="var(--accent, #4a90e2)" stroke-width="2"/>
                    ${dataPoints.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2.5" fill="var(--accent, #4a90e2)"/>`).join('')}
                </svg>
            </div>`;
    }

    /* ---------- Riwayat Skor Antar-Sesi (localStorage) ---------- */
    // Menyimpan indeks risiko komposit tiap kali "Hitung Hasil" ditekan,
    // supaya pengguna yang kembali mengisi screening di lain waktu bisa
    // melihat tren (naik/turun) — bukan cuma snapshot satu waktu.
    const HISTORY_KEY_PREFIX = 'atlas-history-';

    function recordHistoryEntry(testKey, compositeScore) {
        try {
            const key = HISTORY_KEY_PREFIX + testKey;
            const raw = localStorage.getItem(key);
            const list = raw ? JSON.parse(raw) : [];
            list.push({ t: Date.now(), score: compositeScore });
            const trimmed = list.slice(-10);
            localStorage.setItem(key, JSON.stringify(trimmed));
            return trimmed;
        } catch (e) {
            return [];
        }
    }

    function renderHistoryTrend(testKey, currentScore) {
        const history = recordHistoryEntry(testKey, currentScore);
        if (history.length < 2) return '';
        const previous = history[history.length - 2];
        const diff = currentScore - previous.score;
        const daysAgo = Math.max(0, Math.round((Date.now() - previous.t) / 86400000));
        const whenId = daysAgo === 0 ? 'sesi sebelumnya (hari ini)' : `${daysAgo} hari lalu`;
        const whenEn = daysAgo === 0 ? 'the previous session (today)' : `${daysAgo} day(s) ago`;

        let trendId;
        let trendEn;
        if (Math.abs(diff) < 3) {
            trendId = `relatif stabil dibanding ${whenId} (${previous.score}% → ${currentScore}%)`;
            trendEn = `relatively stable compared to ${whenEn} (${previous.score}% → ${currentScore}%)`;
        } else if (diff > 0) {
            trendId = `meningkat ${Math.abs(diff)} poin dibanding ${whenId} (${previous.score}% → ${currentScore}%)`;
            trendEn = `increased by ${Math.abs(diff)} points compared to ${whenEn} (${previous.score}% → ${currentScore}%)`;
        } else {
            trendId = `menurun ${Math.abs(diff)} poin dibanding ${whenId} (${previous.score}% → ${currentScore}%)`;
            trendEn = `decreased by ${Math.abs(diff)} points compared to ${whenEn} (${previous.score}% → ${currentScore}%)`;
        }

        return `<div class="history-trend">◈ ${bi('Tren Indeks Risiko', 'Risk Index Trend')}: ${bi(trendId, trendEn)} <span style="opacity:.7">(${bi(`berdasarkan ${history.length} sesi tersimpan di perangkat ini`, `based on ${history.length} sessions saved on this device`)})</span></div>`;
    }

    /* ---------- Theme Toggle ---------- */
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem(STORAGE_KEYS.theme) || 'light';
    html.setAttribute('data-theme', savedTheme);

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = html.getAttribute('data-theme');
            const next = current === 'light' ? 'dark' : 'light';
            html.setAttribute('data-theme', next);
            localStorage.setItem(STORAGE_KEYS.theme, next);
        });
    }

    /* ---------- Language Toggle ---------- */
    const langToggle = document.getElementById('langToggle');
    html.setAttribute('data-lang', currentLang);
    html.setAttribute('lang', currentLang === 'id' ? 'id' : 'en');

    function applyLanguage(lang) {
        document.querySelectorAll('[data-id][data-en]').forEach((el) => {
            const text = el.getAttribute(`data-${lang}`);
            if (!text) return;
            if (el.children.length === 0) {
                el.textContent = text;
            } else {
                el.innerHTML = text;
            }
        });

        if (langToggle) {
            const active = langToggle.querySelector('.lang-active');
            const inactive = langToggle.querySelector('.lang-inactive');
            if (lang === 'id') {
                active.textContent = 'ID';
                inactive.textContent = 'EN';
            } else {
                active.textContent = 'EN';
                inactive.textContent = 'ID';
            }
        }

        renderScreening(currentTest);
    }

    if (langToggle) {
        langToggle.addEventListener('click', () => {
            currentLang = currentLang === 'id' ? 'en' : 'id';
            localStorage.setItem(STORAGE_KEYS.lang, currentLang);
            html.setAttribute('data-lang', currentLang);
            html.setAttribute('lang', currentLang === 'id' ? 'id' : 'en');
            applyLanguage(currentLang);
        });
    }

    /* ---------- Screening Test Data ---------- */
    const screeningData = {
        scrolling: {
            title: { id: 'Screening Doom Scrolling', en: 'Doom Scrolling Screening' },
            sections: [
                {
                    id: 'B',
                    title: { id: 'Frekuensi Perilaku', en: 'Frequency of Behavior' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya membuka media sosial atau aplikasi berita tanpa tujuan yang jelas.', en: 'I open social media or news apps without a clear purpose.' },
                        { id: 'Saya melakukan scrolling secara otomatis begitu membuka ponsel, bahkan tanpa niat awal.', en: 'I scroll automatically as soon as I open my phone, even without initial intent.' },
                        { id: 'Saya mengecek ponsel segera setelah bangun tidur di pagi hari.', en: 'I check my phone immediately after waking up in the morning.' },
                        { id: 'Saya melakukan scrolling sebelum tidur, sering kali hingga larut malam.', en: 'I scroll before bed, often until late at night.' },
                        { id: 'Saya membuka aplikasi scrolling di sela-sela aktivitas lain.', en: 'I open scrolling apps in between other activities.' },
                        { id: 'Saya merasa perlu mengecek ponsel setiap kali ada jeda kosong.', en: 'I feel the need to check my phone during every idle moment.' },
                        { id: 'Saya membuka aplikasi yang sama berulang kali dalam satu jam.', en: 'I open the same app repeatedly within one hour.' },
                        { id: 'Saya melakukan scrolling di kamar mandi, saat makan, atau saat berbicara dengan orang lain.', en: 'I scroll in the bathroom, while eating, or while talking to others.' },
                        { id: 'Saya beralih dari satu platform ke platform lain secara terus-menerus.', en: 'I switch from one platform to another continuously.' },
                        { id: 'Saya melakukan scrolling sebagai respons pertama ketika merasa bosan, cemas, atau tidak nyaman.', en: 'I scroll as my first response when feeling bored, anxious, or uncomfortable.' },
                        { id: 'Saya melakukan scrolling meskipun ada tugas yang harus diselesaikan.', en: 'I scroll even when there are tasks that need to be completed.' },
                        { id: 'Saya merasa ada "tarikan" internal untuk membuka ponsel.', en: 'I feel an internal "pull" to open my phone.' },
                    ],
                    qualitative: {
                        id: 'Gambarkan rutinitas scrolling Anda dalam satu hari biasa.',
                        en: 'Describe your scrolling routine on a typical day.',
                    },
                },
                {
                    id: 'C',
                    title: { id: 'Durasi', en: 'Duration' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Satu sesi scrolling berlangsung lebih dari 30 menit tanpa saya sadari.', en: 'A single scrolling session lasts more than 30 minutes without me realizing.' },
                        { id: 'Saya sering merasa "kehilangan waktu" saat scrolling.', en: 'I often feel like "I lose track of time" while scrolling.' },
                        { id: 'Total waktu scrolling saya dalam sehari melebihi 2 jam.', en: 'My total daily scrolling time exceeds 2 hours.' },
                        { id: 'Saya pernah scrolling lebih dari 1 jam tanpa jeda.', en: 'I have scrolled for more than 1 hour without any break.' },
                        { id: 'Saya menunda tidur karena terus scrolling.', en: 'I delay sleep because I keep scrolling.' },
                        { id: 'Sesi scrolling saya sering lebih lama dari yang direncanakan.', en: 'My scrolling sessions are often longer than planned.' },
                        { id: 'Saya pernah membatalkan rencana karena terlalu lama scrolling.', en: 'I have cancelled plans because I spent too long scrolling.' },
                        { id: 'Saya menghabiskan waktu scrolling lebih lama daripada aktivitas produktif.', en: 'I spend more time scrolling than on productive activities.' },
                        { id: 'Saya pernah scrolling berjam-jam di akhir pekan tanpa aktivitas lain.', en: 'I have spent hours scrolling on weekends without other activities.' },
                        { id: 'Saya merasa satu hari "tidak lengkap" jika belum scrolling.', en: 'I feel a day is "incomplete" if I haven\'t scrolled.' },
                    ],
                    qualitative: {
                        id: 'Bayangkan jika sebagian waktu yang Anda gunakan untuk scrolling dimanfaatkan untuk kegiatan yang lebih bermanfaat. Apa yang mungkin dapat Anda capai?',
                        en: 'Imagine if some of the time you spend scrolling were used for more meaningful activities. What might you accomplish?',
                    },
                },
                {
                    id: 'D',
                    title: { id: 'Intensitas', en: 'Intensity' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya merasa gelisah, cemas, atau tidak nyaman jika tidak bisa scrolling.', en: 'I feel restless, anxious, or uncomfortable if I cannot scroll.' },
                        { id: 'Saya merasa "haus informasi" dan terus mencari konten baru.', en: 'I feel "information-hungry" and keep seeking new content.' },
                        { id: 'Saya kesulitan benar-benar berhenti scrolling meskipun sudah memutuskan.', en: 'I experience difficulty actually stopping scrolling even after deciding.' },
                        { id: 'Pikiran saya terus "melayang" ke konten yang baru dilihat.', en: 'My mind keeps "drifting" to content I just saw.' },
                        { id: 'Saya merasakan dorongan fisik untuk mulai scrolling.', en: 'I experience a physical urge to start scrolling.' },
                        { id: 'Saya merasa marah ketika diinterupsi saat scrolling.', en: 'I feel angry when interrupted while scrolling.' },
                        { id: 'Setelah scrolling dalam waktu lama, saya merasa "sulit berkonsentrasi" setelah sesi scrolling panjang.', en: 'I experience "brain fog" after long scrolling sessions.' },
                        { id: 'Saya merasa kosong setelah scrolling lama, tetapi tetap ingin melanjutkan.', en: 'I feel empty after long scrolling, but still want to continue.' },
                        { id: 'Saya mengonsumsi konten negatif secara kompulsif.', en: 'I compulsively consume negative content.' },
                        { id: 'Saya merasa scrolling adalah satu-satunya cara meredakan emosi.', en: 'I feel scrolling is the only way to soothe my emotions.' },
                        { id: 'Saya mengalami perubahan fisik saat scrolling konten emosional.', en: 'I experience physical changes while scrolling emotional content.' },
                        { id: 'Saya merasa "ketagihan" sensasi menemukan konten baru.', en: 'I feel "addicted" to the sensation of discovering new content.' },
                    ],
                    qualitative: {
                        id: 'Deskripsikan apa yang Anda rasakan SAAT dan SETELAH scrolling.',
                        en: 'Describe what you feel WHILE and AFTER scrolling.',
                    },
                },
                {
                    id: 'E',
                    title: { id: 'Dampak Kehidupan Sehari-hari', en: 'Impact on Daily Life' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Pola tidur saya terganggu karena scrolling.', en: 'My sleep pattern is disrupted by scrolling.' },
                        { id: 'Saya melewatkan atau menunda makan karena scrolling.', en: 'I skip or delay meals because of scrolling.' },
                        { id: 'Saya mengabaikan kebersihan diri karena scrolling.', en: 'I neglect personal hygiene because of scrolling.' },
                        { id: 'Aktivitas fisik saya berkurang karena scrolling.', en: 'My physical activity has decreased because of scrolling.' },
                        { id: 'Saya mengabaikan tugas rumah tangga karena scrolling.', en: 'I neglect household chores because of scrolling.' },
                        { id: 'Saya merasa hari-hari saya "tidak produktif".', en: 'I feel my days are "unproductive".' },
                        { id: 'Saya kehilangan minat pada hobi yang sebelumnya saya nikmati.', en: 'I have lost interest in hobbies I previously enjoyed.' },
                        { id: 'Rutinitas harian saya terganggu karena scrolling.', en: 'My daily routines are disrupted because of scrolling.' },
                        { id: 'Kualitas hidup saya menurun akibat scrolling.', en: 'My quality of life has declined due to scrolling.' },
                        { id: 'Saya mengalami kelelahan mata atau sakit kepala akibat scrolling.', en: 'I experience eye strain or headaches due to scrolling.' },
                        { id: 'Saya sulit menikmati momen "saat ini" tanpa mengecek ponsel.', en: 'I find it difficult to enjoy "present moments" without checking my phone.' },
                        { id: 'Saya merasa ada yang "kurang" jika belum scrolling.', en: 'I feel something is "missing" if I haven\'t scrolled.' },
                    ],
                    qualitative: {
                        id: 'Ceritakan satu hari di mana scrolling paling mengganggu rutinitas Anda.',
                        en: 'Describe one day when scrolling most disrupted your routine.',
                    },
                },
                {
                    id: 'F',
                    title: { id: 'Kemampuan Mengendalikan Diri', en: 'Self-Control Ability' },
                    scale: {
                        id: ['Sangat mudah', 'Mudah', 'Netral', 'Sulit', 'Sangat sulit'],
                        en: ['Very easy', 'Easy', 'Neutral', 'Difficult', 'Very difficult'],
                    },
                    questions: [
                        { id: 'Tidak membuka ponsel selama 1 jam penuh.', en: 'Not opening your phone for a full 1 hour.' },
                        { id: 'Berhenti scrolling setelah memutuskan "cukup untuk hari ini".', en: 'Stopping scrolling after deciding "that\'s enough for today".' },
                        { id: 'Tidak mengecek ponsel saat rapat atau acara sosial.', en: 'Not checking your phone during meetings or social events.' },
                        { id: 'Mengabaikan notifikasi saat fokus pada tugas lain.', en: 'Ignoring notifications while focusing on other tasks.' },
                        { id: 'Membatasi scrolling hanya pada waktu tertentu.', en: 'Limiting scrolling to specific times only.' },
                        { id: 'Tidak scrolling ketika merasa stres atau cemas.', en: 'Not scrolling when feeling stressed or anxious.' },
                        { id: 'Meletakkan ponsel sebelum tidur pada waktu tertentu.', en: 'Putting your phone away before bed at a set time.' },
                        { id: 'Tidak membuka aplikasi scrolling saat menunggu.', en: 'Not opening scrolling apps while waiting.' },
                        { id: 'Menghapus atau menonaktifkan aplikasi media sosial sementara.', en: 'Deleting or disabling social media apps temporarily.' },
                        { id: 'Mengatakan "tidak" pada dorongan scrolling saat ada pekerjaan.', en: 'Saying "no" to the urge to scroll when there is work to be done.' },
                    ],
                    qualitative: {
                        id: 'Pernahkah Anda mencoba mengurangi scrolling? Ceritakan upaya dan hasilnya.',
                        en: 'Have you ever tried to reduce scrolling? Describe your efforts and results.',
                    },
                },
                {
                    id: 'G',
                    title: { id: 'Konsekuensi Sosial', en: 'Social Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya mengabaikan percakapan dengan orang di sekitar.', en: 'I ignore conversations with people around me.' },
                        { id: 'Keluarga atau teman mengeluh saya terlalu sering melihat ponsel.', en: 'Family or friends complain I look at my phone too often.' },
                        { id: 'Saya membatalkan pertemuan sosial karena scrolling.', en: 'I cancel social gatherings because of scrolling.' },
                        { id: 'Saya merasa lebih terhubung dengan dunia online.', en: 'I feel more connected to the online world.' },
                        { id: 'Saya scrolling saat makan bersama keluarga/teman.', en: 'I scroll during meals with family or friends.' },
                        { id: 'Saya sulit hadir secara penuh dalam percakapan.', en: 'I find it difficult to be fully present in conversations.' },
                        { id: 'Orang terdekat merasa diabaikan.', en: 'My loved ones feel neglected.' },
                        { id: 'Saya kehilangan kesempatan membangun hubungan mendalam.', en: 'I miss opportunities to build deeper relationships.' },
                        { id: 'Saya mengalami konflik terkait penggunaan ponsel.', en: 'I experience conflicts regarding phone use.' },
                        { id: 'Saya merasa kesepian meski banyak mengonsumsi konten online.', en: 'I feel lonely despite consuming lots of online content.' },
                        { id: 'Anak atau anggota keluarga meniru kebiasaan scrolling saya.', en: 'Children or family members imitate my scrolling habit.' },
                        { id: 'Saya merasa malu ketika orang lain melihat saya scrolling.', en: 'I feel ashamed when others see me scrolling.' },
                    ],
                    qualitative: {
                        id: 'Apakah ada momen scrolling memengaruhi hubungan Anda dengan seseorang?',
                        en: 'Has there been a moment when scrolling affected your relationship?',
                    },
                },
                {
                    id: 'H',
                    title: { id: 'Konsekuensi Akademik/Pekerjaan', en: 'Academic/Work Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya menunda tugas karena scrolling.', en: 'I postpone assignments because of scrolling.' },
                        { id: 'Saya scrolling di tempat kerja/kelas.', en: 'I scroll at work/class.' },
                        { id: 'Kualitas pekerjaan saya menurun.', en: 'The quality of my work has declined.' },
                        { id: 'Saya sering melewatkan tenggat waktu.', en: 'I frequently miss deadlines.' },
                        { id: 'Saya kesulitan berkonsentrasi setelah scrolling panjang.', en: 'I have difficulty concentrating after long scrolling.' },
                        { id: 'Saya pernah mendapat teguran terkait penggunaan ponsel.', en: 'I have received warnings regarding phone use.' },
                        { id: 'Produktivitas harian saya menurun.', en: 'My daily productivity has decreased.' },
                        { id: 'Saya merasa "sibuk" tetapi sedikit yang selesai.', en: 'I feel "busy" but little is completed.' },
                        { id: 'Saya kehilangan motivasi untuk proyek jangka panjang.', en: 'I lose motivation for long-term projects.' },
                        { id: 'Saya kesulitan memahami materi/instruksi.', en: 'I have difficulty understanding material/instructions.' },
                        { id: 'Saya pernah kehilangan kesempatan karena scrolling.', en: 'I have missed opportunities because of scrolling.' },
                        { id: 'Kemampuan deep work saya menurun.', en: 'My deep work ability has declined.' },
                    ],
                    qualitative: {
                        id: 'Bagaimana scrolling memengaruhi kinerja akademik/profesional Anda?',
                        en: 'How has scrolling affected your academic/professional performance?',
                    },
                },
                {
                    id: 'I',
                    title: { id: 'Konsekuensi Finansial', en: 'Financial Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya berlangganan layanan digital yang jarang digunakan.', en: 'I subscribe to digital services I rarely use.' },
                        { id: 'Saya melakukan pembelian impulsif dari scrolling.', en: 'I make impulsive purchases from scrolling.' },
                        { id: 'Saya menghabiskan uang untuk paket data lebih banyak.', en: 'I spend more money on data packages.' },
                        { id: 'Saya membeli perangkat baru karena scrolling.', en: 'I buy new devices because of scrolling.' },
                        { id: 'Saya mengeluarkan uang untuk konten berbayar secara impulsif.', en: 'I spend money on paid content impulsively.' },
                        { id: 'Pengeluaran bulanan saya meningkat akibat scrolling.', en: 'My monthly expenses have increased due to scrolling.' },
                        { id: 'Saya membeli barang tidak dibutuhkan karena iklan.', en: 'I buy items I don\'t need because of ads.' },
                        { id: 'Saya kesulitan menabung akibat pengeluaran digital.', en: 'I have difficulty saving due to digital expenses.' },
                        { id: 'Saya menggunakan paylater/kartu kredit untuk pembelian dari scrolling.', en: 'I use pay-later/credit cards for purchases from scrolling.' },
                        { id: 'Saya merasa ada "kebocoran keuangan" terkait scrolling.', en: 'I feel there is a "financial leak" related to scrolling.' },
                    ],
                    qualitative: {
    id: 'Perkirakan pengeluaran bulanan Anda yang berkaitan dengan aktivitas scrolling. Masukkan nominal dalam Rupiah (Rp) atau Dollar AS (USD). Contoh: "Rp500.000", "Rp100.000", "Rp1.500.000", "US$10", atau "$10". Jika tidak ada pengeluaran, tulis "Rp0" atau "US$0".',
    en: 'Estimate your monthly spending related to scrolling activity. Enter the amount in Indonesian Rupiah (IDR) or US Dollars (USD). Examples: "Rp500,000", "Rp100,000", "Rp1,500,000", "US$10", or "$10". If there is no spending, write "Rp0" or "US$0".'
                },
                },
                {
                    id: 'J',
                    title: { id: 'Kecenderungan Mengulang Perilaku', en: 'Tendency to Repeat Behavior' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Setelah memutuskan mengurangi, saya kembali ke kebiasaan lama.', en: 'After deciding to reduce, I return to old habits.' },
                        { id: 'Saya membuat aturan untuk diri sendiri tetapi melanggarnya.', en: 'I make rules for myself but break them.' },
                        { id: 'Saya menghapus aplikasi, tetapi menginstal kembali.', en: 'I delete apps, but reinstall them.' },
                        { id: 'Pola scrolling saya sama dari minggu ke minggu.', en: 'My scrolling pattern is the same from week to week.' },
                        { id: 'Dorongan kembali muncul lebih kuat setelah berhenti.', en: 'The urge to return comes back stronger after stopping.' },
                        { id: 'Saya mengulangi siklus niat-berhasil-gagal-berulang.', en: 'I repeat the intention-success-failure cycle.' },
                        { id: 'Saya menggunakan alasan untuk kembali scrolling.', en: 'I use excuses to return to scrolling.' },
                        { id: 'Saya merasa tidak berdaya mengubah kebiasaan.', en: 'I feel powerless to change the habit.' },
                        { id: 'Stres selalu membawa saya kembali ke scrolling.', en: 'Stress always brings me back to scrolling.' },
                        { id: 'Kebiasaan saya semakin sulit dikendalikan.', en: 'My habit is becoming harder to control.' },
                        { id: 'Saya pernah berjanji mengurangi tetapi gagal.', en: 'I have promised to reduce but failed.' },
                        { id: 'Saya merasa "kalah" melawan kebiasaan.', en: 'I feel "defeated" by the habit.' },
                    ],
                    qualitative: {
                        id: 'Berapa kali dalam 6 bulan terakhir Anda mencoba mengubah kebiasaan?',
                        en: 'How many times in the last 6 months have you tried to change?',
                    },
                },
            ],
        },
        gaming: {
            title: { id: 'Screening Game Online', en: 'Online Gaming Screening' },
            sections: [
                {
                    id: 'B',
                    title: { id: 'Frekuensi Bermain', en: 'Gaming Frequency' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya bermain game setiap hari tanpa kecuali.', en: 'I play games every day without exception.' },
                        { id: 'Saya membuka game segera setelah bangun tidur.', en: 'I open games immediately after waking up.' },
                        { id: 'Saya bermain game di sela-sela aktivitas lain.', en: 'I play games in between other activities.' },
                        { id: 'Saya bermain game sebagai respons pertama saat bosan/stres.', en: 'I play games as my first response when bored/stressed.' },
                        { id: 'Saya bermain game meskipun ada tugas yang harus diselesaikan.', en: 'I play games even when there are tasks to complete.' },
                        { id: 'Saya membuka game untuk daily login tetapi bermain lebih lama.', en: 'I open games for daily login but end up playing longer.' },
                        { id: 'Saya bermain game sebelum tidur hingga larut malam.', en: 'I play games before bed until late at night.' },
                        { id: 'Saya memainkan beberapa game berbeda dalam satu hari.', en: 'I play several different games in one day.' },
                        { id: 'Saya bermain game di kamar mandi, saat makan, atau saat berbicara.', en: 'I play games in the bathroom, while eating, or while talking.' },
                        { id: 'Saya merasa ada "tarikan" internal untuk segera bermain.', en: 'I feel an internal "pull" to play immediately.' },
                        { id: 'Saya bermain game sepanjang hari di akhir pekan.', en: 'I play games all day on weekends.' },
                        { id: 'Saya bermain game meskipun sedang sakit atau lelah.', en: 'I play games even when sick or exhausted.' },
                    ],
                    qualitative: {
                        id: 'Gambarkan rutinitas bermain game Anda dalam satu hari biasa.',
                        en: 'Describe your gaming routine on a typical day.',
                    },
                },
                {
                    id: 'C',
                    title: { id: 'Durasi Bermain', en: 'Gaming Duration' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Satu sesi bermain berlangsung lebih dari 2 jam tanpa sadar.', en: 'A single session lasts more than 2 hours without realizing.' },
                        { id: 'Saya sering "kehilangan waktu" saat bermain.', en: 'I often "lose track of time" while playing.' },
                        { id: 'Total waktu bermain saya dalam sehari melebihi 4 jam.', en: 'My total daily gaming time exceeds 4 hours.' },
                        { id: 'Saya pernah bermain lebih dari 5 jam tanpa jeda.', en: 'I have played for more than 5 hours without any break.' },
                        { id: 'Saya menunda tidur karena terus bermain.', en: 'I delay sleep because I keep playing.' },
                        { id: 'Sesi bermain saya sering lebih lama dari rencana.', en: 'My gaming sessions are often longer than planned.' },
                        { id: 'Saya berkata "satu match lagi" tetapi bermain berjam-jam.', en: 'I say "one more match" but play for hours.' },
                        { id: 'Waktu bermain lebih lama daripada aktivitas produktif.', en: 'Gaming time is longer than productive activities.' },
                        { id: 'Saya pernah membatalkan rencana karena bermain.', en: 'I have cancelled plans because of gaming.' },
                        { id: 'Saya tetap bermain meskipun harus bangun pagi.', en: 'I keep playing even though I have to wake up early.' },
                    ],
                    qualitative: {
                        id: 'Perkirakan total waktu bermain per hari dan per akhir pekan.',
                        en: 'Estimate total gaming time per day and per weekend.',
                    },
                },
                {
                    id: 'D',
                    title: { id: 'Intensitas Bermain', en: 'Gaming Intensity' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya merasa gelisah atau mudah marah jika tidak bisa bermain.', en: 'I feel restless or irritable if I cannot play.' },
                        { id: 'Saya merasakan dorongan fisik untuk mulai bermain.', en: 'I experience a physical urge to start playing.' },
                        { id: 'Saya marah ketika diinterupsi saat bermain.', en: 'I feel angry when interrupted while playing.' },
                        { id: 'Saya terus bermain meskipun kalah berulang kali.', en: 'I keep playing even when losing repeatedly.' },
                        { id: 'Pikiran saya terus "melayang" ke game yang dimainkan.', en: 'My mind keeps "drifting" to the game I\'m playing.' },
                        { id: 'Saya mengalami "brain fog" setelah sesi panjang.', en: 'I experience "brain fog" after long sessions.' },
                        { id: 'Saya merasa kosong setelah bermain lama, tetapi tetap lanjut.', en: 'I feel empty after long play, but still continue.' },
                        { id: 'Game adalah satu-satunya cara meredakan emosi.', en: 'Gaming is the only way to soothe my emotions.' },
                        { id: 'Saya mengalami perubahan fisik saat bermain kompetitif.', en: 'I experience physical changes while playing competitively.' },
                        { id: 'Saya merasa euforia saat menang, sangat kecewa saat kalah.', en: 'I feel euphoric when winning, deeply disappointed when losing.' },
                        { id: 'Identitas saya terkait dengan rank/level/koleksi dalam game.', en: 'My identity is tied to rank/level/collection in the game.' },
                        { id: 'Dunia game terasa lebih nyata daripada kehidupan nyata.', en: 'The game world feels more real than real life.' },
                    ],
                    qualitative: {
                        id: 'Deskripsikan apa yang Anda rasakan SAAT dan SETELAH bermain.',
                        en: 'Describe what you feel WHILE and AFTER playing.',
                    },
                },
                {
                    id: 'E',
                    title: { id: 'Dampak Kehidupan Sehari-hari', en: 'Impact on Daily Life' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Pola tidur saya terganggu karena bermain game.', en: 'My sleep pattern is disrupted by gaming.' },
                        { id: 'Saya melewatkan makan karena bermain game.', en: 'I skip meals because of gaming.' },
                        { id: 'Saya mengabaikan kebersihan diri karena bermain game.', en: 'I neglect personal hygiene because of gaming.' },
                        { id: 'Aktivitas fisik saya berkurang karena bermain game.', en: 'My physical activity has decreased because of gaming.' },
                        { id: 'Saya mengabaikan tugas rumah tangga karena bermain game.', en: 'I neglect household chores because of gaming.' },
                        { id: 'Hari-hari saya terasa "tidak produktif".', en: 'My days feel "unproductive".' },
                        { id: 'Saya kehilangan minat pada hobi di luar game.', en: 'I have lost interest in hobbies outside games.' },
                        { id: 'Rutinitas harian saya terganggu karena bermain game.', en: 'My daily routines are disrupted because of gaming.' },
                        { id: 'Kualitas hidup saya menurun akibat bermain game.', en: 'My quality of life has declined due to gaming.' },
                        { id: 'Saya mengalami masalah fisik akibat bermain berlebihan.', en: 'I experience physical problems from excessive gaming.' },
                        { id: 'Saya sulit menikmati momen tanpa ingin kembali bermain.', en: 'I find it difficult to enjoy moments without wanting to return to gaming.' },
                        { id: 'Saya merasa ada yang "kurang" jika belum bermain.', en: 'I feel something is "missing" if I haven\'t played.' },
                    ],
                    qualitative: {
                        id: 'Ceritakan satu hari di mana bermain game paling mengganggu rutinitas.',
                        en: 'Describe one day when gaming most disrupted your routine.',
                    },
                },
                {
                    id: 'F',
                    title: { id: 'Kemampuan Mengendalikan Diri', en: 'Self-Control Ability' },
                    scale: {
                        id: ['Sangat mudah', 'Mudah', 'Netral', 'Sulit', 'Sangat sulit'],
                        en: ['Very easy', 'Easy', 'Neutral', 'Difficult', 'Very difficult'],
                    },
                    questions: [
                        { id: 'Tidak bermain game selama 1 hari penuh.', en: 'Not playing games for a full day.' },
                        { id: 'Berhenti bermain setelah memutuskan "cukup untuk hari ini".', en: 'Stopping after deciding "that\'s enough for today".' },
                        { id: 'Menolak ajakan teman tim/guild untuk bermain.', en: 'Declining invitations from teammates/guild to play.' },
                        { id: 'Mengabaikan notifikasi game saat fokus pada tugas lain.', en: 'Ignoring game notifications while focusing on other tasks.' },
                        { id: 'Membatasi bermain hanya pada waktu tertentu.', en: 'Limiting gaming to specific times only.' },
                        { id: 'Tidak bermain ketika merasa stres atau kesepian.', en: 'Not playing when feeling stressed or lonely.' },
                        { id: 'Meletakkan perangkat dan tidur pada waktu tertentu.', en: 'Putting down the device and sleeping at a set time.' },
                        { id: 'Berhenti bermain setelah kalah (tidak balas kekalahan).', en: 'Stopping after losing (not revenge playing).' },
                        { id: 'Menghapus atau menonaktifkan game sementara.', en: 'Deleting or disabling games temporarily.' },
                        { id: 'Tidak login harian atau menyelesaikan misi harian saat sibuk.', en: 'Skipping daily login or missions when busy.' },
                    ],
                    qualitative: {
                        id: 'Pernahkah Anda mencoba mengurangi bermain game? Ceritakan upaya dan hasilnya.',
                        en: 'Have you ever tried to reduce gaming? Describe your efforts and results.',
                    },
                },
                {
                    id: 'G',
                    title: { id: 'Konsekuensi Sosial', en: 'Social Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya mengabaikan percakapan dengan orang di sekitar.', en: 'I ignore conversations with people around me.' },
                        { id: 'Keluarga/teman mengeluh saya terlalu sering bermain game.', en: 'Family/friends complain I play games too often.' },
                        { id: 'Saya membatalkan pertemuan sosial karena bermain game.', en: 'I cancel social gatherings because of gaming.' },
                        { id: 'Saya merasa lebih terhubung dengan teman dalam game.', en: 'I feel more connected to in-game friends.' },
                        { id: 'Saya bermain game saat makan bersama keluarga/teman.', en: 'I play games during meals with family/friends.' },
                        { id: 'Saya sulit hadir secara penuh dalam percakapan.', en: 'I find it difficult to be fully present in conversations.' },
                        { id: 'Orang terdekat merasa diabaikan.', en: 'My loved ones feel neglected.' },
                        { id: 'Saya kehilangan kesempatan membangun hubungan mendalam.', en: 'I miss opportunities to build deeper relationships.' },
                        { id: 'Saya mengalami konflik terkait kebiasaan bermain game.', en: 'I experience conflicts regarding gaming habits.' },
                        { id: 'Saya merasa kesepian di kehidupan nyata.', en: 'I feel lonely in real life.' },
                        { id: 'Saya merasa berkewajiban sosial untuk terus bermain.', en: 'I feel socially obligated to keep playing.' },
                        { id: 'Saya merasa malu ketika orang lain melihat saya bermain.', en: 'I feel ashamed when others see me playing.' },
                    ],
                    qualitative: {
                        id: 'Apakah ada momen bermain game memengaruhi hubungan Anda?',
                        en: 'Has there been a moment when gaming affected your relationship?',
                    },
                },
                {
                    id: 'H',
                    title: { id: 'Konsekuensi Akademik/Pekerjaan', en: 'Academic/Work Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya menunda tugas karena bermain game.', en: 'I postpone assignments because of gaming.' },
                        { id: 'Saya bermain game di tempat kerja/kelas.', en: 'I play games at work/class.' },
                        { id: 'Kualitas pekerjaan saya menurun.', en: 'The quality of my work has declined.' },
                        { id: 'Saya sering melewatkan tenggat waktu.', en: 'I frequently miss deadlines.' },
                        { id: 'Saya kesulitan berkonsentrasi setelah sesi bermain panjang.', en: 'I have difficulty concentrating after long sessions.' },
                        { id: 'Saya pernah mendapat teguran terkait bermain game.', en: 'I have received warnings regarding gaming.' },
                        { id: 'Produktivitas harian saya menurun.', en: 'My daily productivity has decreased.' },
                        { id: 'Saya merasa "sibuk" tetapi sedikit yang selesai.', en: 'I feel "busy" but little is completed.' },
                        { id: 'Saya kehilangan motivasi untuk proyek jangka panjang.', en: 'I lose motivation for long-term projects.' },
                        { id: 'Saya kesulitan memahami materi/instruksi.', en: 'I have difficulty understanding material/instructions.' },
                        { id: 'Saya pernah kehilangan kesempatan karena bermain game.', en: 'I have missed opportunities because of gaming.' },
                        { id: 'Kemampuan deep work saya menurun.', en: 'My deep work ability has declined.' },
                    ],
                    qualitative: {
                        id: 'Bagaimana bermain game memengaruhi kinerja akademik/profesional Anda?',
                        en: 'How has gaming affected your academic/professional performance?',
                    },
                },
                {
                    id: 'I',
                    title: { id: 'Konsekuensi Finansial', en: 'Financial Consequences' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Saya melakukan top up atau membeli item game secara impulsif.', en: 'I impulsively top up or buy in-game items.' },
                        { id: 'Saya membuka loot box atau gacha meski peluang kecil.', en: 'I open loot boxes or do gacha despite low odds.' },
                        { id: 'Saya terus top up setelah kalah/gagal dengan harapan "sekali lagi".', en: 'I keep topping up after losing, hoping "one more time".' },
                        { id: 'Saya mengeluarkan uang untuk game meski sedang berhemat.', en: 'I spend money on games even when trying to save.' },
                        { id: 'Saya membeli item game karena FOMO.', en: 'I buy game items because of FOMO.' },
                        { id: 'Saya menggunakan kartu kredit/paylater untuk top up.', en: 'I use credit cards/pay-later for top-ups.' },
                        { id: 'Saya menyembunyikan pengeluaran game dari keluarga.', en: 'I hide game spending from family.' },
                        { id: 'Pengeluaran bulanan saya meningkat akibat top up.', en: 'My monthly expenses increased due to top-ups.' },
                        { id: 'Saya merasa bersalah setelah top up, tetapi mengulanginya.', en: 'I feel guilty after topping up, but repeat it.' },
                        { id: 'Harga diri saya terkait dengan item langka dalam game.', en: 'My self-worth is tied to rare items in the game.' },
                    ],
                    qualitative: {
    id: 'Perkirakan pengeluaran bulanan Anda yang berkaitan dengan aktivitas bermain game. Masukkan nominal dalam Rupiah (Rp) atau Dollar AS (USD). Termasuk top up, pembelian item, skin, battle pass, gacha, langganan, atau transaksi dalam game. Contoh: "Rp100.000", "Rp500.000", "Rp1.500.000", "US$10", atau "$10". Jika tidak ada pengeluaran, tulis "Rp0" atau "US$0".',
    en: 'Estimate your monthly spending related to gaming activity. Enter the amount in Indonesian Rupiah (IDR) or US Dollars (USD). Include top-ups, item purchases, skins, battle passes, gacha, subscriptions, or in-game transactions. Examples: "Rp100,000", "Rp500,000", "Rp1,500,000", "US$10", or "$10". If there is no spending, write "Rp0" or "US$0".'
}
                },
                {
                    id: 'J',
                    title: { id: 'Kecenderungan Mengulang Perilaku', en: 'Tendency to Repeat Behavior' },
                    scale: {
                        id: ['Tidak pernah', 'Jarang', 'Kadang-kadang', 'Sering', 'Sangat sering'],
                        en: ['Never', 'Rarely', 'Sometimes', 'Often', 'Very often'],
                    },
                    questions: [
                        { id: 'Setelah memutuskan mengurangi, saya kembali ke kebiasaan lama.', en: 'After deciding to reduce, I return to old habits.' },
                        { id: 'Saya membuat aturan untuk diri sendiri tetapi melanggarnya.', en: 'I make rules for myself but break them.' },
                        { id: 'Saya menghapus game, tetapi menginstal kembali.', en: 'I delete games, but reinstall them.' },
                        { id: 'Pola bermain saya sama dari minggu ke minggu.', en: 'My gaming pattern is the same from week to week.' },
                        { id: 'Dorongan kembali muncul lebih kuat setelah berhenti.', en: 'The urge to return comes back stronger after stopping.' },
                        { id: 'Saya mengulangi siklus niat-berhasil-gagal-berulang.', en: 'I repeat the intention-success-failure cycle.' },
                        { id: 'Saya menggunakan alasan untuk kembali bermain.', en: 'I use excuses to return to gaming.' },
                        { id: 'Saya merasa tidak berdaya mengubah kebiasaan.', en: 'I feel powerless to change the habit.' },
                        { id: 'Stres selalu membawa saya kembali ke game.', en: 'Stress always brings me back to games.' },
                        { id: 'Kebiasaan saya semakin sulit dikendalikan.', en: 'My habit is becoming harder to control.' },
                        { id: 'Saya pernah berjanji mengurangi tetapi gagal.', en: 'I have promised to reduce but failed.' },
                        { id: 'Saya merasa "kalah" melawan kebiasaan.', en: 'I feel "defeated" by the habit.' },
                    ],
                    qualitative: {
                        id: 'Berapa kali dalam 6 bulan terakhir Anda mencoba mengubah kebiasaan?',
                        en: 'How many times in the last 6 months have you tried to change?',
                    },
                },
            ],
        },
    };

    /* ---------- User Answers Storage ---------- */
    const userAnswers = {
        scrolling: { quantitative: {}, qualitative: {} },
        gaming: { quantitative: {}, qualitative: {} },
    };

    (function loadSavedAnswers() {
        const savedAnswers = localStorage.getItem(STORAGE_KEYS.answers);
        if (!savedAnswers) return;
        try {
            const parsed = JSON.parse(savedAnswers);
            Object.assign(userAnswers.scrolling, parsed.scrolling || { quantitative: {}, qualitative: {} });
            Object.assign(userAnswers.gaming, parsed.gaming || { quantitative: {}, qualitative: {} });
        } catch (e) {
            console.warn('[ATLAS] Failed to load saved answers', e);
        }
    })();

    function saveToStorage() {
        localStorage.setItem(STORAGE_KEYS.answers, JSON.stringify(userAnswers));
    }

    /* ---------- Render Screening ---------- */
    function renderScreening(testType) {
        const container = document.getElementById('screeningContainer');
        const titleEl = document.getElementById('screeningTitle');
        const data = screeningData[testType];

        if (!data || !container) return;

        titleEl.setAttribute('data-id', data.title.id);
        titleEl.setAttribute('data-en', data.title.en);
        titleEl.textContent = data.title[currentLang];

        const html = data.sections
            .map((section) => {
                const sectionKey = `${testType}-${section.id}`;
                const sectionAnswers = userAnswers[testType].quantitative[section.id] || {};
                const answeredCount = Object.keys(sectionAnswers).length;
                const totalQuestions = section.questions.length;
                const isComplete = answeredCount === totalQuestions;

                const legendHtml = section.scale[currentLang]
                    .map((s, i) => `<div class="scale-item"><span class="scale-num">${i + 1}</span> = ${s}</div>`)
                    .join('');

                const questionsHtml = section.questions
                    .map((q, qIdx) => {
                        const savedValue = sectionAnswers[qIdx];
                        const optionsHtml = [1, 2, 3, 4, 5]
                            .map(
                                (val) => `
                                <div class="scale-option">
                                    <input type="radio"
                                           id="${sectionKey}-${qIdx}-${val}"
                                           name="${sectionKey}-${qIdx}"
                                           value="${val}"
                                           ${savedValue === val ? 'checked' : ''}
                                           onchange="handleAnswer('${testType}', '${section.id}', ${qIdx}, ${val})">
                                    <label for="${sectionKey}-${qIdx}-${val}">${val}</label>
                                </div>`
                            )
                            .join('');

                        return `
                            <div class="question-item">
                                <div class="question-text">${qIdx + 1}. ${q[currentLang]}</div>
                                <div class="scale-options">${optionsHtml}</div>
                            </div>`;
                    })
                    .join('');

                return `
                    <div class="screening-section ${isComplete ? 'completed' : ''}" data-section="${section.id}">
                        <div class="screening-header" onclick="toggleSection(this)">
                            <div class="screening-title">
                                <span class="section-number">${section.id}</span>
                                <h3>${section.title[currentLang]}</h3>
                            </div>
                            <div class="screening-badge">
                                <span class="section-progress ${isComplete ? 'complete' : ''}">${answeredCount}/${totalQuestions}</span>
                                <span class="toggle-icon">+</span>
                            </div>
                        </div>
                        <div class="screening-body">
                            <div class="scale-legend">${legendHtml}</div>
                            ${questionsHtml}
                            <div class="qualitative-question">
                                <p>${currentLang === 'id' ? 'Pertanyaan Kualitatif:' : 'Qualitative Question:'} ${section.qualitative[currentLang]}</p>
                                <textarea
                                    placeholder="${currentLang === 'id' ? 'Tulis jawaban Anda di sini...' : 'Write your answer here...'}"
                                    onchange="handleQualitative('${testType}', '${section.id}', this.value)"
                                >${userAnswers[testType].qualitative[section.id] || ''}</textarea>
                            </div>
                        </div>
                    </div>`;
            })
            .join('');

        container.innerHTML = html;
        updateProgress();
    }

    /* ---------- Toggle Section ---------- */
    window.toggleSection = function toggleSection(header) {
        header.parentElement.classList.toggle('open');
    };

    /* ---------- Handle Answer ---------- */
    window.handleAnswer = function handleAnswer(testType, sectionId, qIdx, value) {
        if (!userAnswers[testType].quantitative[sectionId]) {
            userAnswers[testType].quantitative[sectionId] = {};
        }
        userAnswers[testType].quantitative[sectionId][qIdx] = value;

        const sectionEl = document.querySelector(`[data-section="${sectionId}"]`);
        if (sectionEl) {
            const section = screeningData[testType].sections.find((s) => s.id === sectionId);
            const answeredCount = Object.keys(userAnswers[testType].quantitative[sectionId]).length;
            const isComplete = answeredCount === section.questions.length;

            sectionEl.classList.toggle('completed', isComplete);
            const badge = sectionEl.querySelector('.section-progress');
            if (badge) {
                badge.textContent = `${answeredCount}/${section.questions.length}`;
                badge.classList.toggle('complete', isComplete);
            }
        }

        updateProgress();
        saveToStorage();
    };

    /* ---------- Handle Qualitative ---------- */
    window.handleQualitative = function handleQualitative(testType, sectionId, value) {
        userAnswers[testType].qualitative[sectionId] = value;
        saveToStorage();
    };

    /* ---------- Update Progress ---------- */
    function updateProgress() {
        const data = screeningData[currentTest];
        let totalQuestions = 0;
        let answeredQuestions = 0;

        data.sections.forEach((section) => {
            totalQuestions += section.questions.length;
            const sectionAnswers = userAnswers[currentTest].quantitative[section.id] || {};
            answeredQuestions += Object.keys(sectionAnswers).length;
        });

        const percent = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;

        const progressFill = document.getElementById('progressFill');
        const progressPercent = document.getElementById('progressPercent');
        const answeredCount = document.getElementById('answeredCount');

        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (answeredCount) {
            const base = currentLang === 'id' ? 'terjawab dari' : 'answered of';
            answeredCount.textContent = `${answeredQuestions} ${base} ${totalQuestions}`;
        }
    }

    /* ---------- Placeholder helper for results panel ---------- */
    function renderResultsPlaceholder() {
        document.getElementById('resultsContainer').innerHTML = `
            <div class="results-placeholder">
                <div class="placeholder-icon">◈</div>
                <p>${bi(
                    'Lengkapi screening test di atas, lalu klik "Hitung Hasil" untuk melihat interpretasi kuantitatif & kualitatif Anda.',
                    'Complete the screening test above, then click "Calculate Results" to see your quantitative & qualitative interpretation.'
                )}</p>
            </div>`;
    }

    /* ---------- Calculate Results ---------- */
    // Menghitung skor per bagian + skor total, memakai getLevel() yang
    // sudah didefinisikan sekali di atas (tidak ada if/else berulang lagi).
    document.getElementById('calculateBtn').addEventListener('click', () => {
        const data = screeningData[currentTest];
        const results = [];
        let totalScore = 0;
        let totalMax = 0;

        data.sections.forEach((section) => {
            const sectionAnswers = userAnswers[currentTest].quantitative[section.id] || {};
            const scores = Object.values(sectionAnswers);
            const sum = scores.reduce((a, b) => a + b, 0);
            const max = section.questions.length * 5;
            const percent = max > 0 ? (sum / max) * 100 : 0;
            const level = getLevel(percent);

            results.push({
                id: section.id,
                title: section.title,
                score: sum,
                max,
                percent,
                level,
            });

            totalScore += sum;
            totalMax += max;
        });

        const overallPercent = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
        const overallLevel = getLevel(overallPercent);

        renderResults(data, results, totalScore, totalMax, overallPercent, overallLevel);

        // Kirim RINGKASAN SKOR KUANTITATIF SAJA ke backend ATLAS JIWA
        // (server/routes/screening.routes.js) agar tersimpan permanen di
        // CockroachDB, selain tersimpan di localStorage seperti biasa.
        // Jawaban naratif TIDAK dikirim ke server — seluruh analisis
        // naratif/AI tetap berjalan di browser (lihat summary-engine.js,
        // ai-adapter.js). Didefinisikan di js/screening-submit.js (dimuat
        // sebelum file ini).
        if (window.AtlasBackend && typeof window.AtlasBackend.submitScreening === 'function') {
            window.AtlasBackend.submitScreening(currentTest, overallPercent, overallLevel);
        }

        document.getElementById('hasil').scrollIntoView({ behavior: 'smooth' });
    });

    /* ---------- Render Results (SELALU BILINGUAL ID + EN) ---------- */
    // `data` diterima sebagai parameter eksplisit (bukan variabel global)
    // agar bagian "Jawaban Naratif" tidak ReferenceError.
    // Seluruh panel hasil ditampilkan dalam Bahasa Indonesia & English
    // sekaligus, terlepas dari toggle bahasa currentLang.
    function renderResults(data, results, totalScore, totalMax, overallPercent, overallLevel) {
        const container = document.getElementById('resultsContainer');

        const summaryHtml = `
            <div class="results-overview">
                <div class="result-summary">
                    <div class="result-summary-label">${bi('Total Skor', 'Total Score')}</div>
                    <div class="result-summary-value">${totalScore}</div>
                    <div class="result-summary-desc">${bi('dari', 'of')} ${totalMax}</div>
                </div>
                <div class="result-summary">
                    <div class="result-summary-label">${bi('Persentase', 'Percentage')}</div>
                    <div class="result-summary-value">${Math.round(overallPercent)}%</div>
                    <div class="result-summary-desc">${bi('skor keseluruhan', 'overall score')}</div>
                </div>
                <div class="result-summary">
                    <div class="result-summary-label">${bi('Dimensi Dinilai', 'Dimensions Assessed')}</div>
                    <div class="result-summary-value">${results.length}</div>
                    <div class="result-summary-desc">${bi('bagian', 'sections')}</div>
                </div>
            </div>

            <div class="overall-result">
                <div class="overall-label">${bi('Tingkat Gangguan Keseluruhan', 'Overall Impairment Level')}</div>
                <div class="overall-value ${overallLevel.levelClass}">${bi(overallLevel.label.id, overallLevel.label.en)}</div>
                <div class="overall-desc">${biBlock(overallLevel.interpretation.id, overallLevel.interpretation.en)}</div>
            </div>`;

        const dimensionsHtml = `
            <h3 class="subsection-title" style="margin-top:2.5rem">${bi('Rincian Per Dimensi', 'Breakdown by Dimension')}</h3>
            <div class="dimension-results">
                ${results
                    .map(
                        (r) => `
                    <div class="dimension-result">
                        <div class="dimension-header">
                            <div class="dimension-name">${r.id}. ${bi(r.title.id, r.title.en)}</div>
                            <div class="dimension-score ${r.level.levelClass}">${bi(r.level.label.id, r.level.label.en)} · ${Math.round(r.percent)}%</div>
                        </div>
                        <div class="dimension-bar">
                            <div class="dimension-bar-fill ${r.level.levelClass}" style="width: ${r.percent}%"></div>
                        </div>
                        <div class="dimension-interpretation">
                            ${r.score} / ${r.max} ${bi('poin', 'points')}
                        </div>
                    </div>`
                    )
                    .join('')}
            </div>`;

        // --- Analisis Naratif per jawaban (nlp-engine.js) ---
        // Dihitung SEKALI per section lalu dipakai ulang untuk ringkasan
        // keseluruhan di bawah (hindari memanggil analyzeQualitative() 2x
        // untuk jawaban yang sama).
        const sectionAnalyses = data.sections.map((s) => {
            const answer = userAnswers[currentTest].qualitative[s.id];
            if (!answer || !answer.trim()) return { section: s, answer: null, analysis: null };
            return { section: s, answer, analysis: window.AtlasNLPEngine.analyzeQualitative(answer) };
        });

        const qualitativeEntries = sectionAnalyses
            .filter((e) => e.analysis !== null)
            .map(({ section: s, answer, analysis }) => {
                const tagsHtml = analysis.tags && analysis.tags.length
                    ? `<div class="analysis-tags">${analysis.tags.map((t) => `<span class="analysis-tag">${bi(t.id, t.en)}</span>`).join('')}</div>`
                    : '';

                const evidenceHtml = analysis.evidence && analysis.evidence.length
                    ? `<div class="analysis-evidence">${analysis.evidence
                          .slice(0, 2)
                          .map(
                              (e) => `
                        <div class="evidence-item">◈ ${bi(e.axisLabel.id, e.axisLabel.en)} — “${escapeHtml(e.sentence)}”</div>`
                          )
                          .join('')}</div>`
                    : '';

                const reliabilityHtml = analysis.meta && typeof analysis.meta.reliability === 'number'
                    ? `<div class="reliability-note">◈ ${bi('Keandalan sinyal jawaban ini', "This answer's signal reliability")}: ${analysis.meta.reliability}%${
                          analysis.meta.reliability < 30
                              ? ` — ${bi('jawaban singkat, baca sebagai indikasi awal', 'brief answer, read as an early indication')}`
                              : ''
                      }</div>`
                    : '';

                return `
                    <div class="qualitative-entry">
                        <div class="qualitative-entry-title">${s.id}. ${bi(s.qualitative.id, s.qualitative.en)}</div>
                        <div class="qualitative-entry-content">
                            <div style="margin-bottom: 0.75rem; font-style: italic; color: var(--text-muted, #666); padding: 0.75rem; background: rgba(0,0,0,0.03); border-radius: 6px;">"${escapeHtml(answer)}"</div>
                            <div class="qualitative-analysis-box">
                                <strong>◈ ${bi('Analisa Naratif', 'Narrative Analysis')}:</strong>
                                <div style="font-weight: 600; margin: 0.5rem 0; color: var(--accent, #4a90e2);">${bi(analysis.theme.id, analysis.theme.en)}</div>
                                ${tagsHtml}
                                <div>${biBlock(analysis.interpretation.id, analysis.interpretation.en)}</div>
                                ${evidenceHtml}
                                ${reliabilityHtml}
                            </div>
                        </div>
                    </div>`;
            })
            .join('');

        // --- Ringkasan naratif keseluruhan (summary-engine.js) ---
        // quantContext memungkinkan summary-engine melakukan congruence check:
        // membandingkan pola naratif dengan skor kuantitatif yang baru dihitung
        // di calculateBtn (results, overallPercent, overallLevel).
        const allAnalyses = sectionAnalyses.filter((e) => e.analysis !== null).map((e) => e.analysis);
        const overallSummary = window.AtlasSummaryEngine.buildOverallSummary(allAnalyses, {
            overallPercent,
            overallLevel,
            results,
        });

        const overallQualitativeHtml = overallSummary
            ? `
            <div class="overall-qualitative-insight">
                <h3 style="margin-top: 0;">◈ ${bi('Wawasan Naratif Keseluruhan', 'Overall Narrative Insight')}</h3>
                ${renderCompositeRiskGauge(overallSummary.compositeRisk)}
                <div style="font-weight: 600; margin-bottom: 0.5rem; color: var(--accent, #4a90e2);">${bi(overallSummary.theme.id, overallSummary.theme.en)}</div>
                ${
                    overallSummary.tags && overallSummary.tags.length
                        ? `<div class="analysis-tags">${overallSummary.tags.map((t) => `<span class="analysis-tag">${bi(t.id, t.en)}</span>`).join('')}</div>`
                        : ''
                }
                <div>${biBlock(overallSummary.interpretation.id, overallSummary.interpretation.en)}</div>
                ${renderAddictionProfile(overallSummary.addictionComponents)}
                ${renderAxisRadar(overallSummary.axisTotals, (window.AtlasNLPEngine && window.AtlasNLPEngine.AXIS_LABELS) || {})}
                ${renderHistoryTrend(currentTest, overallSummary.compositeRisk.score)}
                <div class="analysis-confidence">◈ ${bi('Tingkat keyakinan analisis', 'Analysis confidence')}: ${bi(overallSummary.confidence.id, overallSummary.confidence.en)}${
                    overallSummary.reliabilityAvg !== null
                        ? ` · ${bi('rata-rata keandalan jawaban', 'average answer reliability')}: ${overallSummary.reliabilityAvg}%`
                        : ''
                }</div>
            </div>`
            : '';

        const qualitativeHtml = `
            <h3 class="subsection-title" style="margin-top:2.5rem">${bi('Analisa Jawaban Naratif', 'Narrative Answers Analysis')}</h3>
            <div class="qualitative-summary">
                ${overallQualitativeHtml}
                ${
                    qualitativeEntries ||
                    `<p style="color: var(--text-muted); font-style: italic;">${bi(
                        'Belum ada jawaban naratif yang diisi. Jawaban naratif sangat membantu untuk memberikan konteks mendalam pada skor kuantitatif Anda.',
                        'No narrative answers have been filled in. Narrative answers are highly helpful to provide deep context to your quantitative scores.'
                    )}</p>`
                }
            </div>`;

        const noteHtml = `
            <div class="note" style="margin-top: 2rem;">
                <strong>◈</strong>
                ${biBlock(
                    'Hasil ini bersifat reflektif dan bukan diagnosis klinis. Jika Anda merasa membutuhkan dukungan lebih lanjut, silakan berkonsultasi dengan psikolog atau psikiater berlisensi.',
                    'These results are reflective and not a clinical diagnosis. If you feel you need further support, please consult a licensed psychologist or psychiatrist.'
                )}
            </div>`;

        // --- Panel konsultasi AI (agent-bridge.js -> Node proxy ->
        // FastAPI -> Qwen/Ollama). Dirender kosong dulu (placeholder),
        // lalu diisi async oleh initAgentChatPanel() di bawah supaya
        // renderResults() sendiri tidak perlu jadi async.
        const agentChatHtml = overallSummary
            ? `
            <div class="agent-chat-panel" id="agentChatPanel">
                <div class="agent-chat-header">
                    <span>◈ ${bi('Konsultasi Singkat dengan Atlas Jiwa AI', 'Brief Consultation with Atlas Jiwa AI')}</span>
                    <span class="agent-chat-status" id="agentChatStatus">${bi('Menyiapkan sesi…', 'Preparing session…')}</span>
                </div>
                <div class="agent-chat-messages" id="agentChatMessages"></div>
                <div class="agent-chat-input-row">
                    <input type="text" id="agentChatInput" placeholder="${bi('Tulis pesan Anda…', 'Type your message…')}" disabled />
                    <button type="button" id="agentChatSendBtn" disabled>${bi('Kirim', 'Send')}</button>
                </div>
            </div>`
            : '';

        container.innerHTML = summaryHtml + dimensionsHtml + qualitativeHtml + agentChatHtml + noteHtml;

        if (overallSummary) {
            initAgentChatPanel(overallSummary, currentTest);
        }
    }

    /* ---------- Panel Konsultasi AI (agent-bridge.js) ---------- */
    // sessionId disimpan per render hasil (bukan variabel global lintas
    // test) supaya tiap kali "Hitung Hasil" dipanggil ulang, sesi
    // konsultasi baru yang relevan dengan hasil TERBARU yang dibuka.
    let agentChatSessionId = null;

    function appendAgentChatBubble(role, text, options) {
        const opts = options || {};
        const messagesEl = document.getElementById('agentChatMessages');
        if (!messagesEl) return null;
        const bubble = document.createElement('div');
        bubble.className = `agent-chat-bubble ${role}${opts.crisis ? ' crisis' : ''}${opts.pending ? ' pending' : ''}`;
        bubble.textContent = text;
        messagesEl.appendChild(bubble);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return bubble;
    }

    function setAgentChatCrisisBanner(show) {
        const panel = document.getElementById('agentChatPanel');
        if (!panel) return;
        const existing = panel.querySelector('.agent-chat-crisis-banner');
        if (show && !existing) {
            const banner = document.createElement('div');
            banner.className = 'agent-chat-crisis-banner';
            banner.textContent = bi(
                '⚠ Jika Anda merasa dalam bahaya, segera hubungi layanan darurat atau profesional kesehatan mental tepercaya di lokasi Anda.',
                '⚠ If you feel you are in danger, please contact emergency services or a trusted mental health professional in your area right away.'
            );
            const messagesEl = document.getElementById('agentChatMessages');
            panel.insertBefore(banner, messagesEl);
        }
    }

    async function initAgentChatPanel(overallSummary, screeningType) {
        const statusEl = document.getElementById('agentChatStatus');
        const inputEl = document.getElementById('agentChatInput');
        const sendBtn = document.getElementById('agentChatSendBtn');
        if (!statusEl || !window.AtlasAgent) return;

        try {
            const result = await window.AtlasAgent.initSessionFromSummary(overallSummary, screeningType, currentLang);
            agentChatSessionId = result.sessionId;
            statusEl.textContent = bi('Siap', 'Ready');
            appendAgentChatBubble('assistant', result.response, { crisis: result.isCrisis });
            if (result.isCrisis) setAgentChatCrisisBanner(true);
            inputEl.disabled = false;
            sendBtn.disabled = false;
        } catch (err) {
            console.error('[ATLAS] Gagal membuka sesi konsultasi AI:', err);
            statusEl.textContent = bi('Tidak tersedia saat ini', 'Currently unavailable');
            appendAgentChatBubble(
                'assistant',
                bi(
                    'Maaf, konsultasi AI sedang tidak dapat diakses. Hasil screening Anda di atas tetap tersimpan.',
                    'Sorry, the AI consultation is currently unavailable. Your screening results above are still saved.'
                )
            );
        }

        async function handleSend() {
            const text = inputEl.value.trim();
            if (!text) return;
            inputEl.value = '';
            inputEl.disabled = true;
            sendBtn.disabled = true;

            appendAgentChatBubble('user', text);
            const pendingBubble = appendAgentChatBubble('assistant', bi('Mengetik…', 'Typing…'), { pending: true });

            try {
                const result = await window.AtlasAgent.sendMessage(agentChatSessionId, text, currentLang);
                agentChatSessionId = result.sessionId;
                if (pendingBubble) pendingBubble.remove();
                appendAgentChatBubble('assistant', result.response, { crisis: result.isCrisis });
                if (result.isCrisis) setAgentChatCrisisBanner(true);
            } catch (err) {
                console.error('[ATLAS] Gagal mengirim pesan ke agent:', err);
                if (pendingBubble) pendingBubble.remove();
                appendAgentChatBubble(
                    'assistant',
                    bi(
                        'Maaf, terjadi kendala saat menghubungi konsultasi AI. Coba lagi sebentar lagi.',
                        'Sorry, there was a problem reaching the AI consultation. Please try again shortly.'
                    )
                );
            } finally {
                inputEl.disabled = false;
                sendBtn.disabled = false;
                inputEl.focus();
            }
        }

        sendBtn.addEventListener('click', handleSend);
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleSend();
        });
    }

    /* ---------- Reset Button ---------- */
    document.getElementById('resetBtn').addEventListener('click', () => {
        const confirmMessage =
            currentLang === 'id'
                ? 'Apakah Anda yakin ingin mereset semua jawaban? Tindakan ini tidak dapat dibatalkan.'
                : 'Are you sure you want to reset all answers? This action cannot be undone.';

        if (!confirm(confirmMessage)) return;

        userAnswers[currentTest] = { quantitative: {}, qualitative: {} };
        localStorage.removeItem(STORAGE_KEYS.answers);
        renderScreening(currentTest);
        renderResultsPlaceholder();
    });

    /* ---------- Save Button ---------- */
    document.getElementById('saveBtn').addEventListener('click', () => {
        saveToStorage();
        alert(currentLang === 'id' ? 'Progress Anda telah disimpan di perangkat ini.' : 'Your progress has been saved on this device.');
    });

    /* ---------- Test Selector ---------- */
    document.querySelectorAll('.test-option').forEach((btn) => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.test-option').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            currentTest = btn.getAttribute('data-test');
            renderScreening(currentTest);
            renderResultsPlaceholder();
        });
    });

    /* ---------- Mobile Nav ---------- */
    const navToggle = document.getElementById('navToggle');
    const navList = document.getElementById('navList');

    if (navToggle && navList) {
        navToggle.addEventListener('click', () => navList.classList.toggle('open'));
        navList.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => navList.classList.remove('open'));
        });
    }

    /* ---------- Page Progress Bar ---------- */
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        window.addEventListener(
            'scroll',
            () => {
                const scrollTop = window.scrollY;
                const docHeight = document.documentElement.scrollHeight - window.innerHeight;
                const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
                progressBar.style.width = `${progress}%`;
            },
            { passive: true }
        );
    }

    /* ---------- Smooth Reveal ---------- */
    const sections = document.querySelectorAll('.section');
    if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver(
            (entries, obs) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('is-visible');
                        obs.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.05, rootMargin: '0px 0px -60px 0px' }
        );

        sections.forEach((section) => {
            const rect = section.getBoundingClientRect();
            const inView = rect.top < window.innerHeight && rect.bottom > 0;
            if (inView) {
                section.classList.add('is-visible');
            } else {
                observer.observe(section);
            }
        });
    } else {
        sections.forEach((section) => section.classList.add('is-visible'));
    }

    /* ---------- Initial Render ---------- */
    applyLanguage(currentLang);
    console.log('[ATLAS] Screening Test initialized with Qualitative NLP Engine');
});
