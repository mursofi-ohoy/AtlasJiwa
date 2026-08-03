/* =========================================
   ATLAS JIWA — Keyword Dictionary v3
   Kamus kata kunci psikologis multi-axis (ID & EN), dengan bobot
   per istilah, dipakai oleh nlp-engine.js.

   PERUBAHAN UTAMA v2 -> v3:
   1. Menambah 4 axis baru yang memetakan ke "Six-Component Model
      of Addiction" (Griffiths, 2005) — kerangka yang lazim dipakai
      untuk kecanduan perilaku (behavioral addiction) seperti
      doomscrolling & game online, bukan hanya kecanduan zat:
        - toleranceEscalation (tolerance)   : butuh durasi/porsi
          makin besar untuk merasa "cukup"
        - withdrawalSymptoms (withdrawal)   : gelisah/uring-uringan
          saat tidak bisa mengakses perilaku tsb
        - escapism (mood modification)      : dipakai sebagai
          pelarian/regulasi mood
        - relapsePattern (relapse)          : siklus berhenti-gagal
          yang berulang
      Axis lama (distress, lossOfControl, dst.) sudah mewakili
      komponen "salience" & "conflict" dari model yang sama.
   2. Menambah CLAUSE_BOUNDARIES: token yang memotong "jangkauan"
      negasi supaya "saya tidak apa-apa, tapi cemas kalau ketinggalan
      info" tidak salah dibaca sebagai "cemas" ternegasi.
   3. Menambah AXIS_RISK_POLARITY: bobot arah tiap axis terhadap
      indeks risiko komposit (axis protektif bernilai negatif),
      dipakai summary-engine.js untuk menghitung skor gabungan
      kualitatif+kuantitatif.
   4. Memperluas istilah tiap axis (termasuk ragam santai) supaya
      cakupan deteksi lebih representatif.

   PERUBAHAN v3 -> v4:
   5. Menambah AXIS_SYNERGY_PAIRS: pasangan axis yang jika muncul dalam
      SATU kalimat yang sama menandakan pola gabungan yang lebih
      bermakna secara klinis (mis. tolerance + withdrawal bersamaan).
      Dipakai nlp-engine.js untuk menambah "synergy bonus" ke skor
      risiko kualitatif, bukan cuma menjumlahkan axis secara independen.

   axes:
   - distress            : distres emosional (cemas, panik, sedih, dst)
   - lossOfControl        : kegagalan mengendalikan perilaku
   - minimization         : meminimalkan/menyangkal dampak
   - selfAwareness        : kesadaran diri & regulasi sehat
   - socialWithdrawal     : penarikan diri secara sosial
   - physicalSymptoms     : gejala fisik yang menyertai
   - copingEfficacy       : strategi/upaya penanganan yang disebutkan
   - externalAttribution  : menyalahkan faktor luar
   - internalAttribution  : mengambil tanggung jawab pribadi
   - chronicity           : penanda pola berlangsung lama/berulang
   - urgency              : penanda kebutuhan bantuan yang mendesak
   - toleranceEscalation  : butuh "dosis"/durasi makin besar (tolerance)
   - withdrawalSymptoms   : gelisah saat tidak bisa mengakses (withdrawal)
   - escapism             : dipakai sebagai pelarian (mood modification)
   - relapsePattern       : siklus berhenti-gagal berulang (relapse)

   negators / intensifiers / diminishers / clauseBoundaries dipakai
   nlp-engine.js untuk membaca konteks di sekitar sebuah kecocokan
   kata kunci sebelum ikut dihitung.
   ========================================= */

(function (global) {
    'use strict';

    const AXES = {
        distress: [
            'cemas', 'gelisah', 'stres', 'stress', 'marah', 'frustasi', 'kecewa', 'sedih',
            ['hampa', 2], ['kosong', 2], ['panik', 2], 'bersalah', 'malu', 'takut', 'khawatir',
            'lelah', ['putus asa', 2], 'brain fog', 'overwhelmed', 'meledak-ledak', 'cemas berlebihan',
            'anxious', 'restless', 'angry', 'frustrated', 'disappointed', 'sad', ['empty', 2],
            ['panicked', 2], 'guilty', 'ashamed', 'afraid', 'worried', 'tired', ['hopeless', 2]
        ],
        lossOfControl: [
            ['tidak bisa', 2], ['gak bisa', 2], ['nggak bisa', 2], 'gagal', 'susah', 'sulit',
            ['kecanduan', 2], 'bahaya', 'buruk', 'menunda', 'mengabaikan', 'hilang kendali',
            'kalah', 'ulang', ['otomatis', 2], 'tidak berdaya', 'di luar kendali', 'kompulsif',
            'tanpa sadar', ['keasyikan', 1.5], 'lupa waktu',
            ["can't", 2], 'failed', 'hard', 'difficult', ['addicted', 2], 'dangerous', 'bad',
            'procrastinate', 'neglect', 'losing control', ['automatic', 2], 'powerless',
            'out of control', 'compulsive', 'without realizing', ['lose track of time', 1.5]
        ],
        minimization: [
            'biasa saja', ['tidak pernah', 1], ['gak pernah', 1], ['nggak pernah', 1],
            ['tidak ada', 1], 'normal saja', 'nggak apa-apa', 'gak masalah', 'nggak masalah',
            'tidak masalah', 'wajar kok', 'orang lain juga begitu', 'cuma sedikit', 'gak separah itu',
            'fine', 'nothing', 'not at all', 'just normal', "it's fine", 'no big deal',
            'everyone does it', 'not a problem', "it's not that bad"
        ],
        selfAwareness: [
            'sadar', 'terkontrol', 'bisa mengatur', ['berhasil', 1.5], ['berhenti', 1.5],
            'sehat', 'baik', 'teratur', 'disiplin', 'mengerti', 'paham', 'berkurang',
            ['mengatasi', 1.5], 'batasan', 'usaha', 'introspeksi', 'refleksi', 'evaluasi diri',
            'aware', 'in control', ['succeeded', 1.5], ['stopped', 1.5], 'healthy', 'regular',
            'disciplined', 'understand', 'reduced', ['overcome', 1.5], 'boundary', 'effort',
            'trying', 'self-reflection'
        ],
        socialWithdrawal: [
            'menghindar', 'menjauh', 'sendirian', 'kesepian', 'menutup diri', 'isolasi',
            'mengisolasi diri', 'malas ketemu orang', 'tidak mau keluar', 'menarik diri',
            'avoid people', 'withdraw', 'isolate', 'isolating myself', ['lonely', 1.5], 'alone',
            'distant from friends', 'push people away', "don't want to see anyone"
        ],
        physicalSymptoms: [
            'sakit kepala', 'pusing', 'mata lelah', 'mata perih', 'insomnia', 'susah tidur',
            'nafsu makan', 'jantung berdebar', 'sesak', 'tegang', 'sakit leher', 'sakit punggung',
            'mual', 'kelelahan fisik', 'begadang', 'kurang tidur',
            'headache', 'dizzy', 'eye strain', 'trouble sleeping', 'appetite', 'heart racing',
            'tense', 'neck pain', 'back pain', 'nauseous', 'physically exhausted', 'staying up late'
        ],
        copingEfficacy: [
            'strategi', 'jadwal', 'batasan waktu', 'olahraga', 'meditasi', 'journaling',
            'menulis jurnal', 'dukungan teman', 'terapi', 'konseling', 'app blocker',
            'detoks digital', 'puasa media sosial', 'me time', 'curhat', 'grayscale mode',
            'strategy', 'schedule', 'time limit', 'exercise', 'meditation', 'journaling',
            'support from friends', 'therapy', 'counseling', 'digital detox', 'talking to someone'
        ],
        externalAttribution: [
            'karena pekerjaan', 'karena tuntutan', 'karena orang lain', 'karena teman',
            'karena lingkungan', 'bukan salah saya', 'situasi memaksa', 'terpaksa',
            'karena keadaan', 'gara-gara',
            'because of work', 'because of others', 'because of my environment', 'not my fault',
            'forced by the situation', 'everyone else does it too', 'because of the situation'
        ],
        internalAttribution: [
            'salah saya', 'tanggung jawab saya', 'saya yang memilih', 'ini pilihan saya',
            'saya yang harus berubah', 'saya sadar ini kebiasaan saya',
            'my fault', 'my responsibility', 'my choice', 'i chose', 'i own this',
            'i need to change', 'i am responsible'
        ],
        chronicity: [
            'selalu', 'setiap hari', 'terus-menerus', 'terus menerus', 'bertahun-tahun',
            'sejak lama', 'sejak kecil', 'sudah lama', 'sudah bertahun', 'dari dulu',
            'seumur hidup', 'sudah jadi kebiasaan',
            'always', 'every day', 'constantly', 'for years', 'since i was young',
            'for a long time', 'as long as i remember', "it's become a habit"
        ],
        urgency: [
            'sudah tidak tahan', 'harus segera', 'semakin parah', 'makin buruk', 'makin parah',
            'butuh bantuan sekarang', 'tidak tahu harus bagaimana lagi', 'sudah di titik lelah',
            "can't take it anymore", 'need help now', 'getting worse', "don't know what to do anymore",
            'at my breaking point', 'urgently need'
        ],
        toleranceEscalation: [
            'makin lama makin banyak', 'durasinya terus bertambah', ['butuh lebih lama', 1.5],
            'dulu sebentar sekarang berjam-jam', 'tidak puas kalau cuma sebentar',
            'porsinya nambah terus', 'perlu lebih sering', ['sudah tidak cukup', 1.5], 'makin nambah durasinya',
            'needing more and more', ['takes longer than it used to', 1.5], 'never feels like enough',
            'used to be quick now it takes hours', 'not satisfied with a short session',
            'increasing amount needed', 'needing it more often', ['not enough anymore', 1.5]
        ],
        withdrawalSymptoms: [
            'gelisah kalau tidak', ['marah kalau diganggu', 1.5], 'uring-uringan tanpa ponsel',
            'cemas kalau baterai habis', 'panik kalau lupa bawa ponsel', 'tidak tenang kalau offline',
            ['emosi tidak stabil kalau berhenti', 1.5], 'gugup tanpa koneksi internet', 'kesal kalau disuruh berhenti',
            'restless without it', ['irritable when interrupted', 1.5], 'anxious when the battery dies',
            'uneasy when offline', 'panicky without my phone', 'on edge without internet',
            ['moody when i stop', 1.5], 'annoyed when told to stop'
        ],
        escapism: [
            'pelarian dari masalah', 'biar tidak mikir masalah', 'supaya lupa sejenak',
            'menghindari kenyataan', 'daripada menghadapi masalah', ['lari dari kenyataan', 1.5],
            'biar teralihkan', 'menghibur diri dari stres', 'biar gak mikir macam-macam',
            'escape from my problems', 'to avoid thinking about it', 'to forget for a while',
            'avoiding reality', ['running from reality', 1.5], 'to distract myself',
            'numbing myself from stress', 'to not deal with it'
        ],
        relapsePattern: [
            ['sudah berkali-kali coba berhenti', 2], 'gagal lagi setelah berhenti',
            'kembali lagi walau sudah janji', ['siklus berulang', 1.5], 'selalu balik ke kebiasaan lama',
            'usaha berhenti selalu gagal', 'tidak bertahan lama saat berhenti', 'niat berhenti tidak pernah bertahan',
            ['tried to quit many times', 2], 'fail again after quitting',
            'go back despite promising myself', ['recurring cycle', 1.5], 'always return to the old habit',
            'attempts to stop always fail', "can't stay stopped for long", 'my resolve never lasts'
        ]
    };

    const NEGATORS = [
        'tidak', 'gak', 'nggak', 'bukan', 'jangan', 'belum',
        'no', 'not', "don't", "doesn't", "didn't", 'never', 'without'
    ];

    const INTENSIFIERS = [
        'sangat', 'sekali', 'banget', 'terlalu', 'amat', 'begitu', 'luar biasa', 'sungguh',
        'very', 'extremely', 'really', 'so', 'too', 'incredibly', 'utterly'
    ];

    const DIMINISHERS = [
        'sedikit', 'agak', 'kadang', 'kadang-kadang', 'sesekali', 'jarang', 'nyaris tidak',
        'a little', 'somewhat', 'sometimes', 'occasionally', 'rarely', 'slightly', 'barely'
    ];

    // Token yang memotong jangkauan negasi: jika salah satu muncul di ANTARA
    // negator dan istilah target, negasi dianggap tidak berlaku lagi untuk
    // istilah tsb (mis. "tidak apa-apa, tapi cemas" -> "cemas" TIDAK ternegasi).
    const CLAUSE_BOUNDARIES = [
        'tapi', 'tetapi', 'namun', 'meski', 'meskipun', 'walau', 'walaupun',
        'karena', 'sebab', 'sehingga', 'akibatnya', 'padahal', 'hanya saja',
        'but', 'however', 'although', 'even though', 'because', 'so that', 'yet'
    ];

    // Pasangan axis yang, jika muncul BERSAMAAN dalam kalimat yang sama,
    // menandakan pola gabungan yang secara klinis lebih bermakna daripada
    // sekadar menjumlahkan skor axis masing-masing (mis. tolerance +
    // withdrawal bersamaan = inti dari kecanduan perilaku, bukan kebetulan).
    // Dipakai nlp-engine.js (computeSynergy) untuk menambah bobot ekstra
    // ("synergy bonus") ke indeks risiko kualitatif, dan untuk menghasilkan
    // klausa interpretasi yang lebih spesifik/berdasar teori.
    const AXIS_SYNERGY_PAIRS = [
        {
            a: 'toleranceEscalation', b: 'withdrawalSymptoms', weight: 1.5,
            id: 'Eskalasi toleransi dan gejala withdrawal muncul dalam kalimat yang sama',
            en: 'Tolerance escalation and withdrawal symptoms co-occurring in the same sentence'
        },
        {
            a: 'lossOfControl', b: 'distress', weight: 1.2,
            id: 'Kehilangan kendali disertai distres emosional dalam kalimat yang sama',
            en: 'Loss of control paired with emotional distress in the same sentence'
        },
        {
            a: 'urgency', b: 'lossOfControl', weight: 1.4,
            id: 'Penanda urgensi disertai kehilangan kendali dalam kalimat yang sama',
            en: 'Urgency markers paired with loss of control in the same sentence'
        },
        {
            a: 'relapsePattern', b: 'minimization', weight: 1.3,
            id: 'Pola relaps berulang disertai kecenderungan meminimalkan dampaknya',
            en: 'A recurring relapse pattern paired with a tendency to minimize its impact'
        },
        {
            a: 'escapism', b: 'socialWithdrawal', weight: 1.0,
            id: 'Pelarian dari masalah disertai penarikan diri secara sosial',
            en: 'Escapism paired with social withdrawal'
        },
        {
            a: 'chronicity', b: 'toleranceEscalation', weight: 1.1,
            id: 'Pola yang sudah berlangsung lama disertai eskalasi toleransi',
            en: 'A long-standing pattern paired with tolerance escalation'
        },
        {
            a: 'physicalSymptoms', b: 'withdrawalSymptoms', weight: 1.0,
            id: 'Gejala fisik disertai gejala withdrawal dalam kalimat yang sama',
            en: 'Physical symptoms paired with withdrawal symptoms in the same sentence'
        }
    ];

    // Polaritas & bobot tiap axis terhadap indeks risiko komposit.
    // Positif = menambah risiko, negatif = protektif/menurunkan risiko.
    // Dipakai summary-engine.js saat menggabungkan sinyal kualitatif
    // dengan skor kuantitatif menjadi satu indeks risiko gabungan.
    const AXIS_RISK_POLARITY = {
        distress: 1.0,
        lossOfControl: 1.2,
        minimization: 0.5, // tetap berkontribusi ke risiko sebagai potensi "blind spot"
        selfAwareness: -1.1,
        socialWithdrawal: 1.0,
        physicalSymptoms: 0.8,
        copingEfficacy: -1.2,
        externalAttribution: 0.3,
        internalAttribution: -0.3,
        chronicity: 0.7,
        urgency: 2.0,
        toleranceEscalation: 1.3,
        withdrawalSymptoms: 1.3,
        escapism: 0.9,
        relapsePattern: 1.4
    };

    global.AtlasKeywordDictionary = {
        axes: AXES,
        negators: NEGATORS,
        intensifiers: INTENSIFIERS,
        diminishers: DIMINISHERS,
        clauseBoundaries: CLAUSE_BOUNDARIES,
        axisRiskPolarity: AXIS_RISK_POLARITY,
        axisSynergyPairs: AXIS_SYNERGY_PAIRS
    };
})(window);
