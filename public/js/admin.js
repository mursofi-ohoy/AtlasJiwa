/* =========================================
   ATLAS JIWA — Admin Dashboard Logic (public/js/admin.js)
   Semua endpoint di sini KHUSUS admin — server (users.routes.js &
   screening.routes.js) memvalidasi ulang req.user.role === 'admin'
   di SETIAP request, jadi pengecekan role di frontend ini hanya
   untuk UX (mencegah non-admin melihat UI kosong/error), BUKAN
   satu-satunya lapisan keamanan.
   ========================================= */

(function () {
    'use strict';

    let allUsers = [];
    let allScreening = [];

    // ---------- Tunggu auth-guard.js selesai + validasi role admin ----------
    document.addEventListener('atlas:auth-ready', (e) => {
        const user = e.detail;
        if (!user || user.role !== 'admin') {
            window.location.replace('/atlas-jiwa.html');
            return;
        }
        initAdmin();
    });

    function initAdmin() {
        loadStats();
        loadUsers();
        loadScreening();

        document.getElementById('refreshUsersBtn').addEventListener('click', loadUsers);
        document.getElementById('refreshScreeningBtn').addEventListener('click', loadScreening);
        document.getElementById('userSearch').addEventListener('input', debounce(() => loadUsers(), 350));

        document.getElementById('exportUsersCsvBtn').addEventListener('click', () => exportUsers('csv'));
        document.getElementById('exportUsersXlsBtn').addEventListener('click', () => exportUsers('xls'));
        document.getElementById('exportScreeningCsvBtn').addEventListener('click', () => exportScreening('csv'));
        document.getElementById('exportScreeningXlsBtn').addEventListener('click', () => exportScreening('xls'));

        document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
        document.getElementById('editUserForm').addEventListener('submit', submitEditUser);
        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
        initTheme();
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function showBanner(message, type) {
        const el = document.getElementById('adminBanner');
        el.textContent = message;
        el.className = `banner show ${type}`;
        setTimeout(() => { el.className = 'banner'; }, 4000);
    }

    function escapeHtml(str) {
        return String(str ?? '').replace(/[&<>"']/g, (c) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[c]));
    }
    function formatDate(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleString('id-ID'); } catch { return iso; }
    }

    // ---------- Statistik ----------
    async function loadStats() {
        try {
            const res = await fetch('/api/users/stats/summary', { credentials: 'include' });
            if (!res.ok) throw new Error('Gagal memuat statistik');
            const stats = await res.json();
            document.getElementById('statUsers').textContent = stats.users;
            document.getElementById('statScreenings').textContent = stats.screenings;
            document.getElementById('statLogins').textContent = stats.logins;
        } catch (err) {
            console.error('[Admin] loadStats:', err);
        }
    }

    // ---------- Daftar User ----------
    async function loadUsers() {
        const tbody = document.getElementById('usersTableBody');
        const search = document.getElementById('userSearch').value.trim();
        try {
            const res = await fetch(`/api/users?search=${encodeURIComponent(search)}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Gagal memuat daftar user');
            const { users } = await res.json();
            allUsers = users;

            if (users.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Tidak ada user ditemukan.</td></tr>';
                return;
            }

            tbody.innerHTML = users.map((u) => `
                <tr>
                    <td>${escapeHtml(u.full_name)}</td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${escapeHtml(u.username)}</td>
                    <td><span class="role-badge ${u.role}">${escapeHtml(u.role)}</span></td>
                    <td><span class="status-badge ${u.status}">${escapeHtml(u.status)}</span></td>
                    <td>${formatDate(u.created_at)}</td>
                    <td>${formatDate(u.last_login)}</td>
                    <td class="row-actions">
                        <button class="btn-sm" data-edit-id="${u.id}">Edit</button>
                        <button class="btn-sm danger" data-delete-id="${u.id}">Hapus</button>
                    </td>
                </tr>
            `).join('');

            tbody.querySelectorAll('[data-edit-id]').forEach((btn) =>
                btn.addEventListener('click', () => openEditModal(btn.dataset.editId)));
            tbody.querySelectorAll('[data-delete-id]').forEach((btn) =>
                btn.addEventListener('click', () => deleteUser(btn.dataset.deleteId)));
        } catch (err) {
            console.error('[Admin] loadUsers:', err);
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Gagal memuat data.</td></tr>';
        }
    }

    function openEditModal(userId) {
        const user = allUsers.find((u) => u.id === userId);
        if (!user) return;
        document.getElementById('editUserId').value = user.id;
        document.getElementById('editFullName').value = user.full_name;
        document.getElementById('editEmail').value = user.email;
        document.getElementById('editUsername').value = user.username;
        document.getElementById('editRole').value = user.role;
        document.getElementById('editStatus').value = user.status;
        document.getElementById('editModalOverlay').classList.add('open');
    }
    function closeEditModal() {
        document.getElementById('editModalOverlay').classList.remove('open');
    }

    async function submitEditUser(e) {
        e.preventDefault();
        const id = document.getElementById('editUserId').value;
        const payload = {
            full_name: document.getElementById('editFullName').value.trim(),
            email: document.getElementById('editEmail').value.trim(),
            username: document.getElementById('editUsername').value.trim(),
            role: document.getElementById('editRole').value,
            status: document.getElementById('editStatus').value,
        };
        try {
            const res = await fetch(`/api/users/${id}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                showBanner(body.error || 'Gagal memperbarui user.', 'error');
                return;
            }
            closeEditModal();
            showBanner('User berhasil diperbarui.', 'success');
            loadUsers();
        } catch (err) {
            console.error('[Admin] submitEditUser:', err);
            showBanner('Tidak dapat terhubung ke server.', 'error');
        }
    }

    async function deleteUser(id) {
        const user = allUsers.find((u) => u.id === id);
        const confirmed = window.confirm(
            `Hapus user "${user ? user.full_name : id}"? Tindakan ini tidak bisa dibatalkan.`
        );
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' });
            const body = await res.json().catch(() => ({}));
            if (!res.ok) {
                showBanner(body.error || 'Gagal menghapus user.', 'error');
                return;
            }
            showBanner('User berhasil dihapus.', 'success');
            loadUsers();
            loadStats();
        } catch (err) {
            console.error('[Admin] deleteUser:', err);
            showBanner('Tidak dapat terhubung ke server.', 'error');
        }
    }

    // ---------- Hasil Screening ----------
    async function loadScreening() {
        const tbody = document.getElementById('screeningTableBody');
        try {
            const res = await fetch('/api/screening', { credentials: 'include' });
            if (!res.ok) throw new Error('Gagal memuat hasil screening');
            const { results } = await res.json();
            allScreening = results;

            if (results.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Belum ada hasil screening.</td></tr>';
                return;
            }

            tbody.innerHTML = results.slice(0, 500).map((r) => `
                <tr>
                    <td>${formatDate(r.created_at)}</td>
                    <td>${escapeHtml(r.full_name)}</td>
                    <td>${escapeHtml(r.email)}</td>
                    <td>${escapeHtml(r.screening_type)}</td>
                    <td>${r.question_number}</td>
                    <td>${escapeHtml(r.question)}</td>
                    <td>${escapeHtml(r.answer)}</td>
                    <td>${r.score}</td>
                </tr>
            `).join('');

            if (results.length > 500) {
                tbody.insertAdjacentHTML('beforeend',
                    `<tr><td colspan="8" class="empty-state">Menampilkan 500 dari ${results.length} baris. Gunakan Export untuk melihat semuanya.</td></tr>`);
            }
        } catch (err) {
            console.error('[Admin] loadScreening:', err);
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Gagal memuat data.</td></tr>';
        }
    }

    // ---------- Export CSV / Excel ----------
    // "Export Excel" diimplementasikan sebagai tabel HTML yang disimpan
    // dengan ekstensi .xls — Microsoft Excel & Google Sheets bisa membuka
    // format ini secara native tanpa perlu library tambahan (mis. SheetJS)
    // di sisi klien.
    function downloadBlob(content, filename, mime) {
        const blob = new Blob([content], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function toCsv(rows, headers) {
        const escapeCsv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
        const lines = [headers.map(escapeCsv).join(',')];
        rows.forEach((row) => lines.push(headers.map((h) => escapeCsv(row[h])).join(',')));
        return lines.join('\r\n');
    }

    function toXlsHtml(rows, headers, title) {
        const thead = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
        const tbody = rows.map((row) =>
            `<tr>${headers.map((h) => `<td>${escapeHtml(row[h])}</td>`).join('')}</tr>`
        ).join('');
        return `<html><head><meta charset="UTF-8"></head><body>
            <table border="1"><caption>${escapeHtml(title)}</caption>${thead}${tbody}</table>
        </body></html>`;
    }

    function exportUsers(format) {
        if (allUsers.length === 0) { showBanner('Tidak ada data user untuk diexport.', 'error'); return; }
        const headers = ['full_name', 'email', 'username', 'role', 'status', 'created_at', 'last_login'];
        const rows = allUsers.map((u) => ({ ...u, created_at: formatDate(u.created_at), last_login: formatDate(u.last_login) }));

        if (format === 'csv') {
            downloadBlob(toCsv(rows, headers), 'atlas-jiwa-users.csv', 'text/csv;charset=utf-8;');
        } else {
            downloadBlob(toXlsHtml(rows, headers, 'ATLAS JIWA — Users'), 'atlas-jiwa-users.xls', 'application/vnd.ms-excel');
        }
    }

    function exportScreening(format) {
        if (allScreening.length === 0) { showBanner('Tidak ada data screening untuk diexport.', 'error'); return; }
        const headers = ['created_at', 'full_name', 'email', 'screening_type', 'question_number', 'question', 'answer', 'score'];
        const rows = allScreening.map((r) => ({ ...r, created_at: formatDate(r.created_at) }));

        if (format === 'csv') {
            downloadBlob(toCsv(rows, headers), 'atlas-jiwa-screening.csv', 'text/csv;charset=utf-8;');
        } else {
            downloadBlob(toXlsHtml(rows, headers, 'ATLAS JIWA — Screening Results'), 'atlas-jiwa-screening.xls', 'application/vnd.ms-excel');
        }
    }

    // ---------- Tema ----------
    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        applyTheme(current === 'dark' ? 'light' : 'dark');
    }
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        document.getElementById('theme-toggle').textContent = theme === 'dark' ? '☀️' : '🌙';
        localStorage.setItem('atlasjiwa-theme', theme);
    }
    function initTheme() {
        const saved = localStorage.getItem('atlasjiwa-theme');
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(saved || (prefersDark ? 'dark' : 'light'));
    }
})();
