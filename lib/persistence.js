// Mise en forme des lignes à historiser pour une exécution.
//
// Le détail d'une analyse était déjà conservé dans la colonne `result` (jsonb), mais sous une
// forme opaque : impossible d'interroger les sources, les scores ou la consommation autrement
// qu'en désérialisant chaque exécution. Ces fonctions produisent en plus des lignes normalisées
// (`run_sources`, `run_audits`, `run_calls`) qui rendent ces données requêtables, et complètent
// `runs` de colonnes résumées pour éviter d'ouvrir le jsonb à chaque affichage.
//
// Fonctions pures : elles ne parlent pas à la base, elles décrivent seulement ce qu'il faut y
// écrire. Le pilotage SQL reste dans server.js, ces fonctions restent couvertes par les tests.

import { isSevere } from "./audit.js";
import { sourceHost } from "./sources.js";

const toInt = value => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
};

/** Colonnes résumées de `runs`, calculées une fois à l'écriture plutôt qu'à chaque lecture. */
export function runSummary(result) {
  const audits = result?.audits || [];
  const lastAudit = audits.at(-1);
  const calls = result?.calls || [];
  return {
    cycles: audits.length,
    finalScore: toInt(lastAudit?.score_global),
    arbiterDecision: result?.arbitration?.decision ?? null,
    arbiterConfidence: toInt(result?.arbitration?.confiance),
    // Les deux dimensions que la confiance globale résume : une base factuelle solide peut porter
    // une recommandation fragile, et l'écart entre les deux est justement ce qu'on veut pouvoir
    // interroger d'une analyse à l'autre.
    arbiterEvidenceConfidence: toInt(result?.arbitration?.confiance_preuves),
    arbiterConclusionConfidence: toInt(result?.arbitration?.confiance_conclusion),
    promptTokens: calls.reduce((total, call) => total + Number(call.usage?.prompt_tokens || 0), 0),
    completionTokens: calls.reduce((total, call) => total + Number(call.usage?.completion_tokens || 0), 0),
    sourcesTotal: (result?.sources || []).length,
    sourcesAccessible: (result?.sources || []).filter(source => source.accessible === true).length,
    documentChars: String(result?.finalDocument || "").length
  };
}

/** Une ligne par source contrôlée. `accessible` vaut null quand Firecrawl était désactivé. */
export function sourceRows(runId, sources) {
  // `?? []` plutôt qu'un paramètre par défaut : celui-ci ne couvre pas null, seulement undefined.
  return (sources ?? []).map(source => ({
    run_id: runId,
    url: String(source.url || ""),
    host: sourceHost(source.url),
    origin: source.origin ?? null,
    accessible: typeof source.accessible === "boolean" ? source.accessible : null,
    source_class: source.sourceClass ?? null,
    title: source.title || null,
    status_code: toInt(source.statusCode),
    // Longueur du contenu extrait, pas le contenu lui-même : `result` le conserve déjà, et le
    // dupliquer ligne à ligne ferait grossir la base sans rien rendre requêtable.
    characters: source.markdown ? source.markdown.length : null,
    reason: source.reason || null
  }));
}

/** Une ligne par cycle d'audit, avec le décompte d'anomalies sévères déjà résolu. */
export function auditRows(runId, audits) {
  return (audits ?? []).map((audit, index) => {
    const anomalies = audit?.anomalies || [];
    return {
      run_id: runId,
      cycle: toInt(audit?.cycle) ?? index + 1,
      score_global: toInt(audit?.score_global),
      scores: audit?.scores || {},
      decision: audit?.decision ?? null,
      anomalies: anomalies.length,
      severe_anomalies: anomalies.filter(anomalie => isSevere(anomalie?.gravite)).length,
      resume: audit?.resume || null
    };
  });
}

/** Une ligne par appel de modèle, y compris ceux d'un cycle qui a échoué ensuite. */
export function callRows(runId, calls) {
  return (calls ?? []).map((call, index) => ({
    run_id: runId,
    seq: index + 1,
    role: call?.role ?? null,
    model: call?.model || "unknown",
    provider: typeof call?.provider === "string" ? call.provider : call?.provider?.name || null,
    prompt_tokens: Number(call?.usage?.prompt_tokens || 0),
    completion_tokens: Number(call?.usage?.completion_tokens || 0),
    cost: Number(call?.usage?.cost || 0),
    finish_reason: call?.finishReason ?? null,
    // Renseigné lorsque le modèle demandé n'a rien renvoyé et qu'un repli a pris le relais :
    // sans cette trace, la bascule reste invisible dans l'historique de consommation.
    fallback_from: call?.fallbackFrom ?? null
  }));
}

/** Ligne de journal résumant une analyse terminée.
 *
 *  Rien n'était journalisé en fin d'analyse : la seule façon de savoir qu'une exécution s'était
 *  bien terminée était de constater l'absence d'erreur, ce qui ne distingue pas un succès d'un
 *  processus interrompu. */
export function completionLogLine(result, { durationMs, persisted } = {}) {
  const summary = runSummary(result);
  const parts = [
    `[job] fin ${result?.id}`,
    `statut=${result?.status ?? "inconnu"}`,
    `tâche=${result?.taskType ?? "?"}`,
    `cycles=${summary.cycles}`,
    `score=${summary.finalScore ?? "—"}`,
    `arbitrage=${summary.arbiterDecision ?? "—"}`,
    `sources=${summary.sourcesAccessible}/${summary.sourcesTotal}`,
    `appels=${(result?.calls || []).length}`,
    `tokens=${summary.promptTokens}+${summary.completionTokens}`,
    `coût=$${Number(result?.totalCost || 0).toFixed(4)}`,
    `document=${summary.documentChars}c`,
    `durée=${durationMs == null ? "—" : `${Math.round(durationMs / 1000)}s`}`,
    `historisé=${persisted ? "oui" : "non"}`
  ];
  return parts.join(" ");
}

/** Ligne de journal pour une analyse qui a échoué. */
export function failureLogLine(jobId, error, { durationMs } = {}) {
  return `[job] échec ${jobId} durée=${durationMs == null ? "—" : `${Math.round(durationMs / 1000)}s`} raison=${error?.message || error}`;
}
