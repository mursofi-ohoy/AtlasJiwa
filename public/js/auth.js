/* =========================================
   ATLAS JIWA — Login/Register Page Logic (public/js/auth.js)
   - Tab switch antara form Login <-> Register
   - Show/hide password
   - Validasi input di sisi klien (validasi "sesungguhnya" tetap di
     server — ini hanya untuk UX, bukan lapisan keamanan)
   - Panggil POST /api/auth/login & POST /api/auth/register
   - Toggle tema & bahasa (pola sama dengan atlas-jiwa.html)
   - Jika user sudah login (session valid), langsung redirect ke
     atlas-jiwa.html (atau ?next=... jika ada)
   ========================================= */

(function () {
    'use strict';

    const API_BASE = '/api/auth';

    // ---------- Redirect helper ----------
    function getNextUrl() {
        const params = new URLSearchParams(window.location.search);
        const next = params.get('next');
        return next && next.startsWith('/') ? next : '/atlas-jiwa.html';
    }

    // ---------- Jika sudah login, langsung lempar ke halaman utama ----------
    async function redirectIfAuthenticated() {
        try {
            const res = await fetch(`${API_BASE}/profile`, { credentials: 'include' });
            if (res.ok) {
                window.location.replace(getNextUrl());
            }
        } catch (err) {
            // Diamkan — anggap belum login, biarkan pengguna memakai form.
        }
    }
    redirectIfAuthenticated();

    // ---------- Tabs ----------
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const banner = document.getElementById('authBanner');

    function showTab(which) {
        const isLogin = which === 'login';
        tabLogin.classList.toggle('active', isLogin);
        tabRegister.classList.toggle('active', !isLogin);
        tabLogin.setAttribute('aria-selected', String(isLogin));
        tabRegister.setAttribute('aria-selected', String(!isLogin));
        loginForm.classList.toggle('active', isLogin);
        registerForm.classList.toggle('active', !isLogin);
        hideBanner();
    }
    tabLogin.addEventListener('click', () => showTab('login'));
    tabRegister.addEventListener('click', () => showTab('register'));

    // ---------- Banner ----------
    function showBanner(message, type) {
        banner.textContent = message;
        banner.className = `auth-banner show ${type}`;
    }
    function hideBanner() {
        banner.className = 'auth-banner';
        banner.textContent = '';
    }

    // ---------- Show/hide password ----------
    document.querySelectorAll('.password-toggle').forEach((btn) => {
        btn.addEventListener('click', () => {
            const target = document.getElementById(btn.dataset.target);
            const nowVisible = target.type === 'password';
            target.type = nowVisible ? 'text' : 'password';
            const label = nowVisible
                ? (currentLang === 'en' ? 'Hide' : 'Sembunyikan')
                : (currentLang === 'en' ? 'Show' : 'Tampilkan');
            btn.textContent = label;
        });
    });

    // ---------- Validasi ----------
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;

    function setFieldError(inputId, message) {
        const el = document.getElementById(`err-${inputId}`);
        if (el) el.textContent = message || '';
    }
    function clearFormErrors(form) {
        form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
    }

    function validatePassword(pw) {
        if (!pw || pw.length < 8) return 'Password minimal 8 karakter.';
        if (!/[a-zA-Z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password harus mengandung huruf dan angka.';
        return null;
    }

    // ---------- Submit: LOGIN ----------
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(loginForm);
        hideBanner();

        const identifier = document.getElementById('loginIdentifier').value.trim();
        const password = document.getElementById('loginPassword').value;

        let hasError = false;
        if (!identifier) { setFieldError('loginIdentifier', 'Wajib diisi.'); hasError = true; }
        if (!password) { setFieldError('loginPassword', 'Wajib diisi.'); hasError = true; }
        if (hasError) return;

        const submitBtn = document.getElementById('loginSubmitBtn');
        submitBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identifier, password }),
            });
            const body = await res.json().catch(() => ({}));

            if (!res.ok) {
                showBanner(body.error || 'Login gagal. Periksa kembali data Anda.', 'error');
                return;
            }

            showBanner('Login berhasil. Mengalihkan...', 'success');
            window.location.href = getNextUrl();
        } catch (err) {
            console.error('[ATLAS] Login error:', err);
            showBanner('Tidak dapat terhubung ke server. Coba lagi.', 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // ---------- Submit: REGISTER ----------
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearFormErrors(registerForm);
        hideBanner();

        const full_name = document.getElementById('regFullName').value.trim();
        const email = document.getElementById('regEmail').value.trim();
        const username = document.getElementById('regUsername').value.trim();
        const password = document.getElementById('regPassword').value;
        const confirm_password = document.getElementById('regConfirmPassword').value;

        let hasError = false;
        if (full_name.length < 3) { setFieldError('regFullName', 'Nama lengkap minimal 3 karakter.'); hasError = true; }
        if (!EMAIL_RE.test(email)) { setFieldError('regEmail', 'Format email tidak valid.'); hasError = true; }
        if (!USERNAME_RE.test(username)) { setFieldError('regUsername', '3-30 karakter: huruf/angka/./_'); hasError = true; }
        const pwError = validatePassword(password);
        if (pwError) { setFieldError('regPassword', pwError); hasError = true; }
        if (password !== confirm_password) { setFieldError('regConfirmPassword', 'Konfirmasi tidak sama.'); hasError = true; }
        if (hasError) return;

        const submitBtn = document.getElementById('registerSubmitBtn');
        submitBtn.disabled = true;

        try {
            const res = await fetch(`${API_BASE}/register`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name, email, username, password, confirm_password }),
            });
            const body = await res.json().catch(() => ({}));

            if (!res.ok) {
                showBanner(body.error || 'Registrasi gagal.', 'error');
                return;
            }

            showTab('login');
            showBanner('Registrasi berhasil! Silakan masuk dengan akun baru Anda.', 'success');
            document.getElementById('loginIdentifier').value = email;
        } catch (err) {
            console.error('[ATLAS] Register error:', err);
            showBanner('Tidak dapat terhubung ke server. Coba lagi.', 'error');
        } finally {
            submitBtn.disabled = false;
        }
    });

    // ---------- Tema ----------
    const themeToggle = document.getElementById('theme-toggle');
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        themeToggle.textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('atlasjiwa-theme', theme);
    }
    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    });
    (function initTheme() {
        const saved = localStorage.getItem('atlasjiwa-theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(saved || (prefersDark ? 'dark' : 'light'));
    })();

    // ---------- Bahasa (pola data-en / dataset.id sama seperti atlas-jiwa.html) ----------
    let currentLang = localStorage.getItem('atlasjiwa-lang') || 'id';

    function setLang(lang) {
        document.querySelectorAll('[data-en]').forEach((el) => {
            if (el.dataset.id === undefined) el.dataset.id = el.innerHTML;
            el.innerHTML = lang === 'en' && el.dataset.en.trim() !== '' ? el.dataset.en : el.dataset.id;
        });
        document.getElementById('lang-id').classList.toggle('active', lang === 'id');
        document.getElementById('lang-en').classList.toggle('active', lang === 'en');
        document.documentElement.lang = lang;
        currentLang = lang;
        localStorage.setItem('atlasjiwa-lang', lang);
    }
    document.getElementById('lang-id').addEventListener('click', () => setLang('id'));
    document.getElementById('lang-en').addEventListener('click', () => setLang('en'));
    setLang(currentLang);
})();
