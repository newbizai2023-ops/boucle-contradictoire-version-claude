import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalytics, normalizeRun, sourceState } from "../lib/analytics.js";

/** Construit une exécution à la forme canonique (celle des lignes historisées). */
const run = (id, overrides = {}) => ({
  id,
  status: "validated",
  task_type: "technical",
  total_cost: 0.1,
  duration_ms: 60_000,
  document_chars: 1000,
  sources: [],
  audits: [],
  calls: [],
  ...overrides
});
const source = (host, accessible, sourceClass = "other", run_id = "r1") => ({
  run_id, url: `https://${host}/p`, host, accessible, source_class: sourceClass
});
const audit = (cycle, score, anomalies = 0, severe = 0, scores = {}) => ({
  cycle, score_global: score, anomalies, severe_anomalies: severe, scores
});
const call = (model, role, cost, prompt = 10, completion = 5) => ({
  model, role, cost, prompt_tokens: prompt, completion_tokens: completion
});

test("sourceState distingue contrôlée-joignable, contrôlée-injoignable et non contrôlée", () => {
  assert.equal(sourceState({ accessible: true }), "accessible");
  assert.equal(sourceState({ accessible: false }), "inaccessible");
  assert.equal(sourceState({ accessible: null }), "unchecked");
  assert.equal(sourceState({}), "unchecked");
});

test("les totaux comptent séparément validations, rejets, échecs et interruptions", () => {
  const { totals } = buildAnalytics([
    run("a", { status: "validated" }),
    run("b", { status: "validated_with_reservations" }),
    run("c", { status: "rejected_by_arbiter" }),
    run("d", { status: "error" }),
    run("e", { status: "interrupted" })
  ]);
  assert.equal(totals.runs, 5);
  assert.equal(totals.validated, 2, "les deux formes de validation comptent");
  assert.equal(totals.rejected, 1);
  assert.equal(totals.errors, 1);
  // Sans compteur dédié, une analyse dont le processus a disparu gonflait le total sans apparaître
  // dans aucune catégorie : le coût qu'elle avait engagé passait pour celui d'analyses abouties.
  assert.equal(totals.interrupted, 1);
});

test("le score retenu par exécution est celui du dernier cycle", () => {
  const { totals } = buildAnalytics([
    run("a", { audits: [audit(1, 40), audit(2, 60), audit(3, 92)] }),
    run("b", { audits: [audit(1, 80)] })
  ]);
  assert.equal(totals.avgScore, 86, "moyenne de 92 et 80");
  assert.equal(totals.avgCycles, 2);
});

test("le coût et les tokens sont sommés sur les appels, pas sur les exécutions", () => {
  const { totals } = buildAnalytics([
    run("a", { total_cost: 999, calls: [call("opus", "redaction", 0.2, 100, 50), call("grok", "arbitrage", 0.05, 10, 5)] })
  ]);
  assert.equal(totals.cost, 0.25);
  assert.equal(totals.promptTokens, 110);
  assert.equal(totals.completionTokens, 55);
});

test("les modèles sont classés du plus coûteux au moins coûteux", () => {
  const { byModel } = buildAnalytics([
    run("a", { calls: [call("cher", "redaction", 5), call("modique", "audit", 0.5), call("cher", "correction", 3)] })
  ]);
  assert.deepEqual(byModel.map(m => m.model), ["cher", "modique"]);
  assert.equal(byModel[0].calls, 2);
  assert.equal(byModel[0].cost, 8);
});

test("les sources sont ventilées par état et par catégorie", () => {
  const { sources } = buildAnalytics([
    run("a", {
      sources: [
        source("gouv.fr", true, "primary_official"),
        source("blog.fr", false, "other"),
        source("autre.fr", null, "other")
      ]
    })
  ]);
  assert.equal(sources.total, 3);
  assert.equal(sources.accessible, 1);
  assert.equal(sources.inaccessible, 1);
  assert.equal(sources.unchecked, 1);
  assert.deepEqual(sources.byClass, [
    { sourceClass: "other", count: 2, accessible: 0 },
    { sourceClass: "primary_official", count: 1, accessible: 1 }
  ]);
});

test("un domaine cité par plusieurs exécutions est compté une fois par occurrence et une fois par exécution", () => {
  // Sert à repérer une source régulièrement citée mais systématiquement injoignable.
  const { sources } = buildAnalytics([
    run("r1", { sources: [source("mort.fr", false, "other", "r1"), source("mort.fr", false, "other", "r1")] }),
    run("r2", { sources: [source("mort.fr", false, "other", "r2"), source("vivant.fr", true, "other", "r2")] })
  ]);
  const mort = sources.topHosts.find(h => h.host === "mort.fr");
  assert.equal(mort.count, 3, "trois occurrences");
  assert.equal(mort.runs, 2, "sur deux exécutions");
  assert.equal(mort.accessible, 0, "jamais joignable");
});

test("les audits sont agrégés par cycle, dans l'ordre", () => {
  const { audits } = buildAnalytics([
    run("a", { audits: [audit(1, 40, 6, 3), audit(2, 80, 2, 0)] }),
    run("b", { audits: [audit(1, 60, 4, 1)] })
  ]);
  assert.deepEqual(audits.byCycle.map(c => c.cycle), [1, 2]);
  assert.equal(audits.byCycle[0].audits, 2);
  assert.equal(audits.byCycle[0].avgScore, 50);
  assert.equal(audits.byCycle[0].avgSevere, 2);
  assert.equal(audits.byCycle[1].avgScore, 80);
});

test("les critères d'audit sont classés du plus faible au plus fort", () => {
  const { audits } = buildAnalytics([
    run("a", { audits: [audit(1, 50, 0, 0, { calculs: 40, couverture: 90 }), audit(2, 60, 0, 0, { calculs: 60, couverture: 100 })] })
  ]);
  assert.deepEqual(audits.byCriterion, [
    { criterion: "calculs", avgScore: 50 },
    { criterion: "couverture", avgScore: 95 }
  ]);
});

test("buildAnalytics renvoie une structure complète sans aucune exécution", () => {
  const analytics = buildAnalytics([]);
  assert.equal(analytics.totals.runs, 0);
  assert.equal(analytics.totals.avgScore, null);
  assert.equal(analytics.totals.avgDurationSec, null);
  assert.deepEqual(analytics.byModel, []);
  assert.deepEqual(analytics.sources.byClass, []);
  assert.deepEqual(analytics.audits.byCycle, []);
  assert.equal(analytics.sources.total, 0);
});

test("buildAnalytics tolère des exécutions sans sources, audits ni appels", () => {
  const analytics = buildAnalytics([{ id: "a", status: "error" }]);
  assert.equal(analytics.totals.runs, 1);
  assert.equal(analytics.totals.errors, 1);
  assert.equal(analytics.totals.cost, 0);
});

test("normalizeRun ramène un résultat en mémoire à la forme des lignes historisées", () => {
  // C'est ce qui garantit que le mode sans base et le mode PostgreSQL produisent les mêmes
  // chiffres : une seule implémentation de l'agrégation, une seule forme d'entrée.
  const canonique = normalizeRun({
    id: "r1",
    status: "validated",
    taskType: "legal",
    totalCost: 0.3,
    durationMs: 30_000,
    finalDocument: "abc",
    audits: [{ cycle: 1, score_global: 95, scores: { calculs: 90 }, anomalies: [{ gravite: "faible" }] }],
    sources: [{ url: "https://a.fr/x", accessible: true, sourceClass: "other" }],
    calls: [{ role: "redaction", model: "opus", usage: { cost: 0.3, prompt_tokens: 10, completion_tokens: 5 } }]
  });
  assert.equal(canonique.task_type, "legal");
  assert.equal(canonique.document_chars, 3);
  assert.equal(canonique.sources[0].host, "a.fr");
  assert.equal(canonique.audits[0].anomalies, 1);
  assert.equal(canonique.calls[0].prompt_tokens, 10);

  const analytics = buildAnalytics([canonique]);
  assert.equal(analytics.totals.avgScore, 95);
  assert.equal(analytics.totals.cost, 0.3);
  assert.equal(analytics.sources.accessible, 1);
  assert.deepEqual(analytics.byTaskType, [{ taskType: "legal", runs: 1, avgScore: 95, cost: 0.3 }]);
});
