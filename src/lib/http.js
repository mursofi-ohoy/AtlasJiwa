/* =========================================
   ATLAS JIWA — HTTP Helpers (src/lib/http.js)
   Cookie parsing/serialization, validator input, dan pembungkus
   response JSON — versi ringan setara server/middleware.js tapi
   untuk lingkungan Worker (tidak ada Express req/res).
   ========================================= */

const COOKIE_NAME = 'atlas_session';
const SESSION_MAX_AGE = 2 * 60 * 60; // 2 jam, selaras dengan umur JWT

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders },
    });
}

function parseCookies(request) {
    const header = request.headers.get('Cookie') || '';
    const out = {};
    header.split(';').forEach((pair) => {
        const idx = pair.indexOf('=');
        if (idx === -1) return;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) out[key] = decodeURIComponent(val);
    });
    return out;
}

function getSessionCookieHeader(request, token) {
    const isHttps = request.url.startsWith('https://');
    const attrs = [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_MAX_AGE}`,
    ];
    if (isHttps) attrs.push('Secure');
    return attrs.join('; ');
}

function getClearSessionCookieHeader(request) {
    const isHttps = request.url.startsWith('https://');
    const attrs = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (isHttps) attrs.push('Secure');
    return attrs.join('; ');
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_.]{3,30}$/;

function isValidEmail(value) {
    return typeof value === 'string' && EMAIL_REGEX.test(value.trim());
}
function isValidUsername(value) {
    return typeof value === 'string' && USERNAME_REGEX.test(value.trim());
}
function isValidPassword(value) {
    if (typeof value !== 'string' || value.length < 8) return false;
    return /[a-zA-Z]/.test(value) && /[0-9]/.test(value);
}

export {
    COOKIE_NAME,
    json,
    parseCookies,
    getSessionCookieHeader,
    getClearSessionCookieHeader,
    isValidEmail,
    isValidUsername,
    isValidPassword,
};
