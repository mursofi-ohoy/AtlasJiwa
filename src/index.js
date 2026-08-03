/* =========================================
   ATLAS JIWA — Cloudflare Worker Entry Point (src/index.js)

   PERUBAHAN PENTING (perbaikan error "Failed to load resource 404" di
   /api/auth/login pada atlasjiwa.mursofi1.workers.dev):

   Sebelumnya file ini HANYA meneruskan (proxy) semua request /api/*
   ke backend Express yang di-deploy terpisah di Railway
   (atlasjiwa-production.up.railway.app). Karena repo yang sama juga
   dipakai untuk deployment Railway itu, kode server/ Railway sempat
   berisi konflik Git yang belum selesai — sehingga proses Railway
   crash/tidak sinkron, dan setiap request ke /api/* dari Worker ikut
   gagal (404 / tidak terhubung).

   Supaya situs Cloudflare ini BERDIRI SENDIRI dan tidak lagi tergantung
   pada Railway sama sekali, seluruh logic auth + screening sekarang
   diimplementasikan LANGSUNG di Worker ini, memakai Cloudflare D1
   sebagai database (lihat sql/d1_schema.sql) dan Web Crypto API untuk
   hashing password + JWT sesi (lihat src/lib/crypto.js). Tidak ada
   lagi fetch() keluar ke Railway untuk /api/auth atau /api/screening.

   Fitur "Konsultasi AI" (/api/agent/*) tetap opsional: kalau env
   FASTAPI_BASE_URL di-set (mengarah ke backend FastAPI+Ollama kamu
   sendiri yang bisa diakses publik), Worker akan proxy ke situ.
   Kalau tidak di-set, Worker membalas pesan yang jelas alih-alih 404
   diam-diam — supaya UI tidak "menggantung" tanpa penjelasan.
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
// AGENT (opsional): proxy ke FastAPI kalau env FASTAPI_BASE_URL di-set
// ---------------------------------------------------------
async function handleAgentProxy(request, env, path) {
    const authUser = await getAuthUser(request, env);
    if (!authUser) return json({ error: 'Anda belum login.' }, 401);

    if (!env.FASTAPI_BASE_URL) {
        return json(
            {
                error:
                    'Fitur Konsultasi AI belum dikonfigurasi untuk deployment Cloudflare ini. Set env FASTAPI_BASE_URL ke URL backend FastAPI kamu (wrangler secret put FASTAPI_BASE_URL) agar fitur ini aktif.',
            },
            503
        );
    }

    const body = await request.json().catch(() => ({}));
    const secret = requireEnv(env, 'JWT_SECRET');
    const internalToken = await signToken({ id: authUser.id, username: authUser.username, role: authUser.role }, secret, 120);

    let upstream;
    try {
        upstream = await fetch(`${env.FASTAPI_BASE_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${internalToken}` },
            body: JSON.stringify(body),
        });
    } catch (err) {
        return json({ error: 'Layanan konsultasi AI sedang tidak dapat dihubungi. Coba lagi beberapa saat lagi.' }, 502);
    }

    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
        return json({ error: data.detail || data.error || 'Layanan konsultasi AI menolak permintaan.' }, upstream.status);
    }
    return json(data);
}

// ---------------------------------------------------------
// ROUTER
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

        if (pathname === '/api/agent/session/init' && method === 'POST') {
            return await handleAgentProxy(request, env, '/api/v1/agent/session/init');
        }
        if (pathname === '/api/agent/consult' && method === 'POST') {
            return await handleAgentProxy(request, env, '/api/v1/agent/consult');
        }
        if (pathname === '/api/analysis/preclinical' && method === 'POST') {
            return await handleAgentProxy(request, env, '/api/v1/analysis/preclinical');
        }

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
