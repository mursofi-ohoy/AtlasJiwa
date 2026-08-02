/* =========================================
   ATLAS JIWA — Auth Guard
   Dipasang di <head> atlas-jiwa.html & screening.html (SEBELUM <body>
   dirender) untuk memastikan halaman ini hanya bisa diakses oleh
   pengguna yang sudah login (lihat spesifikasi butir 6: "atlas-jiwa.html
   hanya bisa dibuka jika sudah login, jika belum -> redirect login.html").

   Cara kerja:
   1. Segera sembunyikan <html> agar konten tidak "kelihatan sekilas"
      (flash of protected content) sebelum status login dipastikan.
   2. Panggil GET /api/auth/profile (memakai cookie httpOnly, credentials:
      'include'). Endpoint ini dilindungi middleware requireAuth di server.
   3. Jika 401 / gagal -> redirect ke /login.html.
   4. Jika berhasil -> tampilkan kembali <html>, isi elemen
      #atlasUserName & pasang handler #atlasLogoutBtn (jika elemen
      tsb ada di halaman), dan broadcast event 'atlas:auth-ready'
      supaya script lain (mis. admin.js) bisa memakai data user.
   ========================================= */

(function () {
    'use strict';

    // Cegah flash-of-content: sembunyikan dulu sampai status auth jelas.
    document.documentElement.style.visibility = 'hidden';

    function reveal() {
        document.documentElement.style.visibility = '';
    }

    function goToLogin() {
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login.html?next=${next}`);
    }

    async function checkSession() {
        try {
            const res = await fetch('/api/auth/profile', { credentials: 'include' });
            if (!res.ok) {
                goToLogin();
                return;
            }
            const { user } = await res.json();
            window.AtlasUser = user;
            wireUserUI(user);
            reveal();
            document.dispatchEvent(new CustomEvent('atlas:auth-ready', { detail: user }));
        } catch (err) {
            console.error('[ATLAS] Gagal memeriksa sesi login:', err);
            goToLogin();
        }
    }

    function wireUserUI(user) {
        const nameEl = document.getElementById('atlasUserName');
        if (nameEl) {
            nameEl.textContent = user.full_name || user.username;
            nameEl.hidden = false;
            nameEl.title = `${user.email} · ${user.role === 'admin' ? 'Admin' : 'User'}`;
        }

        const logoutBtn = document.getElementById('atlasLogoutBtn');
        if (logoutBtn) {
            logoutBtn.hidden = false;
            logoutBtn.addEventListener('click', async () => {
                logoutBtn.disabled = true;
                try {
                    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                } catch (err) {
                    console.error('[ATLAS] Gagal logout dengan bersih:', err);
                } finally {
                    window.location.href = '/login.html';
                }
            });
        }
    }

    // Jalankan sesegera mungkin; document masih di-parse (script ini
    // ditaruh di <head> tanpa defer/async) sehingga cek ini berjalan
    // sebelum <body> sempat dirender pengguna.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkSession);
    } else {
        checkSession();
    }
})();
