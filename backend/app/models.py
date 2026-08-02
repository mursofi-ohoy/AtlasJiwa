from pydantic import BaseModel


class AxisScore(BaseModel):
    """Satu entri dari analysis.axes / overallSummary.axisTotals di
    nlp-engine.js / summary-engine.js. `density` opsional karena
    axisTotals (agregat) tidak menghitungnya, hanya per-jawaban."""
    score: float = 0
    density: float | None = None


class NarrativeContext(BaseModel):
    """Bentuk ringkas dari satu hasil window.AtlasNLPEngine.analyzeQualitative()
    -- dikirim ulang tiap pesan chat supaya prompt Qwen tahu nada &
    axis dominan pesan TERBARU, bukan cuma histori lama."""
    theme: str | None = None
    tags: list[str] = []
    axes: dict[str, float] = {}
    qualitative_risk_percent: float | None = None
    reliability: float | None = None


class ScreeningContext(BaseModel):
    """Bentuk ringkas dari window.AtlasSummaryEngine.buildOverallSummary()
    -- dikirim SEKALI saat sesi konsultasi dibuka (POST /session/init)
    supaya Qwen punya gambaran menyeluruh hasil screening, bukan cuma
    satu pesan chat yang terisolasi."""
    screening_type: str | None = None
    theme: str | None = None
    tags: list[str] = []
    composite_risk_percent: float | None = None
    composite_risk_band: str | None = None
    addiction_components: list[dict] = []
    axis_totals: dict[str, float] = {}
    synergy_pairs: list[str] = []
    reliability_avg: float | None = None


class ChatRequest(BaseModel):
    message: str
    session_id: str | None = None
    # Konteks NLP pesan ini (opsional -- kalau tidak dikirim, agent
    # tetap jalan hanya dengan histori percakapan tersimpan).
    context: NarrativeContext | None = None


class SessionInitRequest(BaseModel):
    screening_type: str | None = None
    context: ScreeningContext


class ChatResponse(BaseModel):
    response: str
    session_id: str
    is_crisis: bool = False
    risk_percent: float | None = None
