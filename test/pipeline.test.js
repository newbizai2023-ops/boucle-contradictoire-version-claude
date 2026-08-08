// Étapes conditionnelles du pipeline : cadrage, réfutation adversariale, second avis.

import test from "node:test";
import assert from "node:assert/strict";
import { normalizeExploration, exploreBrief, exploreSummary } from "../lib/explore.js";
import { shouldFalsify, normalizeFalsification, falsificationUrls, confirmedContradictions } from "../lib/falsify.js";
import { shouldDiversify, normalizeDivergence, divergenceBrief } from "../lib/diverge.js";

// ---------------------------------------------------------------------------
// EXPLORE
// ---------------------------------------------------------------------------

const CADRAGE = {
  dimensions: [
    { axe: "Coût", enjeu: "TCO sur 5 ans", questions: ["Quel est le prix d'un poste ?", "Quel est le coût de support annuel ?"] },
    { axe: "Sécurité", enjeu: "Fin de support", questions: ["Quelles versions restent supportées ?"] }
  ],
  angles_morts: ["La revente du parc amorti n'est pas évoquée."],
  perimetre_a_preciser: ["Juridiction et devise"]
};

test("normalizeExploration borne le cadrage et écarte les entrées vides", () => {
  const cadrage = normalizeExploration({
    dimensions: [
      ...Array.from({ length: 9 }, (_, i) => ({ axe: `Axe ${i}`, questions: ["q1", "q2", "q3", "q4", "q5"] })),
      { axe: "   ", questions: [] }
    ],
    angles_morts: ["a", "", null],
    perimetre_a_preciser: "pas un tableau"
  });
  assert.equal(cadrage.dimensions.length, 6, "six dimensions au maximum");
  assert.equal(cadrage.dimensions[0].questions.length, 3, "trois questions au maximum");
  assert.deepEqual(cadrage.angles_morts, ["a"]);
  assert.deepEqual(cadrage.perimetre_a_preciser, []);
});

test("un cadrage sans dimension exploitable ne s'impose pas au rédacteur", () => {
  // Mieux vaut aucun cadrage qu'un cadrage vide : le rédacteur travaille alors comme avant.
  for (const brut of [{}, null, undefined, { dimensions: [] }, { dimensions: [{ axe: "", questions: [] }] }]) {
    assert.equal(normalizeExploration(brut), null, JSON.stringify(brut));
  }
});

test("exploreBrief formule une contrainte de couverture, pas un plan à recopier", () => {
  const brief = exploreBrief(normalizeExploration(CADRAGE));
  assert.match(brief, /dimensions à couvrir ou à écarter explicitement/);
  assert.match(brief, /Quel est le prix d'un poste \?/);
  assert.match(brief, /ANGLES MORTS SIGNALÉS/);
  assert.match(brief, /PÉRIMÈTRE NON TRANCHÉ/);
  assert.match(brief, /il ne préjuge d'aucune conclusion/);
  assert.equal(exploreBrief(null), "", "aucun cadrage, aucun bloc");
});

test("exploreSummary reste lisible même sans cadrage", () => {
  assert.match(exploreSummary(normalizeExploration(CADRAGE)), /2 dimension\(s\), 3 question\(s\)/);
  assert.match(exploreSummary(null), /indisponible/);
});

// ---------------------------------------------------------------------------
// FALSIFY
// ---------------------------------------------------------------------------

const claim = (affirmation, extra = {}) => ({ affirmation, statut: "VERIFIE", critique: false, sources: [], ...extra });
const sourcePrimaire = { url: "https://x.gouv.fr/a", accessible: true, sourceClass: "primary_official" };

test("la réfutation se déclenche sur une anomalie sévère subsistante", () => {
  const decision = shouldFalsify({ audit: { score_global: 95, anomalies: [{ gravite: "élevée" }] }, sources: [sourcePrimaire], minScore: 90 });
  assert.equal(decision.run, true);
  assert.deepEqual(decision.motifs, ["1 anomalie(s) sévère(s) subsistante(s)"]);
});

test("la réfutation se déclenche sur une affirmation déterminante non établie", () => {
  const decision = shouldFalsify({
    audit: { score_global: 95, anomalies: [] },
    claims: [claim("Porte la conclusion", { critique: true, statut: "NON_VERIFIE" })],
    sources: [sourcePrimaire],
    minScore: 90
  });
  assert.equal(decision.run, true);
  assert.deepEqual(decision.motifs, ["1 affirmation(s) déterminante(s) non vérifiée(s)"]);
});

test("un excellent score sans aucune source primaire joignable déclenche la réfutation", () => {
  // Le cas le plus traître : un document convaincant que rien n'atteste.
  const decision = shouldFalsify({
    audit: { score_global: 98, anomalies: [] },
    sources: [{ url: "https://blog.example/a", accessible: true, sourceClass: "other" }, { ...sourcePrimaire, accessible: false }],
    minScore: 90
  });
  assert.equal(decision.run, true);
  assert.deepEqual(decision.motifs, ["score au seuil sans aucune source primaire joignable"]);
});

test("une boucle qui a renoncé déclenche la réfutation", () => {
  const decision = shouldFalsify({ audit: { score_global: 95, anomalies: [] }, sources: [sourcePrimaire], minScore: 90, stagnated: true });
  assert.equal(decision.run, true);
  assert.deepEqual(decision.motifs, ["la boucle s'est arrêtée sans converger"]);
});

test("aucune réfutation quand rien ne la justifie : l'appel n'est pas payé", () => {
  const decision = shouldFalsify({
    audit: { score_global: 95, anomalies: [{ gravite: "faible" }] },
    claims: [claim("Établie", { critique: true })],
    sources: [sourcePrimaire],
    minScore: 90
  });
  assert.equal(decision.run, false);
  assert.deepEqual(decision.motifs, []);
});

test("une objection sans URL n'est pas retenue comme contradiction", () => {
  // Sans ce filtre, l'étape adversariale deviendrait un générateur d'objections invérifiables —
  // exactement ce qu'elle est censée remplacer.
  const falsification = normalizeFalsification({
    verdict: "CONTREDIT",
    contradictions: [
      { affirmation: "A", source: "https://preuve.fr/x", gravite: "critique" },
      { affirmation: "B", source: "d'après mes connaissances", gravite: "critique" },
      { affirmation: "C", gravite: "critique" }
    ],
    donnees_plus_recentes: [{ sujet: "prix", source: "pas une url" }]
  });
  assert.equal(falsification.contradictions.length, 1);
  assert.equal(falsification.donnees_plus_recentes.length, 0);
  assert.deepEqual(falsificationUrls(falsification), ["https://preuve.fr/x"]);
});

test("un verdict inintelligible retombe sur CONFIRME plutôt que d'inventer une réfutation", () => {
  assert.equal(normalizeFalsification({ verdict: "PEUT-ÊTRE" }).verdict, "CONFIRME");
  assert.equal(normalizeFalsification({ verdict: "contredit" }).verdict, "CONTREDIT");
  assert.equal(normalizeFalsification(null), null);
});

test("seules comptent les contradictions graves dont la source répond vraiment", () => {
  const falsification = normalizeFalsification({
    verdict: "CONTREDIT",
    contradictions: [
      { affirmation: "A", source: "https://joignable.fr/x", gravite: "critique" },
      { affirmation: "B", source: "https://morte.fr/y", gravite: "critique" },
      { affirmation: "C", source: "https://joignable.fr/x", gravite: "faible" }
    ]
  });
  const sources = [
    { url: "https://joignable.fr/x", accessible: true },
    { url: "https://morte.fr/y", accessible: false }
  ];
  const confirmees = confirmedContradictions(falsification, sources);
  assert.deepEqual(confirmees.map(c => c.affirmation), ["A"], "ni la source morte, ni la contradiction mineure");
  assert.deepEqual(confirmedContradictions(null, sources), []);
  assert.deepEqual(confirmedContradictions(falsification, []), [], "sans contrôle de source, rien n'est confirmé");
});

// ---------------------------------------------------------------------------
// DIVERSIFY
// ---------------------------------------------------------------------------

test("le second avis est automatique là où une erreur se paie cher", () => {
  assert.equal(shouldDiversify({ task: "legal" }).run, true);
  assert.equal(shouldDiversify({ task: "financial" }).run, true);
  assert.equal(shouldDiversify({ task: "general_analysis" }).run, false);
  assert.equal(shouldDiversify({ task: "technical" }).run, false);
});

test("le choix de l'utilisateur prime sur le déclenchement automatique, dans les deux sens", () => {
  assert.equal(shouldDiversify({ task: "general_analysis", requested: true }).run, true);
  assert.equal(shouldDiversify({ task: "legal", requested: false }).run, false);
  assert.equal(shouldDiversify({ task: "legal", requested: undefined }).run, true);
});

test("normalizeDivergence compte les accords non étayés plutôt que de les croire", () => {
  // Deux modèles d'accord et aucune source : c'est le consensus le plus dangereux, parce qu'il
  // inspire confiance. Le décompte est calculé, pas demandé au modèle.
  const divergence = normalizeDivergence({
    accords: [{ sujet: "Le coût baisse", etaye: false }, { sujet: "Le support s'arrête", etaye: true }],
    desaccords: [{ sujet: "Horizon", position_a: "3 ans", position_b: "5 ans", cause: "HORIZON", question_a_trancher: "Quelle durée d'amortissement ?" }],
    incertitudes: ["Prix 2027 inconnu"]
  });
  assert.equal(divergence.accordsNonEtayes, 1);
  assert.equal(divergence.desaccords[0].cause, "horizon", "la cause est normalisée");
  assert.equal(divergence.accords.length, 2);
});

test("une cause de divergence inconnue retombe sur « autre » sans être perdue", () => {
  const divergence = normalizeDivergence({ desaccords: [{ sujet: "X", cause: "vibes" }] });
  assert.equal(divergence.desaccords[0].cause, "autre");
});

test("normalizeDivergence renvoie null quand il n'y a rien à comparer", () => {
  for (const brut of [null, undefined, {}, { accords: [], desaccords: [] }]) {
    assert.equal(normalizeDivergence(brut), null);
  }
});

test("divergenceBrief présente les désaccords comme des questions à instruire", () => {
  const brief = divergenceBrief(normalizeDivergence({
    accords: [{ sujet: "Le coût baisse", etaye: false }],
    desaccords: [{ sujet: "Horizon", position_a: "3 ans", position_b: "5 ans", cause: "horizon", question_a_trancher: "Quelle durée d'amortissement ?" }]
  }));
  assert.match(brief, /DÉSACCORDS AVEC UNE ANALYSE INDÉPENDANTE/);
  assert.match(brief, /À trancher : Quelle durée d'amortissement \?/);
  assert.match(brief, /ACCORDS NON ÉTAYÉS/);
  assert.match(brief, /Un accord n'est pas une preuve/);
  assert.equal(divergenceBrief(null), "");
});
