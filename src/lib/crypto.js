/* =========================================
   ATLAS JIWA — Crypto Helpers (src/lib/crypto.js)
   Pengganti bcrypt + jsonwebtoken versi Node (server/auth.js) yang
   TIDAK bisa dipakai di Cloudflare Workers (tidak ada Node runtime,
   tidak bisa npm-install native addon seperti bcrypt).

   Semua fungsi di bawah HANYA memakai Web Crypto API bawaan runtime
   Workers (globalThis.crypto.subtle), jadi tidak butuh dependency
   tambahan sama sekali dan bebas dari isu build/native binding.

   - Password hashing : PBKDF2-SHA256, 100.000 iterasi, salt acak
     16 byte per user (setara keamanannya dengan bcrypt cost tinggi).
   - Sesi login        : JWT HS256 buatan sendiri (header.payload.signature,
     base64url), diverifikasi pakai HMAC-SHA256 dengan JWT_SECRET.
   ========================================= */

function bufToBase64Url(buf) {
    const bytes = new Uint8Array(buf);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBuf(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64url.length % 4)) % 4);
    const str = atob(b64);
    const bytes = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
    return bytes.buffer;
}

function textToBuf(text) {
    return new TextEncoder().encode(text);
}

// ---------------------------------------------------------
// Password hashing (PBKDF2-SHA256)
// ---------------------------------------------------------
const PBKDF2_ITERATIONS = 100000;

/** Menghasilkan { hash, salt } (keduanya hex string) untuk disimpan
 *  di kolom users.password_hash & users.password_salt. */
async function hashPassword(plainPassword) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const salt = [...saltBytes].map((b) => b.toString(16).padStart(2, '0')).join('');

    const keyMaterial = await crypto.subtle.importKey('raw', textToBuf(plainPassword), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        256
    );
    const hash = [...new Uint8Array(derived)].map((b) => b.toString(16).padStart(2, '0')).join('');
    return { hash, salt };
}

/** Bandingkan password mentah dari form login dengan hash+salt di DB. */
async function comparePassword(plainPassword, hash, salt) {
    const saltBytes = new Uint8Array(salt.match(/.{2}/g).map((h) => parseInt(h, 16)));
    const keyMaterial = await crypto.subtle.importKey('raw', textToBuf(plainPassword), 'PBKDF2', false, ['deriveBits']);
    const derived = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        256
    );
    const computedHash = [...new Uint8Array(derived)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Perbandingan waktu-konstan sederhana untuk menghindari timing attack.
    if (computedHash.length !== hash.length) return false;
    let diff = 0;
    for (let i = 0; i < computedHash.length; i++) diff |= computedHash.charCodeAt(i) ^ hash.charCodeAt(i);
    return diff === 0;
}

// ---------------------------------------------------------
// JWT (HS256) — dibuat manual, tanpa library
// ---------------------------------------------------------
async function getHmacKey(secret) {
    return crypto.subtle.importKey('raw', textToBuf(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** payload: object bebas (id, username, role). expiresInSeconds: umur token. */
async function signToken(payload, secret, expiresInSeconds = 2 * 60 * 60) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

    const encodedHeader = bufToBase64Url(textToBuf(JSON.stringify(header)));
    const encodedPayload = bufToBase64Url(textToBuf(JSON.stringify(fullPayload)));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const key = await getHmacKey(secret);
    const signature = await crypto.subtle.sign('HMAC', key, textToBuf(signingInput));
    const encodedSignature = bufToBase64Url(signature);

    return `${signingInput}.${encodedSignature}`;
}

/** Mengembalikan payload jika valid, atau null jika invalid/kedaluwarsa. */
async function verifyToken(token, secret) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    try {
        const key = await getHmacKey(secret);
        const signatureValid = await crypto.subtle.verify(
            'HMAC',
            key,
            base64UrlToBuf(encodedSignature),
            textToBuf(`${encodedHeader}.${encodedPayload}`)
        );
        if (!signatureValid) return null;

        const payload = JSON.parse(new TextDecoder().decode(base64UrlToBuf(encodedPayload)));
        if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) >= payload.exp) return null;
        return payload;
    } catch (err) {
        return null;
    }
}

export { hashPassword, comparePassword, signToken, verifyToken };
