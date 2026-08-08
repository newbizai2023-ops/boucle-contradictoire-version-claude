// Validation opposable des relations affirmation → source et contradiction → source.

import test from "node:test";
import assert from "node:assert/strict";
import { citationPresente, validateEvidence, validateContradiction, validateClaims, validateClaimSources, downgradedClaims, RELATIONS } from "../lib/evidence.js";

const PAGE = "Microsoft annonce que le support de Windows 10 prend fin le 14 octobre 2025 pour les éditions Famille et Professionnel.";
const SOURCES = [
  { url: "https://vivante.fr/a", accessible: true, markdown: PAGE },
  { url: "https://morte.fr/b", accessible: false, reason: "HTTP 404" },
  { url: "https://inconnue.fr/c", accessible: null, reason: "Vérification Firecrawl désactivée" }
];

// ---------------------------------------------------------------------------
// Présence de la citation
// ---------------------------------------------------------------------------

test("une citation littérale est reconnue, accents et ponctuation compris", () => {
  assert.ok(citationPresente("le support de Windows 10 prend fin le 14 octobre 2025", PAGE));
  assert.ok(citationPresente("LE SUPPORT DE WINDOWS 10 PREND FIN LE 14 OCTOBRE 2025 !", PAGE));
});

test("une reformulation fidèle passe, une citation inventée non", () => {
  // Un modèle recopie rarement au caractère près : il abrège et recompose. Le recouvrement lexical
  // laisse donc passer la reformulation fidèle, sans ouvrir la porte à une citation fabriquée.
  assert.ok(citationPresente("support Windows 10 fin octobre 2025 éditions Famille", PAGE), "reformulation fidèle");
  assert.ok(!citationPresente("La garantie constructeur couvre cinq années pleines partout", PAGE), "citation inventée");
});

test("une citation trop courte pour être vérifiable n'est pas accordée", () => {
  // Deux mots significatifs se retrouvent dans n'importe quelle page du même thème : accorder la
  // relation reviendrait à revenir au contrôle qu'on remplace.
  assert.ok(!citationPresente("le support", PAGE));
  assert.ok(!citationPresente("", PAGE));
  assert.ok(!citationPresente("support Windows 10 prend fin", ""));
});

// ---------------------------------------------------------------------------
// Relation contradiction → source
// ---------------------------------------------------------------------------

test("chaque échec de validation porte sa raison, distincte des autres", () => {
  assert.equal(validateEvidence({ url: "https://absente.fr/z", extrait: "x" }, SOURCES).relation, RELATIONS.SOURCE_ABSENTE);
  assert.equal(validateEvidence({ url: "https://morte.fr/b", extrait: "x" }, SOURCES).relation, RELATIONS.SOURCE_INJOIGNABLE);
  assert.equal(validateEvidence({ url: "https://inconnue.fr/c", extrait: "x" }, SOURCES).relation, RELATIONS.SOURCE_INJOIGNABLE, "non contrôlée = non probante");
  assert.equal(validateEvidence({ url: "https://vivante.fr/a" }, SOURCES).relation, RELATIONS.CITATION_ABSENTE);
  assert.equal(validateEvidence({ url: "https://vivante.fr/a", extrait: "La garantie couvre cinq années pleines partout" }, SOURCES).relation, RELATIONS.CITATION_INTROUVABLE);
  assert.equal(validateEvidence({ url: "https://vivante.fr/a", extrait: "le support de Windows 10 prend fin le 14 octobre 2025" }, SOURCES).relation, RELATIONS.SUPPORTS);
});

test("une contradiction n'est confirmée que si sa citation existe dans la page", () => {
  // Le cœur du correctif : une URL qui répond ne suffisait plus à faire d'une objection une
  // contradiction établie.
  const vraie = validateContradiction({ source: "https://vivante.fr/a", extrait: "support de Windows 10 prend fin le 14 octobre 2025", gravite: "critique" }, SOURCES);
  const inventee = validateContradiction({ source: "https://vivante.fr/a", extrait: "Le support est prolongé jusqu'en 2030 sans condition", gravite: "critique" }, SOURCES);
  assert.equal(vraie.confirmee, true);
  assert.equal(inventee.confirmee, false);
  assert.equal(inventee.preuve.relation, RELATIONS.CITATION_INTROUVABLE);
  assert.match(inventee.preuve.motif, /ne se retrouve pas/);
});

test("validateEvidence tolère des entrées vides sans lever", () => {
  assert.doesNotThrow(() => validateEvidence({}, []));
  assert.doesNotThrow(() => validateEvidence({ url: null, extrait: null }, null));
  assert.equal(validateContradiction(undefined, SOURCES).confirmee, false);
});

// ---------------------------------------------------------------------------
// Rétrogradation des affirmations
// ---------------------------------------------------------------------------

const claim = (extra = {}) => ({ affirmation: "Le support prend fin en 2025.", statut: "VERIFIE", critique: true, sources: ["https://vivante.fr/a"], ...extra });

test("une affirmation vérifiée sans source rattachée est rétrogradée", () => {
  const resultat = validateClaimSources(claim({ sources: [] }), SOURCES);
  assert.equal(resultat.statut, "NON_VERIFIE");
  assert.match(resultat.retrogradation, /aucune source/);
});

test("une affirmation dont les sources sont inconnues du dossier est rétrogradée", () => {
  // Le cas le plus insidieux : l'auditeur cite une URL plausible que personne n'a contrôlée.
  const resultat = validateClaimSources(claim({ sources: ["https://jamais-controlee.fr/x"] }), SOURCES);
  assert.equal(resultat.statut, "NON_VERIFIE");
  assert.match(resultat.retrogradation, /ne figure dans le dossier/);
});

test("une affirmation dont aucune source n'a pu être extraite est rétrogradée", () => {
  const resultat = validateClaimSources(claim({ sources: ["https://morte.fr/b", "https://inconnue.fr/c"] }), SOURCES);
  assert.equal(resultat.statut, "NON_VERIFIE");
  assert.match(resultat.retrogradation, /n'a pu être extraite/);
});

test("une affirmation adossée à au moins une source joignable est conservée", () => {
  const resultat = validateClaimSources(claim({ sources: ["https://morte.fr/b", "https://vivante.fr/a"] }), SOURCES);
  assert.equal(resultat.statut, "VERIFIE");
  assert.deepEqual(resultat.sourcesJoignables, ["https://vivante.fr/a"]);
  assert.ok(!resultat.retrogradation);
});

test("le code retire un statut mais n'en accorde jamais", () => {
  // Une affirmation non vérifiée reste non vérifiée même adossée à une source parfaite : établir un
  // fait demande de lire la page, ce que ces règles ne font pas.
  const resultat = validateClaimSources(claim({ statut: "NON_VERIFIE" }), SOURCES);
  assert.equal(resultat.statut, "NON_VERIFIE");
  assert.equal(validateClaimSources(claim({ statut: "CONTREDIT" }), SOURCES).statut, "CONTREDIT");
});

test("validateClaims applique la règle à l'inventaire et le décompte reste lisible", () => {
  const claims = validateClaims([claim(), claim({ sources: [] }), claim({ statut: "NON_VERIFIE" })], SOURCES);
  assert.deepEqual(claims.map(c => c.statut), ["VERIFIE", "NON_VERIFIE", "NON_VERIFIE"]);
  assert.equal(downgradedClaims(claims).length, 1, "seule la rétrogradation compte, pas le statut initial");
  assert.deepEqual(validateClaims(), []);
});
