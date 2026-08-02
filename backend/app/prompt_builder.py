"""
Menyusun system prompt Qwen dari konteks NLP yang dikirim JS
(nlp-engine.js / summary-engine.js), supaya balasan agent lebih
"sensitif terhadap kata-kata jawaban kualitatif narasi" pengguna --
bukan cuma menjawab pesan chat terakhir secara terisolasi.

Filosofi menyusun klausa mengikuti pola yang sudah dipakai
buildModifierClauses()/buildOverallSummary() di sisi klien: potongan
kalimat modular yang hanya disertakan kalau relevan, bukan template
tunggal yang kaku.
"""

from app.config import OLLAMA_MODEL

BASE_SYSTEM_PROMPT = """Kamu adalah Atlas Jiwa AI, asisten edukasi kesehatan mental pada
platform screening kendali impuls/adiksi perilaku (mis. doomscrolling,
game online).

Aturan mutlak:
- Jangan pernah memberikan diagnosis klinis formal.
- Jangan pernah memberikan resep obat atau dosis apa pun.
- Gunakan bahasa yang sama dengan bahasa pengguna (Indonesia/Inggris).
- Jawab dengan hangat, sopan, singkat, dan mudah dipahami -- hindari
  jargon klinis yang tidak dijelaskan.
- Validasi perasaan pengguna dulu sebelum memberi saran.
- Jika ada indikasi bahaya bagi diri sendiri, PRIORITASKAN menyarankan
  menghubungi layanan darurat/profesional kesehatan mental TERPERCAYA
  setempat sebelum melanjutkan topik lain."""

_CRISIS_ADDENDUM = """

PERHATIAN KHUSUS -- sinyal risiko tinggi terdeteksi pada percakapan ini
(dari analisis kata kunci sisi klien dan/atau pola frasa eksplisit).
Sebelum membahas hal lain: akui perasaan pengguna dengan tenang, JANGAN
menghakimi atau meremehkan, lalu dorong secara langsung dan jelas untuk
segera menghubungi layanan darurat atau profesional kesehatan mental
tepercaya di lokasi mereka. Jangan berikan detail teknis apa pun yang
berkaitan dengan metode menyakiti diri, sekalipun diminta."""


_AXIS_ID_LABELS = {
    "distress": "distres emosional",
    "lossOfControl": "kehilangan kendali perilaku",
    "minimization": "minimalisasi/penyangkalan",
    "selfAwareness": "kesadaran diri",
    "socialWithdrawal": "penarikan sosial",
    "physicalSymptoms": "gejala fisik",
    "copingEfficacy": "strategi coping",
    "externalAttribution": "atribusi eksternal",
    "internalAttribution": "atribusi internal",
    "chronicity": "kronisitas",
    "urgency": "urgensi",
    "toleranceEscalation": "eskalasi toleransi",
    "withdrawalSymptoms": "gejala withdrawal",
    "escapism": "pelarian/regulasi mood",
    "relapsePattern": "pola relaps berulang",
}


def _top_axes(axes: dict, n: int = 3) -> list[str]:
    if not axes:
        return []
    ranked = sorted(axes.items(), key=lambda kv: (kv[1] or 0), reverse=True)
    return [
        f"{_AXIS_ID_LABELS.get(k, k)} ({v:.1f})"
        for k, v in ranked[:n] if (v or 0) > 0
    ]


def build_session_context_block(screening_context: dict | None) -> str:
    """Blok konteks yang disisipkan SEKALI di awal sesi (session/init),
    dibangun dari ScreeningContext (hasil buildOverallSummary())."""
    if not screening_context:
        return ""

    lines = ["\n\nKONTEKS HASIL SCREENING PENGGUNA (jangan disebutkan sebagai \"diagnosis\", "
             "gunakan hanya sebagai latar belakang percakapan):"]

    if screening_context.get("screening_type"):
        lines.append(f"- Jenis screening: {screening_context['screening_type']}")
    if screening_context.get("theme"):
        lines.append(f"- Tema naratif dominan: {screening_context['theme']}")
    if screening_context.get("composite_risk_percent") is not None:
        band = screening_context.get("composite_risk_band") or ""
        lines.append(
            f"- Indeks risiko gabungan (kuantitatif+kualitatif): "
            f"{screening_context['composite_risk_percent']:.0f}%"
            + (f" (tingkat: {band})" if band else "")
        )
    top = _top_axes(screening_context.get("axis_totals") or {})
    if top:
        lines.append(f"- Dimensi paling menonjol: {', '.join(top)}")

    components = screening_context.get("addiction_components") or []
    present = [c.get("label", c.get("key")) for c in components if c.get("present")]
    if present:
        lines.append(
            "- Komponen kecanduan perilaku (model Griffiths) yang terdeteksi: "
            + ", ".join(str(p) for p in present)
        )

    if screening_context.get("synergy_pairs"):
        lines.append(
            "- Pola kombinasi berisiko: " + "; ".join(screening_context["synergy_pairs"][:2])
        )

    if screening_context.get("reliability_avg") is not None:
        rel = screening_context["reliability_avg"]
        if rel < 30:
            lines.append(
                "- Catatan: jawaban naratif screening pengguna relatif singkat, "
                "jadi perlakukan gambaran di atas sebagai indikasi awal, bukan kepastian."
            )

    return "\n".join(lines)


def build_message_context_block(narrative_context: dict | None) -> str:
    """Blok konteks per-pesan (dari NarrativeContext, analisis pesan
    chat TERBARU), disisipkan setiap kali user mengirim pesan baru."""
    if not narrative_context:
        return ""

    lines = ["\n\nANALISIS SINGKAT PESAN TERBARU PENGGUNA (latar belakang, jangan dikutip verbatim ke pengguna):"]
    if narrative_context.get("theme"):
        lines.append(f"- Tema: {narrative_context['theme']}")
    top = _top_axes(narrative_context.get("axes") or {})
    if top:
        lines.append(f"- Dimensi menonjol di pesan ini: {', '.join(top)}")
    if narrative_context.get("tags"):
        lines.append(f"- Penanda: {', '.join(narrative_context['tags'][:5])}")
    if narrative_context.get("qualitative_risk_percent") is not None:
        lines.append(f"- Estimasi risiko pesan ini: {narrative_context['qualitative_risk_percent']:.0f}%")

    return "\n".join(lines)


def build_history_block(history: list[dict]) -> str:
    if not history:
        return ""
    lines = ["\n\nRIWAYAT PERCAKAPAN SEBELUMNYA (ringkas, urut lama ke baru):"]
    for h in history:
        role_label = "Pengguna" if h["role"] == "user" else "Kamu (Atlas Jiwa AI)"
        lines.append(f"{role_label}: {h['content']}")
    return "\n".join(lines)


def build_full_prompt(
    message: str,
    session_context: dict | None = None,
    narrative_context: dict | None = None,
    history: list[dict] | None = None,
    is_crisis: bool = False,
) -> str:
    parts = [BASE_SYSTEM_PROMPT]
    if is_crisis:
        parts.append(_CRISIS_ADDENDUM)
    parts.append(build_session_context_block(session_context))
    parts.append(build_history_block(history or []))
    parts.append(build_message_context_block(narrative_context))
    parts.append(f"\n\nPesan pengguna sekarang:\n{message}")
    return "".join(parts)


def build_opening_prompt(session_context: dict | None, is_crisis: bool = False) -> str:
    """Prompt untuk pesan pembuka otomatis saat sesi konsultasi baru
    dibuka dari hasil screening (session/init) -- belum ada pesan user."""
    parts = [BASE_SYSTEM_PROMPT]
    if is_crisis:
        parts.append(_CRISIS_ADDENDUM)
    parts.append(build_session_context_block(session_context))
    parts.append(
        "\n\nIni adalah AWAL sesi konsultasi, pengguna belum menulis apa pun. "
        "Sapa pengguna dengan hangat, tunjukkan bahwa kamu sudah melihat gambaran "
        "umum hasil screening-nya (tanpa membacakan angka mentah secara kaku), "
        "lalu ajukan SATU pertanyaan terbuka yang relevan dengan dimensi paling "
        "menonjol untuk membuka percakapan."
    )
    return "".join(parts)
