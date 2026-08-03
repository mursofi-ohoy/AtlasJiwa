/* =========================================
   [SUDAH TIDAK DIPAKAI / SUPERSEDED]
   ---------------------------------------------------
   File ini adalah draft awal penggabungan layer semantik baru
   (extractBehavioralFeatures, computeSeverity, dst.) ke dalam
   orkestrator analyzeBehavioral(). File ini TIDAK ADA di urutan
   <script> yang didokumentasikan di behavioral-integration.js,
   jadi tidak pernah benar-benar dimuat oleh halaman manapun —
   sementara behavioral-nlp-engine.js versi sebelumnya JUSTRU
   memakai orkestrator lama yang belum memanggil layer baru sama
   sekali. Akibatnya panel "Analisis Perilaku Lanjutan" selalu
   kosong/LOW apa pun isi narasinya (lihat analyzeFull()).

   Isi file ini sekarang SUDAH DIGABUNGKAN langsung ke fungsi
   analyzeBehavioral() di behavioral-nlp-engine.js (di bagian
   Orchestrator paling bawah), plus fitur tambahan (external_locus,
   present_bias, ambivalence) yang belum ada di draft ini.

   Silakan hapus file ini dari proyek untuk menghindari kebingungan
   — dibiarkan di sini hanya sebagai referensi riwayat perubahan.
   ========================================= */

function analyzeBehavioral(text) {
    requireDeps();

    const safeText = String(text || '');

    const qualResult = global.AtlasNLPEngine.analyzeQualitative(safeText);
    const temporal = extractTemporal(safeText);
    const emotionTransition = analyzeEmotionTransition(safeText, qualResult);
    const functionalImpact = extractFunctionalImpact(safeText);
    const habitLoop = detectHabitLoop(safeText, qualResult, emotionTransition);
    const changeReadiness = assessChangeReadiness(safeText);
    const scores = computeQuantitativeScores(qualResult, temporal, functionalImpact, emotionTransition);
    const behaviorPatterns = extractBehaviorPatterns(qualResult);

    const riskIndicators = [];

    if (temporal.behavior_escalation) {
        riskIndicators.push('behavior_escalation');
    }

    if (habitLoop.loop_detected) {
        riskIndicators.push('habit_loop_present');
    }

    if (emotionTransition.pattern.mismatch) {
        riskIndicators.push('short_term_reward_long_term_cost_mismatch');
    }

    if (qualResult.meta.urgent) {
        riskIndicators.push('urgency_markers_present');
    }

    if (functionalImpact.health.present) {
        riskIndicators.push('physical_symptoms_present');
    }

    const protectiveFactors = [];

    if (qualResult.axes.selfAwareness.score >= 1) {
        protectiveFactors.push('self_awareness_present');
    }

    if (qualResult.axes.copingEfficacy.score >= 1) {
        protectiveFactors.push('coping_strategy_present');
    }

    if (changeReadiness.stage === 'action' || changeReadiness.stage === 'maintenance') {
        protectiveFactors.push('active_change_effort');
    }

    const axesWithEvidence = qualResult.evidence.length;

    const confidence = Math.max(0, Math.min(1,
        ((qualResult.meta.reliability || 0) / 100) * 0.6 +
        Math.min(1, axesWithEvidence / 5) * 0.4
    ));

    /* ---------- NEW behavioral semantic layer ---------- */

    const behavioralFeatures = extractBehavioralFeatures(safeText);
    const awareness = computeAwareness(safeText);
    const severity = computeSeverity(behavioralFeatures, temporal);
    const reliability = computeReliability(safeText, behavioralFeatures, temporal);
    const riskDimensions = buildRiskDimensions(behavioralFeatures, severity);
    const detectedPatterns = getDetectedPatterns(behavioralFeatures);
    const behavioralSummary = generateBehavioralSummary(behavioralFeatures, severity, awareness);
    const recommendedStrategy = generateRecommendedStrategy(behavioralFeatures);
    const archetypes = detectArchetypes(safeText);
    const distortions = detectDistortions(safeText);

    /* ---------- Merge new risk indicators without removing old ones ---------- */

    if (behavioralFeatures.loss_of_control.present && riskIndicators.indexOf('loss_of_control') === -1) {
        riskIndicators.push('loss_of_control');
    }

    if (behavioralFeatures.excessive_duration.present && riskIndicators.indexOf('excessive_duration') === -1) {
        riskIndicators.push('excessive_duration');
    }

    if (behavioralFeatures.functional_impairment.present && riskIndicators.indexOf('functional_impairment') === -1) {
        riskIndicators.push('functional_impairment');
    }

    if (behavioralFeatures.relationship_impact.present && riskIndicators.indexOf('relationship_impact') === -1) {
        riskIndicators.push('relationship_impact');
    }

    if (behavioralFeatures.failed_attempts.present && riskIndicators.indexOf('failed_attempts') === -1) {
        riskIndicators.push('failed_attempts');
    }

    if (behavioralFeatures.catastrophizing.present && riskIndicators.indexOf('catastrophizing_language') === -1) {
        riskIndicators.push('catastrophizing_language');
    }

    if (awareness.level === 'HIGH' && protectiveFactors.indexOf('high_problem_awareness') === -1) {
        protectiveFactors.push('high_problem_awareness');
    }

    return {
        /* ---------- Existing output tetap ada ---------- */
        profile: {
            theme: qualResult.theme,
            word_count: qualResult.meta.wordCount,
            lexical_diversity: qualResult.meta.lexicalDiversity
        },
        behavior_patterns: behaviorPatterns,
        emotional_analysis: emotionTransition,
        habit_loop: habitLoop,
        functional_impact: functionalImpact,
        temporal: temporal,
        change_readiness: changeReadiness,
        risk_indicators: riskIndicators,
        protective_factors: protectiveFactors,
        scores: scores,
        evidence: qualResult.evidence,
        confidence: Math.round(confidence * 100) / 100,

        /* ---------- NEW output ---------- */
        behavioral_features: behavioralFeatures,
        detected_patterns: detectedPatterns,
        awareness: awareness,
        awareness_level: awareness.level,
        severity: severity,
        severity_level: severity.level,
        reliability: reliability,
        reliability_score: reliability.score,
        risk_dimensions: riskDimensions,
        behavioral_summary: behavioralSummary,
        recommended_strategy: recommendedStrategy,
        archetypes: archetypes,
        distortions: distortions
    };
}