// Les exports doivent conserver la valeur méthodologique de l'analyse, pas seulement sa prose.

import test from "node:test";
import assert from "node:assert/strict";
import { evidenceMarkdown, evidenceAnnex } from "../lib/report.js";

const RUN = {
  finalDocument: "# Résumé\n\nRenouvellement à 5 ans recommandé.",
  stopReason: "Arrêt sur stagnation : aucun progrès entre les cycles 1 et 2.",
  exploration: {
    dimensions: [{ axe: "Coût", enjeu: "TCO sur 5 ans", questions: ["Quel coût de support annuel ?"] }],
    angles_morts: ["La revente du parc amorti n'est pas évoquée."],
    perimetre_a_preciser: []
  },
  audits: [
    { cycle: 1, claims: [{ id: "C1", type: "fait", affirmation: "Ancienne", statut: "NON_VERIFIE", critique: true, sources: [] }] },
    { cycle: 2, claims: [
      { id: "C1", type: "fait", affirmation: "Le support prend fin en 2026 | cas limite", statut: "VERIFIE", critique: true, sources: ["https://a.fr"] },
      { id: "C2", type: "estimation", affirmation: "Le coût double", statut: "NON_VERIFIE", critique: false, sources: [] }
    ] }
  ],
  sources: [
    { url: "https://a.fr", accessible: true, sourceClass: "primary_official" },
    { url: "https://b.fr", accessible: false, sourceClass: "other", reason: "HTTP 404" },
    { url: "https://c.fr", accessible: null, sourceClass: "other", reason: "Budget atteint" }
  ],
  divergence: {
    desaccords: [{ sujet: "Horizon", cause: "horizon", position_a: "3 ans", position_b: "5 ans", question_a_trancher: "Quelle durée d'amortissement ?" }],
    accords: []
  },
  falsification: {
    verdict: "CONTREDIT",
    contradictions: [
      { affirmation: "Le support prend fin en 2026", source: "https://z.fr", confirmee: true, preuve: { relation: "SUPPORTS" } },
      { affirmation: "Objection faible", source: "https://y.fr", confirmee: false, preuve: { relation: "CITATION_INTROUVABLE" } }
    ],
    hypotheses_fragiles: [],
    perimetres_non_couverts: []
  },
  arbitration: {
    decision: "APPROUVE_AVEC_RESERVES",
    confiance: 40, confiance_annoncee: 95, confiance_preuves: 40, confiance_conclusion: 80,
    reserves: ["Périmètre France."], actions_requises: ["Remplacer la source morte."]
  }
};

test("le Markdown emporte tout le dossier, pas seulement le document", () => {
  const md = evidenceMarkdown(RUN);
  for (const attendu of [
    "# Boucle contradictoire", "Renouvellement à 5 ans",
    "## Raison d'arrêt", "## Cadrage préalable", "Quel coût de support annuel ?",
    "## Affirmations (dernier cycle)", "## Sources contrôlées",
    "## Désaccords avec l'analyse indépendante", "Quelle durée d'amortissement ?",
    "## Recherche adversariale — verdict CONTREDIT", "## Arbitrage"
  ]) {
    assert.ok(md.includes(attendu), `section manquante : ${attendu}`);
  }
});

test("le Markdown restitue l'état réel de chaque source et le statut de chaque affirmation", () => {
  const md = evidenceMarkdown(RUN);
  assert.match(md, /\| accessible \| primary_official \| https:\/\/a\.fr/);
  assert.match(md, /\| inaccessible \| other \| https:\/\/b\.fr \| HTTP 404 \|/);
  assert.match(md, /\| non contrôlée \| other \| https:\/\/c\.fr/);
  assert.match(md, /\| VERIFIE \| déterminante \| fait \|/);
  assert.match(md, /\| NON_VERIFIE \| — \| estimation \|/);
});

test("l'inventaire exporté est celui du dernier cycle, pas du premier", () => {
  const md = evidenceMarkdown(RUN);
  assert.ok(!md.includes("Ancienne"), "le cycle 1 ne doit pas écraser l'état final");
});

test("une barre verticale dans une affirmation ne casse pas le tableau Markdown", () => {
  assert.match(evidenceMarkdown(RUN), /Le support prend fin en 2026 \\\| cas limite/);
});

test("le plafonnement de confiance et la distinction confirmée/écartée restent visibles", () => {
  const md = evidenceMarkdown(RUN);
  assert.match(md, /Confiance annoncée avant plafonnement : 95\/100/);
  assert.match(md, /\*\*Confirmée\*\* — Le support prend fin en 2026/);
  assert.match(md, /Écartée — Objection faible/);
  assert.match(md, /CITATION_INTROUVABLE/);
});

test("l'annexe compacte couvre les mêmes objets, sans Markdown", () => {
  const annexe = evidenceAnnex(RUN);
  for (const attendu of ["AFFIRMATIONS (2)", "SOURCES (3)", "DÉSACCORDS", "RECHERCHE ADVERSARIALE — CONTREDIT", "ARBITRAGE"]) {
    assert.ok(annexe.includes(attendu), `bloc manquant : ${attendu}`);
  }
  // Le contenu peut légitimement contenir une barre verticale (elle figure dans une affirmation) :
  // ce qu'on vérifie est l'absence de *tableau*, c'est-à-dire de ligne construite en colonnes.
  assert.ok(!annexe.split("\n").some(ligne => ligne.trim().startsWith("|")), "l'annexe ne doit pas contenir de tableau Markdown");
});

test("un export reste possible sur une analyse incomplète ou interrompue", () => {
  // Une analyse en erreur est historisée avec ce qu'elle avait produit : l'export ne doit pas lever.
  for (const run of [{}, { finalDocument: "texte seul" }, { audits: [] }, undefined]) {
    assert.doesNotThrow(() => evidenceMarkdown(run));
    assert.doesNotThrow(() => evidenceAnnex(run));
  }
  assert.match(evidenceAnnex({}), /Aucun élément de dossier/);
});
