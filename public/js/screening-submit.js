/* =========================================
   ATLAS JIWA — Screening Submit (Backend Bridge)
   -----------------------------------------------------------
   Menjembatani hasil screening (yang tadinya HANYA disimpan ke
   localStorage oleh script.js) supaya juga dikirim & disimpan
   permanen ke CockroachDB lewat REST API backend:
     POST /api/screening  (lihat server/routes/screening.routes.js)

   PERUBAHAN ARSITEKTUR: versi sebelumnya mengirim SATU baris per
   pertanyaan, termasuk teks jawaban naratif/kualitatif pengguna
   (`answer: String(narrative)`). Backend TIDAK BOLEH lagi menerima
   atau menyimpan narasi — hanya skor kuantitatif komposit + tingkat
   risiko. Sekarang hanya SATU baris ringkasan yang dikirim per sesi
   screening:
     { question_number: 0, question: '<label ringkasan>',
       answer: '<risk level>', score: <skor komposit 0-100> }

   Kolom `question`/`answer` di tabel screening_results SENGAJA tidak
   diganti namanya (skema & admin.js tidak disentuh, sesuai batasan
   "jangan ubah UI/UX") — hanya isinya yang tidak lagi memuat narasi
   pengguna, cuma label ringkasan & tingkat risiko.

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
     * Membentuk SATU baris ringkasan skor kuantitatif siap simpan,
     * sesuai bentuk yang diharapkan server/routes/screening.routes.js
     * -> POST /: { screening_type, answers: [{ question_number,
     * question, answer, score }] }. Tidak ada teks jawaban naratif
     * yang diikutsertakan sama sekali.
     *
     * @param {string} screeningType  contoh: 'scrolling' | 'gaming'
     * @param {number} overallPercent skor kuantitatif komposit 0-100
     * @param {{label: {id: string, en: string}}} overallLevel  hasil getLevel() di script.js
     */
    function buildPayload(screeningType, overallPercent, overallLevel) {
        if (typeof overallPercent !== 'number' || Number.isNaN(overallPercent)) return [];

        const riskLabel = (overallLevel && overallLevel.label && overallLevel.label.id) || '-';

        return [
            {
                question_number: 0,
                question: `Ringkasan skor — ${screeningType}`,
                answer: riskLabel,
                score: Math.round(overallPercent),
            },
        ];
    }

    /**
     * Kirim ringkasan skor satu sesi screening ke backend.
     * Dipanggil dari script.js setelah tombol "Hitung Hasil" diklik.
     * Gagal kirim ke server TIDAK menghentikan alur UI — hasil tetap
     * tampil & tersimpan di localStorage seperti biasa, hanya dicatat
     * di console sebagai peringatan.
     *
     * @param {string} screeningType
     * @param {number} overallPercent
     * @param {object} overallLevel
     */
    async function submitScreening(screeningType, overallPercent, overallLevel) {
        const payload = buildPayload(screeningType, overallPercent, overallLevel);
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

            console.log('[ATLAS] Skor ringkasan screening tersimpan ke server.');
        } catch (err) {
            console.error('[ATLAS] Error jaringan saat mengirim hasil screening:', err);
        }
    }

    global.AtlasBackend = { submitScreening, buildPayload };
})(window);
