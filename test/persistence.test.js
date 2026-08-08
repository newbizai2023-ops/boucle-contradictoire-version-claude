import test from "node:test";
import assert from "node:assert/strict";
import { runSummary, sourceRows, auditRows, callRows, completionLogLine, failureLogLine } from "../lib/persistence.js";

const RUN = "11111111-1111-1111-1111-111111111111";

const resultat = {
  id: RUN,
  status: "validated_with_reservations",
  taskType: "financial",
  totalCost: 0.25,
  finalDocument: "abcde",
  arbitration: { decision: "APPROUVE_AVEC_RESERVES", confiance: 82, confiance_preuves: 90, confiance_conclusion: 82 },
  audits: [
    {
      cycle: 1,
      score_global: 60,
      scores: { calculs: 50 },
      decision: "CORRIGER",
      resume: "à revoir",
      anomalies: [{ gravite: "élevée" }, { gravite: "faible" }],
      claims: [{ id: "CLAIM-001", type: "fait", affirmation: "Le support prend fin en 2026.", statut: "NON_VERIFIE", critique: true, sources: [] }]
    },
    {
      cycle: 2,
      score_global: 91,
      scores: { calculs: 90 },
      decision: "VALIDER",
      anomalies: [],
      claims: [
        { id: "CLAIM-001", type: "fait", affirmation: "Le support prend fin en 2026.", statut: "VERIFIE", critique: true, sources: ["https://www.legifrance.gouv.fr/x"] },
        { id: "CLAIM-002", type: "recommandation", affirmation: "Renouveler à 5 ans.", statut: "NON_VERIFIE", critique: false, sources: [] }
      ]
    }
  ],
  sources: [
    { url: "https://www.legifrance.gouv.fr/x", accessible: true, sourceClass: "primary_official", title: "T", statusCode: 200, markdown: "0123456789", origin: "openrouter" },
    { url: "https://mort.example.com/y", accessible: false, sourceClass: "other", reason: "HTTP 404" },
    { url: "pas une url", accessible: null, sourceClass: "invalid", reason: "Vérification Firecrawl désactivée" }
  ],
  calls: [
    { role: "redaction", model: "~anthropic/claude-opus-latest", usage: { prompt_tokens: 100, completion_tokens: 40, cost: 0.2 }, finishReason: "stop" },
    { role: "audit", model: "openai/gpt-5.6-sol", usage: { prompt_tokens: 30, completion_tokens: 10, cost: 0.05 }, fallbackFrom: "~moonshotai/kimi-latest" }
  ]
};

test("runSummary résume l'exécution sans rouvrir le détail", () => {
  assert.deepEqual(runSummary(resultat), {
    cycles: 2,
    finalScore: 91,
    arbiterDecision: "APPROUVE_AVEC_RESERVES",
    arbiterConfidence: 82,
    arbiterEvidenceConfidence: 90,
    arbiterConclusionConfidence: 82,
    promptTokens: 130,
    completionTokens: 50,
    sourcesTotal: 3,
    sourcesAccessible: 1,
    documentChars: 5,
    claimsTotal: 2,
    claimsCriticalUnverified: 0
  });
});

test("runSummary tolère une exécution vide ou interrompue avant tout résultat", () => {
  const summary = runSummary({});
  assert.equal(summary.cycles, 0);
  assert.equal(summary.finalScore, null);
  assert.equal(summary.arbiterDecision, null);
  assert.equal(summary.promptTokens, 0);
  assert.doesNotThrow(() => runSummary(undefined));
});

test("sourceRows extrait le domaine et distingue les trois états d'une source", () => {
  const rows = sourceRows(RUN, resultat.sources);
  assert.deepEqual(rows.map(row => row.host), ["www.legifrance.gouv.fr", "mort.example.com", null]);
  assert.deepEqual(rows.map(row => row.accessible), [true, false, null], "null = source non contrôlée");
  assert.equal(rows[0].characters, 10, "la longueur extraite est conservée, pas le contenu");
  assert.equal(rows[0].status_code, 200);
  assert.equal(rows[1].reason, "HTTP 404");
  assert.ok(!("markdown" in rows[0]), "le contenu extrait ne doit pas être dupliqué ligne à ligne");
});

test("auditRows compte les anomalies sévères, accents compris", () => {
  const rows = auditRows(RUN, resultat.audits);
  assert.deepEqual(rows.map(row => row.cycle), [1, 2]);
  assert.equal(rows[0].anomalies, 2);
  assert.equal(rows[0].severe_anomalies, 1, "« élevée » accentuée doit compter comme sévère");
  assert.equal(rows[0].decision, "CORRIGER");
  assert.deepEqual(rows[1].scores, { calculs: 90 });
});

test("auditRows numérote les cycles même si le modèle a omis le champ", () => {
  const rows = auditRows(RUN, [{ score_global: 50 }, { score_global: 70 }]);
  assert.deepEqual(rows.map(row => row.cycle), [1, 2]);
});

test("callRows conserve la trace d'une bascule vers le modèle de repli", () => {
  const rows = callRows(RUN, resultat.calls);
  assert.deepEqual(rows.map(row => row.seq), [1, 2]);
  assert.equal(rows[0].model, "~anthropic/claude-opus-latest");
  assert.equal(rows[1].fallback_from, "~moonshotai/kimi-latest");
  assert.equal(rows[0].fallback_from, null);
  assert.equal(rows[1].cost, 0.05);
});

test("callRows attribue un modèle par défaut plutôt que d'écrire null", () => {
  // La colonne sert de clé de regroupement dans les statistiques : un null y créerait un trou.
  assert.equal(callRows(RUN, [{ role: "audit" }])[0].model, "unknown");
});

test("les lignes filles portent toutes la référence de l'exécution", () => {
  for (const rows of [sourceRows(RUN, resultat.sources), auditRows(RUN, resultat.audits), callRows(RUN, resultat.calls)]) {
    assert.ok(rows.length > 0);
    for (const row of rows) assert.equal(row.run_id, RUN);
  }
});

test("les constructeurs de lignes acceptent une collection absente", () => {
  assert.deepEqual(sourceRows(RUN), []);
  assert.deepEqual(auditRows(RUN, null), []);
  assert.deepEqual(callRows(RUN, undefined), []);
});

test("completionLogLine résume l'analyse en une ligne exploitable", () => {
  const ligne = completionLogLine(resultat, { durationMs: 92_000, persisted: true });
  assert.match(ligne, /^\[job\] fin 11111111-/);
  for (const attendu of ["statut=validated_with_reservations", "tâche=financial", "cycles=2", "score=91", "arbitrage=APPROUVE_AVEC_RESERVES", "sources=1/3", "appels=2", "tokens=130+50", "coût=$0.2500", "document=5c", "durée=92s", "historisé=oui"]) {
    assert.ok(ligne.includes(attendu), `« ${attendu} » absent de : ${ligne}`);
  }
});

test("completionLogLine signale une analyse non historisée", () => {
  assert.match(completionLogLine(resultat, { durationMs: 1000, persisted: false }), /historisé=non/);
});

test("completionLogLine ne lève pas sur un résultat incomplet", () => {
  const ligne = completionLogLine({ id: "x" }, {});
  assert.match(ligne, /statut=inconnu/);
  assert.match(ligne, /durée=—/);
});

test("failureLogLine porte la raison de l'échec", () => {
  assert.match(failureLogLine("abc", new Error("boum"), { durationMs: 5000 }), /\[job\] échec abc durée=5s raison=boum/);
});
