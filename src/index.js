/* =========================================
   ATLAS JIWA — Cloudflare Worker Entry Point (src/index.js)

   [REVISI] Fitur "Konsultasi AI" (Gemini) SEKARANG berjalan LANGSUNG di
   Worker ini, TIDAK LAGI melalui proxy ke backend Railway
   (server/routes/gemini.routes.js -> gemini.service.js).

   Alasan revisi:
   POST /api/ai/consult sebelumnya di-proxy ke Railway. Railway
   memvalidasi request dengan middleware requireAuth (Express) yang
   TIDAK mengenali sesi JWT yang diterbitkan oleh Worker (Cloudflare D1
   auth), sehingga request selalu berakhir 401 walau user sudah login
   di sisi Worker.

   Solusinya: Worker sekarang memanggil Google Gemini REST API secara
   langsung menggunakan env.GEMINI_API_KEY, dan tetap memakai
   getAuthUser()/D1 (JWT_SECRET) yang SUDAH ADA untuk otorisasi —
   sistem auth Cloudflare D1 TIDAK diubah sama sekali. Tidak ada lagi
   fetch() keluar ke Railway di Worker ini.

       Browser --POST /api/ai/consult--> Worker --fetch--> Gemini API

   Worker ini menangani /api/auth/*, /api/screening (skor kuantitatif),
   /api/users/* untuk admin, dan sekarang juga /api/ai/consult (Gemini
   langsung).

   Catatan deploy:
   - Set secret Gemini di Worker (BUKAN di Railway lagi):
       wrangler secret put GEMINI_API_KEY
   - Opsional, override model (default "gemini-2.0-flash"):
       wrangler secret put GEMINI_MODEL
     atau tambahkan sebagai [vars] biasa di wrangler.toml.
   - Railway/Express untuk endpoint /api/ai/consult tidak lagi dipakai
     dan bisa dinonaktifkan/dihapus dari infra.
   ========================================= */

import { hashPassword, comparePassword, signToken, verifyToken } from './lib/crypto.js';
import {
    json,
    parseCookies,
    getSessionCookieHeader,
    getClearSessionCookieHeader,
    isValidEmail,
    isValidUsername,
    isValidPassword,
} from './lib/http.js';

function uuid() {
    return crypto.randomUUID();
}

function requireEnv(env, key) {
    const value = env[key];
    if (!value || String(value).length < 16) {
        throw new Error(`[Config] ${key} belum di-set di Worker (wrangler secret put ${key}), atau terlalu pendek.`);
    }
    return value;
}

async function getAuthUser(request, env) {
    const cookies = parseCookies(request);
    const token = cookies['atlas_session'];
    if (!token) return null;
    try {
        const secret = requireEnv(env, 'JWT_SECRET');
        return await verifyToken(token, secret);
    } catch (err) {
        return null;
    }
}

// ---------------------------------------------------------
// AUTH: POST /api/auth/register | login | logout, GET /api/auth/profile
// (TIDAK DIUBAH — tetap 100% memakai Cloudflare D1 + Web Crypto)
// ---------------------------------------------------------
async function handleRegister(request, env) {
    const body = await request.json().catch(() => ({}));
    const { full_name, email, username, password, confirm_password } = body || {};

    if (!full_name || !email || !username || !password || !confirm_password) {
        return json({ error: 'Semua field wajib diisi.' }, 400);
    }
    if (String(full_name).trim().length < 3) {
        return json({ error: 'Nama lengkap minimal 3 karakter.' }, 400);
    }
    if (!isValidEmail(email)) return json({ error: 'Format email tidak valid.' }, 400);
    if (!isValidUsername(username)) {
        return json({ error: 'Username harus 3-30 karakter: huruf, angka, titik, atau garis bawah.' }, 400);
    }
    if (!isValidPassword(password)) {
        return json({ error: 'Password minimal 8 karakter dan mengandung huruf serta angka.' }, 400);
    }
    if (password !== confirm_password) {
        return json({ error: 'Konfirmasi password tidak sama dengan password.' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedUsername = username.trim();

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ? OR username = ?')
        .bind(normalizedEmail, normalizedUsername)
        .first();
    if (existing) return json({ error: 'Email atau username sudah terdaftar.' }, 409);

    const { hash, salt } = await hashPassword(password);
    const id = uuid();

    await env.DB.prepare(
        `INSERT INTO users (id, full_name, email, username, password_hash, password_salt, role, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'active')`
    )
        .bind(id, full_name.trim(), normalizedEmail, normalizedUsername, hash, salt)
        .run();

    const user = await env.DB.prepare('SELECT id, full_name, email, username, role, created_at FROM users WHERE id = ?')
        .bind(id)
        .first();

    return json({ message: 'Registrasi berhasil. Silakan login.', user }, 201);
}

async function handleLogin(request, env) {
    const body = await request.json().catch(() => ({}));
    const { identifier, password } = body || {};
    if (!identifier || !password) {
        return json({ error: 'Email/username dan password wajib diisi.' }, 400);
    }

    const normalizedIdentifier = String(identifier).trim().toLowerCase();
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? OR username = ?')
        .bind(normalizedIdentifier, String(identifier).trim())
        .first();

    // Pesan generik disengaja: tidak membedakan "user tidak ada" vs
    // "password salah" supaya tidak membocorkan user enumeration.
    if (!user) return json({ error: 'Email/username atau password salah.' }, 401);
    if (user.status !== 'active') return json({ error: 'Akun ini tidak aktif. Hubungi admin.' }, 403);

    const passwordValid = await comparePassword(password, user.password_hash, user.password_salt);
    if (!passwordValid) return json({ error: 'Email/username atau password salah.' }, 401);

    await env.DB.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").bind(user.id).run();
    await env.DB.prepare('INSERT INTO login_logs (id, user_id) VALUES (?, ?)').bind(uuid(), user.id).run();

    const secret = requireEnv(env, 'JWT_SECRET');
    const token = await signToken({ id: user.id, username: user.username, role: user.role }, secret);

    return json(
        {
            message: 'Login berhasil.',
            user: {
                id: user.id,
                full_name: user.full_name,
                email: user.email,
                username: user.username,
                role: user.role,
            },
        },
        200,
        { 'Set-Cookie': getSessionCookieHeader(request, token) }
    );
}

async function handleLogout(request) {
    return json({ message: 'Logout berhasil.' }, 200, { 'Set-Cookie': getClearSessionCookieHeader(request) });
}

async function handleProfile(request, env) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);

    const user = await env.DB.prepare(
        'SELECT id, full_name, email, username, role, status, created_at, last_login FROM users WHERE id = ?'
    )
        .bind(authUser.id)
        .first();
    if (!user) return json({ error: 'Pengguna tidak ditemukan.' }, 404);
    return json({ user });
}

// ---------------------------------------------------------
// SCREENING: POST /api/screening, GET /api/screening/:userid, GET /api/screening
// (TIDAK DIUBAH)
// ---------------------------------------------------------
async function handleScreeningSubmit(request, env) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);

    const body = await request.json().catch(() => ({}));
    const { screening_type, answers } = body || {};

    if (!screening_type || typeof screening_type !== 'string') {
        return json({ error: 'screening_type wajib diisi.' }, 400);
    }
    if (!Array.isArray(answers) || answers.length === 0) {
        return json({ error: 'answers wajib berupa array dan tidak boleh kosong.' }, 400);
    }
    for (const a of answers) {
        if (typeof a.question !== 'string' || a.answer === undefined || a.answer === null) {
            return json({ error: 'Setiap item answers wajib memiliki question dan answer.' }, 400);
        }
    }

    // D1 belum punya multi-statement transaction eksplisit dari Workers
    // API biasa, jadi seluruh baris di-insert lewat env.DB.batch() —
    // dijalankan sebagai satu batch atomik oleh D1.
    try {
        const statements = answers.map((a) =>
            env.DB.prepare(
                `INSERT INTO screening_results (id, user_id, screening_type, question_number, question, answer, score)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                uuid(),
                authUser.id,
                screening_type,
                Number.isFinite(a.question_number) ? a.question_number : 0,
                a.question,
                String(a.answer),
                Number.isFinite(a.score) ? a.score : 0
            )
        );
        await env.DB.batch(statements);
    } catch (err) {
        console.error('[POST /api/screening] Gagal INSERT:', err.message);
        return json({ error: 'Gagal menyimpan hasil screening.' }, 500);
    }

    return json({ message: 'Hasil screening tersimpan.' }, 201);
}

async function handleScreeningByUser(request, env, userid) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);
    if (authUser.role !== 'admin' && authUser.id !== userid) {
        return json({ error: 'Anda hanya bisa melihat hasil screening milik sendiri.' }, 403);
    }
    const { results } = await env.DB.prepare(
        'SELECT * FROM screening_results WHERE user_id = ? ORDER BY created_at DESC'
    )
        .bind(userid)
        .all();
    return json({ results: results || [] });
}

async function handleScreeningAll(request, env) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);
    if (authUser.role !== 'admin') return json({ error: 'Akses ditolak. Halaman ini khusus untuk admin.' }, 403);

    const { results } = await env.DB.prepare(
        `SELECT sr.id, sr.screening_type, sr.question_number, sr.question,
                sr.answer, sr.score, sr.created_at,
                u.id AS user_id, u.full_name, u.email, u.username
         FROM screening_results sr
         JOIN users u ON u.id = sr.user_id
         ORDER BY sr.created_at DESC`
    ).all();
    return json({ results: results || [] });
}

// ---------------------------------------------------------
// USERS (admin): GET /api/users, GET /api/users/stats/summary
// (TIDAK DIUBAH)
// ---------------------------------------------------------
async function handleUsersList(request, env) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);
    if (authUser.role !== 'admin') return json({ error: 'Akses ditolak. Halaman ini khusus untuk admin.' }, 403);

    const url = new URL(request.url);
    const search = (url.searchParams.get('search') || '').trim();
    const like = `%${search}%`;
    const { results } = await env.DB.prepare(
        `SELECT id, full_name, email, username, role, status, created_at, last_login
         FROM users
         WHERE full_name LIKE ? OR email LIKE ? OR username LIKE ?
         ORDER BY created_at DESC`
    )
        .bind(like, like, like)
        .all();
    return json({ users: results || [] });
}

async function handleUsersStats(request, env) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);
    if (authUser.role !== 'admin') return json({ error: 'Akses ditolak. Halaman ini khusus untuk admin.' }, 403);

    const [userCount, screeningCount, loginCount] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) AS count FROM users').first(),
        env.DB.prepare(
            `SELECT COUNT(*) AS count FROM (
               SELECT DISTINCT user_id, screening_type, strftime('%Y-%m-%d %H:%M', created_at)
               FROM screening_results
             )`
        ).first(),
        env.DB.prepare('SELECT COUNT(*) AS count FROM login_logs').first(),
    ]);

    return json({
        users: userCount?.count || 0,
        screenings: screeningCount?.count || 0,
        logins: loginCount?.count || 0,
    });
}

// ---------------------------------------------------------
// AI CONSULT: POST /api/ai/consult -> Google Gemini REST API (langsung)
//
// [REVISI] Sebelumnya endpoint ini di-proxy ke Railway. Sekarang Worker
// memanggil Gemini API langsung memakai env.GEMINI_API_KEY, sehingga:
//   - Tidak ada lagi ketergantungan pada Railway/Express requireAuth.
//   - Otorisasi tetap memakai getAuthUser()/D1 (cookie atlas_session +
//     JWT_SECRET) yang sudah ada — TIDAK DIUBAH.
//   - Format response ke browser tetap { reply, topic } supaya
//     public/js/ai-adapter.js (postToGeminiConsult) tetap kompatibel
//     tanpa perlu diubah.
//   - Kode error (code) dikirim balik sesuai kontrak yang sudah dibaca
//     ai-adapter.js: invalid_key, quota, timeout, server_error,
//     bad_response — supaya mekanisme fallback ke LocalHeuristicAdapter
//     di client tetap berjalan seperti sebelumnya.
// ---------------------------------------------------------
const GEMINI_TIMEOUT_MS = 20000; // Gemini bisa butuh waktu; beri jeda wajar sebelum dianggap timeout
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';
const GEMINI_MAX_OUTPUT_TOKENS = 1024;

function resolveGeminiModel(env) {
    return (env.GEMINI_MODEL && String(env.GEMINI_MODEL).trim()) || GEMINI_DEFAULT_MODEL;
}

// Membangun system instruction dari topic + screeningContext yang
// dikirim client (lihat sanitizeScreeningContextForGemini di
// public/js/ai-adapter.js). Gemini TIDAK menghitung ulang skor/risk
// level — itu tetap 100% hasil Screening/Summary Engine lokal.
function buildGeminiSystemInstruction(topic, screeningContext) {
    const lines = [];

    lines.push(
        'Anda adalah asisten pendamping kesehatan mental pada aplikasi Atlas Jiwa. ' +
            'Gunakan bahasa yang hangat, suportif, reflektif, dan tidak menghakimi. ' +
            'Anda BUKAN pengganti diagnosis klinis, terapi, atau layanan darurat. ' +
            'Anda TIDAK boleh menghitung ulang atau mengubah skor, tingkat risiko, ' +
            'maupun hasil screening — itu semua sudah dihitung di sisi aplikasi. ' +
            'Jika pengguna menunjukkan tanda krisis (ingin bunuh diri, menyakiti diri, ' +
            'atau membahayakan orang lain), segera arahkan untuk menghubungi layanan ' +
            'darurat atau profesional kesehatan mental tepercaya di lokasi mereka.'
    );

    if (topic) {
        lines.push(`Topik konsultasi saat ini: "${String(topic).slice(0, 200)}".`);
    }

    if (screeningContext) {
        if (typeof screeningContext === 'string') {
            lines.push(`Konteks hasil screening pengguna: ${screeningContext.slice(0, 3000)}`);
        } else if (typeof screeningContext === 'object' && !Array.isArray(screeningContext)) {
            const parts = [];
            if (screeningContext.screeningType) parts.push(`jenis screening: ${screeningContext.screeningType}`);
            if (screeningContext.riskLevel) parts.push(`tingkat risiko: ${screeningContext.riskLevel}`);
            if (typeof screeningContext.score === 'number') parts.push(`skor komposit: ${screeningContext.score}`);
            if (screeningContext.theme) parts.push(`tema: ${screeningContext.theme}`);
            if (screeningContext.interpretation) parts.push(`interpretasi: ${screeningContext.interpretation}`);
            if (Array.isArray(screeningContext.tags) && screeningContext.tags.length) {
                parts.push(`tag: ${screeningContext.tags.join(', ')}`);
            }
            if (parts.length) {
                lines.push(`Konteks hasil screening pengguna — ${parts.join('; ')}.`);
            }
        }
    }

    lines.push('Jawab secara ringkas (maksimal beberapa paragraf pendek), empatik, dan relevan dengan topik di atas.');

    return lines.join(' ');
}

// history: [{ role: 'user' | 'assistant', text: string }, ...]
// (lihat sanitizeHistoryForGemini di public/js/ai-adapter.js)
// Gemini memakai role 'user' / 'model', bukan 'assistant'.
function mapHistoryToGeminiContents(history) {
    if (!Array.isArray(history)) return [];
    return history
        .filter((turn) => turn && typeof turn.text === 'string' && ['user', 'assistant'].includes(turn.role))
        .map((turn) => ({
            role: turn.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: turn.text }],
        }));
}

// Memanggil Gemini REST API langsung. Melempar Error dengan properti
// `.code` (invalid_key | quota | timeout | bad_response | server_error)
// dan `.status` (kode HTTP yang sebaiknya dikembalikan ke browser).
async function callGeminiConsult(env, { topic, message, history, screeningContext }) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey || String(apiKey).trim().length < 16) {
        const err = new Error(
            '[Config] GEMINI_API_KEY belum di-set di Worker (wrangler secret put GEMINI_API_KEY), atau tidak valid.'
        );
        err.code = 'invalid_key';
        err.status = 500;
        throw err;
    }

    const model = resolveGeminiModel(env);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const contents = [...mapHistoryToGeminiContents(history), { role: 'user', parts: [{ text: message }] }];

    const requestBody = {
        contents,
        systemInstruction: {
            parts: [{ text: buildGeminiSystemInstruction(topic, screeningContext) }],
        },
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timeoutId);
        if (err && err.name === 'AbortError') {
            const e = new Error('Permintaan ke Gemini API melebihi batas waktu.');
            e.code = 'timeout';
            e.status = 504;
            throw e;
        }
        console.error('[Gemini] fetch gagal:', err.message);
        const e = new Error('Gagal menghubungi Gemini API.');
        e.code = 'server_error';
        e.status = 502;
        throw e;
    }
    clearTimeout(timeoutId);

    let data;
    try {
        data = await response.json();
    } catch (err) {
        console.error('[Gemini] gagal parse response JSON:', err.message);
        const e = new Error('Respons Gemini API tidak valid.');
        e.code = 'bad_response';
        e.status = 502;
        throw e;
    }

    if (!response.ok) {
        const status = response.status;
        const reason = (data && data.error && (data.error.status || data.error.message)) || '';
        console.error('[Gemini] error response:', status, JSON.stringify(data && data.error));

        if (status === 400 && /API[_ ]?KEY/i.test(String(reason))) {
            const e = new Error('Gemini API key tidak valid.');
            e.code = 'invalid_key';
            e.status = 401;
            throw e;
        }
        if (status === 401 || status === 403) {
            const e = new Error('Gemini API key tidak valid atau tidak memiliki akses.');
            e.code = 'invalid_key';
            e.status = 401;
            throw e;
        }
        if (status === 429) {
            const e = new Error('Kuota Gemini API habis atau rate limit tercapai.');
            e.code = 'quota';
            e.status = 429;
            throw e;
        }
        if (status >= 500) {
            const e = new Error('Gemini API sedang bermasalah di sisi server.');
            e.code = 'server_error';
            e.status = 502;
            throw e;
        }

        const e = new Error(`Gemini API mengembalikan error (HTTP ${status}).`);
        e.code = 'server_error';
        e.status = 502;
        throw e;
    }

    const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
    const finishReason = candidate && candidate.finishReason;
    console.log("[Gemini] finishReason =", finishReason);

    if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
        const e = new Error(`Respons Gemini diblokir oleh safety filter (finishReason: ${finishReason}).`);
        e.code = 'bad_response';
        e.status = 502;
        throw e;
    }

    const text =
        candidate &&
        candidate.content &&
        Array.isArray(candidate.content.parts) &&
        candidate.content.parts
            .map((p) => p.text || '')
            .join('')
            .trim();
            console.log("[Gemini] reply length =", text.length);
console.log("[Gemini] preview =", text.substring(0, 200));

    if (!text) {
        const e = new Error('Respons Gemini kosong atau tidak terduga.');
        e.code = 'bad_response';
        e.status = 502;
        throw e;
    }

    return text;
}

async function handleAiConsult(request, env) {
    // Otorisasi TETAP memakai sistem auth Cloudflare D1 yang sudah ada
    // (cookie atlas_session + JWT_SECRET). Tidak diubah sama sekali.
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.', code: 'unauthorized' }, 401);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
        return json({ error: 'Body request tidak valid.', code: 'bad_response' }, 400);
    }

    const { topic, message, history, screeningContext } = body;

    if (!topic || typeof topic !== 'string') {
        return json({ error: 'topic wajib diisi.', code: 'bad_response' }, 400);
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
        return json({ error: 'message wajib diisi.', code: 'bad_response' }, 400);
    }

    try {
        const reply = await callGeminiConsult(env, {
            topic,
            message: message.trim(),
            history,
            screeningContext,
        });

        // Format response DIPERTAHANKAN persis seperti kontrak lama
        // supaya public/js/ai-adapter.js (postToGeminiConsult) tetap
        // kompatibel tanpa perlu diubah.
        return json({ reply, topic });
    } catch (err) {
        const code = err.code || 'server_error';
        const status = err.status || 502;
        console.error('[POST /api/ai/consult] Gagal memanggil Gemini:', code, err.message);
        return json({ error: err.message || 'Gagal memproses konsultasi AI.', code }, status);
    }
}

// ---------------------------------------------------------
// ROUTER
// Catatan arsitektur: proxy /api/agent/* ke FastAPI (opsional, via
// FASTAPI_BASE_URL) SUDAH DIHAPUS. Auth, screening, dan users tetap
// ditangani langsung di Worker (D1). POST /api/ai/consult sekarang
// juga ditangani langsung di Worker ini (Gemini API), TIDAK LAGI
// di-proxy ke Railway. Worker ini sudah tidak melakukan fetch()
// keluar ke Railway sama sekali.
// ---------------------------------------------------------
async function handleApi(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
        if (pathname === '/api/auth/register' && method === 'POST') return await handleRegister(request, env);
        if (pathname === '/api/auth/login' && method === 'POST') return await handleLogin(request, env);
        if (pathname === '/api/auth/logout' && method === 'POST') return await handleLogout(request);
        if (pathname === '/api/auth/profile' && method === 'GET') return await handleProfile(request, env);

        if (pathname === '/api/screening' && method === 'POST') return await handleScreeningSubmit(request, env);
        if (pathname === '/api/screening' && method === 'GET') return await handleScreeningAll(request, env);
        if (/^\/api\/screening\/[^/]+$/.test(pathname) && method === 'GET') {
            const userid = pathname.split('/').pop();
            return await handleScreeningByUser(request, env, userid);
        }

        if (pathname === '/api/users' && method === 'GET') return await handleUsersList(request, env);
        if (pathname === '/api/users/stats/summary' && method === 'GET') return await handleUsersStats(request, env);

        // [REVISI] Konsultasi AI ditangani langsung di Worker (Gemini API),
        // tidak lagi diproxy ke Railway.
        if (pathname === '/api/ai/consult' && method === 'POST') return await handleAiConsult(request, env);

        return json({ error: 'Endpoint tidak ditemukan.' }, 404);
    } catch (err) {
        console.error('[Worker API Error]', pathname, err.message);
        return json({ error: 'Terjadi kesalahan pada server.', detail: err.message }, 500);
    }
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/api/')) {
            return handleApi(request, env);
        }

        // File statis (HTML/CSS/JS) disajikan langsung dari /public lewat
        // binding ASSETS — tidak ada lagi proxy keluar untuk ini.
        return env.ASSETS.fetch(request);
    },
};
