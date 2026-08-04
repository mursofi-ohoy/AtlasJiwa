/* =========================================
   ATLAS JIWA — Topic Selector (public/js/topic-selector.js)
   -----------------------------------------------------------
   Menyediakan UI pilihan topik ("Doom Scrolling" / "Online Gaming")
   yang WAJIB dipilih user sebelum chat dengan provider Gemini bisa
   dipakai (server butuh topic untuk memilih system prompt yang tepat
   — lihat server/services/gemini-prompts.js).

   PENTING: jika provider AI aktif = 'local' (default project ini),
   file ini TIDAK MELAKUKAN APA PUN — init() langsung return null
   supaya UI/alur chat yang sudah berjalan sama sekali tidak berubah.

   window.AtlasTopicSelector.isNeeded()
     true hanya jika provider aktif == 'gemini'.

   window.AtlasTopicSelector.init(containerEl, onSelect)
     Render 2 tombol topik ke dalam containerEl. Memanggil
     onSelect(topicId) sekali saat user memilih salah satu.
     Mengembalikan elemen wrapper yang dirender, atau null jika
     provider bukan gemini (lihat isNeeded()).

   Load order (screening.html): setelah ai-adapter.js & agent-bridge.js,
   sebelum script.js.
   ========================================= */

(function (global) {
    'use strict';

    const TOPICS = [
        { id: 'doomscrolling', labelId: 'Doom Scrolling', labelEn: 'Doom Scrolling' },
        { id: 'gaming', labelId: 'Online Gaming', labelEn: 'Online Gaming' },
    ];

    function isNeeded() {
        const adapter = global.AtlasAIAdapter;
        return !!(adapter && adapter.config && adapter.config.provider === 'gemini');
    }

    /**
     * @param {HTMLElement} containerEl  elemen tempat selector dirender (mis. panel chat)
     * @param {(topicId: string) => void} onSelect
     * @param {string} [lang] 'id' | 'en'
     * @returns {HTMLElement|null}
     */
    function init(containerEl, onSelect, lang) {
        // Provider local (default project ini): tidak melakukan apa pun,
        // supaya alur chat yang sudah ada persis sama seperti sebelumnya.
        if (!isNeeded()) return null;
        if (!containerEl) return null;

        const isEn = lang === 'en';
        const wrapper = document.createElement('div');
        wrapper.className = 'agent-topic-selector';
        // Inline style saja (bukan file CSS baru) supaya tidak menyentuh
        // stylesheet project yang sudah ada / berpotensi bentrok class name.
        wrapper.style.cssText = 'display:flex;flex-direction:column;gap:.5rem;padding:.75rem 1rem;';
        wrapper.setAttribute('role', 'group');
        wrapper.setAttribute(
            'aria-label',
            isEn ? 'Choose a consultation topic' : 'Pilih topik konsultasi'
        );

        const label = document.createElement('p');
        label.className = 'agent-topic-selector-label';
        label.textContent = isEn
            ? 'Choose a topic to start the AI consultation:'
            : 'Pilih topik untuk memulai konsultasi AI:';
        wrapper.appendChild(label);

        const btnRow = document.createElement('div');
        btnRow.className = 'agent-topic-selector-buttons';
        btnRow.style.cssText = 'display:flex;gap:.5rem;flex-wrap:wrap;';

        TOPICS.forEach((topic) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'agent-topic-btn';
            btn.style.cssText =
                'padding:.4rem .9rem;border-radius:999px;border:1px solid currentColor;background:transparent;cursor:pointer;font:inherit;';
            btn.textContent = isEn ? topic.labelEn : topic.labelId;
            btn.addEventListener('click', () => {
                Array.from(btnRow.children).forEach((el) => el.setAttribute('disabled', 'true'));
                btn.classList.add('selected');
                if (typeof onSelect === 'function') onSelect(topic.id);
            });
            btnRow.appendChild(btn);
        });

        wrapper.appendChild(btnRow);
        containerEl.appendChild(wrapper);
        return wrapper;
    }

    global.AtlasTopicSelector = { isNeeded, init, TOPICS };
})(window);
