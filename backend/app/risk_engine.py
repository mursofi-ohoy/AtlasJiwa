"""
Lapisan deteksi risiko/krisis yang DETERMINISTIK -- sengaja tidak
bergantung sepenuhnya pada Qwen untuk memutuskan is_crisis. LLM bisa
salah baca konteks atau berhalusinasi; keputusan "apakah perlu
tampilkan rujukan darurat" sebaiknya juga dijaga oleh aturan eksplisit
yang bisa diaudit, selaras dengan filosofi axis `urgency` di
public/js/keyword-dictionary.js (client-side) -- di sini versi
server-side-nya, dipakai sebagai lapisan pertahanan kedua (defense in
depth), bukan pengganti.

Menggabungkan dua sinyal:
1. context (ScreeningContext / NarrativeContext) yang SUDAH dihitung
   sisi klien oleh nlp-engine.js / summary-engine.js -- axis `urgency`,
   compositeRisk/qualitative_risk_percent.
2. Pemindaian frasa krisis eksplisit pada teks pesan itu sendiri, jaga-
   jaga jika context tidak dikirim (mis. panggilan API langsung tanpa
   lewat UI) atau pesan baru yang belum sempat dianalisis klien.
"""

import re

# Frasa risiko akut (ID & EN) -- daftar SENGAJA singkat & pada level
# pola umum (bukan daftar metode/cara), cukup untuk memicu jalur aman
# (rujukan ke layanan darurat), bukan untuk analisis linguistik
# mendalam -- itu tugas nlp-engine.js/keyword-dictionary.js di klien.
_CRISIS_PATTERNS = [
    r"\bbunuh diri\b",
    r"\bmengakhiri hidup\b",
    r"\bmenyakiti diri\b",
    r"\bmelukai diri\b",
    r"\btidak ingin hidup\b",
    r"\bingin mati\b",
    r"\bsudah tidak (?:tahan|kuat)\b",
    r"\bsuicide\b",
    r"\bkill myself\b",
    r"\bend my life\b",
    r"\bself[- ]harm\b",
    r"\bhurt myself\b",
    r"\bdon'?t want to live\b",
    r"\bwant to die\b",
    r"\bcan'?t take it anymore\b",
]
_CRISIS_REGEX = re.compile("|".join(_CRISIS_PATTERNS), re.IGNORECASE)

# Ambang skor risiko komposit (0-100, dari computeAxisRisk /
# computeCompositeRiskIndex di sisi klien) yang dianggap krisis kalau
# TIDAK ada penyebutan eksplisit tapi skornya sudah sangat tinggi.
COMPOSITE_RISK_CRISIS_THRESHOLD = 85


def text_has_crisis_pattern(text: str) -> bool:
    return bool(_CRISIS_REGEX.search(text or ""))


def assess_message_risk(message: str, narrative_context: dict | None) -> dict:
    """Mengembalikan { is_crisis: bool, risk_percent: float|None, reason: str }
    untuk SATU pesan chat masuk."""
    reasons = []
    risk_percent = None

    if narrative_context:
        risk_percent = narrative_context.get("qualitative_risk_percent")
        tags = [str(t).lower() for t in (narrative_context.get("tags") or [])]
        if any("segera" in t or "immediate" in t or "urgent" in t for t in tags):
            reasons.append("urgency_tag")
        axes = narrative_context.get("axes") or {}
        if axes.get("urgency", 0) and axes["urgency"] > 0:
            reasons.append("urgency_axis")

    pattern_hit = text_has_crisis_pattern(message)
    if pattern_hit:
        reasons.append("explicit_phrase")

    score_hit = isinstance(risk_percent, (int, float)) and risk_percent >= COMPOSITE_RISK_CRISIS_THRESHOLD
    if score_hit:
        reasons.append("high_composite_risk")

    is_crisis = pattern_hit or score_hit or "urgency_tag" in reasons

    return {
        "is_crisis": is_crisis,
        "risk_percent": risk_percent,
        "reason": ",".join(reasons) if reasons else None,
    }


def assess_session_risk(screening_context: dict | None) -> dict:
    """Versi assess_message_risk() untuk konteks screening (saat sesi
    dibuka) -- dipakai session/init supaya sesi yang dibuka dari hasil
    screening berisiko tinggi langsung ditandai is_crisis sejak awal,
    bukan menunggu pesan chat pertama."""
    if not screening_context:
        return {"is_crisis": False, "risk_percent": None, "reason": None}

    risk_percent = screening_context.get("composite_risk_percent")
    tags = [str(t).lower() for t in (screening_context.get("tags") or [])]
    urgent_tag = any("segera" in t or "immediate" in t or "urgent" in t for t in tags)
    score_hit = isinstance(risk_percent, (int, float)) and risk_percent >= COMPOSITE_RISK_CRISIS_THRESHOLD

    return {
        "is_crisis": urgent_tag or score_hit,
        "risk_percent": risk_percent,
        "reason": "urgency_tag" if urgent_tag else ("high_composite_risk" if score_hit else None),
    }
