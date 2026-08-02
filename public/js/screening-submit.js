/* =========================================
   ATLAS JIWA — Screening Submit (Backend Bridge)
   Menjembatani hasil screening (yang tadinya HANYA disimpan ke
   localStorage oleh script.js) supaya juga dikirim & disimpan
   permanen ke PostgreSQL lewat REST API backend:
     POST /api/screening  (lihat server/routes/screening.routes.js)

   Dipanggil oleh script.js di dalam handler tombol "Hitung Hasil",
   lewat window.AtlasBackend.submitScreening(...).

   URUTAN MUAT SCRIPT (wajib): file ini dimuat SEBELUM script.js,
   supaya window.AtlasBackend sudah tersedia saat script.js berjalan.

   Catatan keamanan:
   - fetch() memakai credentials: 'include' supaya cookie sesi
     (httpOnly, di-set oleh POST /api/auth/login) ikut terkirim.
   - Tidak ada kredensial/token yang disimpan atau diproses di sisi
     frontend — server yang memvalidasi sesi lewat cookie tsb.
   ========================================= */

(function (global) {
    'use strict';

    const API_BASE = '/api';

    /**
     * Meratakan jawaban satu sesi screening (satu `screening_type`)
     * menjadi array baris siap simpan, sesuai bentuk yang diharapkan
     * server/routes/screening.routes.js -> POST /:
     *   { screening_type, answers: [{ question_number, question, answer, score }, ...] }
     *
     * @param {string} screeningType  contoh: 'scrolling' | 'gaming'
     * @param {object} data           screeningData[screeningType] (lihat script.js)
     * @param {object} answers        userAnswers[screeningType] -> { quantitative, qualitative }
     */
    function buildPayload(screeningType, data, answers) {
        const rows = [];
        let runningNumber = 1;

        (data.sections || []).forEach((section) => {
            const quantAnswers = (answers.quantitative && answers.quantitative[section.id]) || {};

            (section.questions || []).forEach((question, index) => {
                const rawScore = quantAnswers[index];
                if (rawScore === undefined || rawScore === null) return; // pertanyaan belum dijawab

                rows.push({
                    question_number: runningNumber++,
                    question: `[${section.id}] ${question.id}`, // teks Bahasa Indonesia sebagai acuan utama
                    answer: String(rawScore),
                    score: Number(rawScore) || 0,
                });
            });

            const narrative = answers.qualitative && answers.qualitative[section.id];
            if (narrative && String(narrative).trim() !== '') {
                rows.push({
                    question_number: 0, // 0 menandakan baris jawaban naratif/kualitatif, bukan skor Likert
                    question: `[${section.id}] ${(section.qualitative && section.qualitative.id) || 'Jawaban naratif'}`,
                    answer: String(narrative),
                    score: 0,
                });
            }
        });

        return rows;
    }

    /**
     * Kirim hasil satu sesi screening ke backend.
     * Dipanggil dari script.js setelah tombol "Hitung Hasil" diklik.
     * Gagal kirim ke server TIDAK menghentikan alur UI — hasil tetap
     * tampil & tersimpan di localStorage seperti biasa, hanya dicatat
     * di console sebagai peringatan.
     */
    async function submitScreening(screeningType, data, answers) {
        const payload = buildPayload(screeningType, data, answers);
        if (payload.length === 0) return;

        try {
            const res = await fetch(`${API_BASE}/screening`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ screening_type: screeningType, answers: payload }),
            });

            if (res.status === 401) {
                console.warn('[ATLAS] Sesi tidak ditemukan/kedaluwarsa — hasil screening hanya tersimpan di perangkat ini (localStorage), tidak di server.');
                return;
            }

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                console.error('[ATLAS] Gagal menyimpan hasil screening ke server:', body.error || res.statusText);
                return;
            }

            console.log('[ATLAS] Hasil screening tersimpan ke server.');
        } catch (err) {
            console.error('[ATLAS] Error jaringan saat mengirim hasil screening:', err);
        }
    }

    global.AtlasBackend = { submitScreening, buildPayload };
})(window);
