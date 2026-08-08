// Agrégats calculés sur l'ensemble des exécutions d'un utilisateur.
//
// Deux sources de données doivent produire exactement les mêmes chiffres : les tables normalisées
// lorsqu'une base est configurée, et les jobs encore en mémoire lorsqu'elle ne l'est pas
// (l'application est conçue pour fonctionner en mode dégradé). Plutôt que deux implémentations
// qui divergeraient à la première évolution, l'agrégation est écrite une seule fois, sur une forme
// canonique — celle des lignes de `run_sources`, `run_audits` et `run_calls`. Le chemin PostgreSQL
// lit ces lignes telles quelles ; `normalizeRun()` y ramène un résultat en mémoire.

import { sourceRows, auditRows, callRows, runSummary } from "./persistence.js";

const round = (value, decimals = 2) => {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};
const average = (values, decimals = 2) =>
  values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, decimals) : null;
const sum = (items, pick) => items.reduce((total, item) => total + Number(pick(item) || 0), 0);

/** Regroupe `items` par clé, en ignorant les clés absentes. */
function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (key == null || key === "") continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

/** Ramène un résultat complet (job en mémoire) à la forme canonique des lignes historisées. */
export function normalizeRun(result) {
  const summary = runSummary(result);
  return {
    id: result.id,
    status: result.status,
    task_type: result.taskType,
    total_cost: Number(result.totalCost || 0),
    duration_ms: result.durationMs ?? null,
    document_chars: summary.documentChars,
    created_at: result.createdAt ?? null,
    sources: sourceRows(result.id, result.sources),
    audits: auditRows(result.id, result.audits),
    calls: callRows(result.id, result.calls)
  };
}

/** État d'une source : contrôlée et joignable, contrôlée et injoignable, ou non contrôlée. */
export function sourceState(source) {
  if (source?.accessible === true) return "accessible";
  if (source?.accessible === false) return "inaccessible";
  return "unchecked";
}

export const SOURCE_STATES = ["accessible", "inaccessible", "unchecked"];

export function buildAnalytics(runs = []) {
  const sources = runs.flatMap(run => run.sources || []);
  const audits = runs.flatMap(run => run.audits || []);
  const calls = runs.flatMap(run => run.calls || []);

  const finalScores = runs
    .map(run => (run.audits || []).at(-1)?.score_global)
    .map(Number)
    .filter(Number.isFinite);
  const durations = runs.map(run => Number(run.duration_ms)).filter(Number.isFinite);

  return {
    totals: {
      runs: runs.length,
      validated: runs.filter(run => String(run.status).startsWith("validated")).length,
      rejected: runs.filter(run => run.status === "rejected_by_arbiter").length,
      errors: runs.filter(run => run.status === "error").length,
      cost: round(sum(calls, call => call.cost), 6),
      promptTokens: sum(calls, call => call.prompt_tokens),
      completionTokens: sum(calls, call => call.completion_tokens),
      avgCycles: average(runs.map(run => (run.audits || []).length)),
      avgScore: average(finalScores),
      avgDurationSec: durations.length ? round(average(durations, 0) / 1000, 1) : null,
      documentChars: sum(runs, run => run.document_chars)
    },

    byTaskType: [...groupBy(runs, run => run.task_type)]
      .map(([taskType, group]) => ({
        taskType,
        runs: group.length,
        avgScore: average(
          group.map(run => Number((run.audits || []).at(-1)?.score_global)).filter(Number.isFinite)
        ),
        cost: round(sum(group, run => run.total_cost), 6)
      }))
      .sort((a, b) => b.runs - a.runs),

    byModel: [...groupBy(calls, call => call.model || "unknown")]
      .map(([model, group]) => ({
        model,
        calls: group.length,
        cost: round(sum(group, call => call.cost), 6),
        promptTokens: sum(group, call => call.prompt_tokens),
        completionTokens: sum(group, call => call.completion_tokens)
      }))
      .sort((a, b) => b.cost - a.cost),

    byRole: [...groupBy(calls, call => call.role)]
      .map(([role, group]) => ({ role, calls: group.length, cost: round(sum(group, call => call.cost), 6) }))
      .sort((a, b) => b.cost - a.cost),

    sources: {
      total: sources.length,
      ...Object.fromEntries(
        SOURCE_STATES.map(state => [state, sources.filter(source => sourceState(source) === state).length])
      ),
      byClass: [...groupBy(sources, source => source.source_class || "other")]
        .map(([sourceClass, group]) => ({
          sourceClass,
          count: group.length,
          accessible: group.filter(source => sourceState(source) === "accessible").length
        }))
        .sort((a, b) => b.count - a.count),
      // Les domaines les plus sollicités, avec leur taux d'accessibilité réel : c'est là qu'on
      // voit qu'une source régulièrement citée est en fait systématiquement injoignable.
      topHosts: [...groupBy(sources, source => source.host)]
        .map(([host, group]) => ({
          host,
          count: group.length,
          runs: new Set(group.map(source => source.run_id)).size,
          accessible: group.filter(source => sourceState(source) === "accessible").length
        }))
        .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host))
        .slice(0, 25)
    },

    audits: {
      total: audits.length,
      byCycle: [...groupBy(audits, audit => audit.cycle)]
        .map(([cycle, group]) => ({
          cycle: Number(cycle),
          audits: group.length,
          avgScore: average(group.map(audit => Number(audit.score_global)).filter(Number.isFinite)),
          avgAnomalies: average(group.map(audit => Number(audit.anomalies || 0))),
          avgSevere: average(group.map(audit => Number(audit.severe_anomalies || 0)))
        }))
        .sort((a, b) => a.cycle - b.cycle),
      // Où les documents pèchent le plus : moyenne de chaque critère sur tous les audits, du plus
      // faible au plus fort.
      byCriterion: [...new Set(audits.flatMap(audit => Object.keys(audit.scores || {})))]
        .map(criterion => ({
          criterion,
          avgScore: average(audits.map(audit => Number(audit.scores?.[criterion])).filter(Number.isFinite))
        }))
        .sort((a, b) => (a.avgScore ?? 101) - (b.avgScore ?? 101))
    }
  };
}
