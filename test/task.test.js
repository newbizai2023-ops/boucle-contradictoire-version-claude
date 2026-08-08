import test from "node:test";
import assert from "node:assert/strict";
import { detectTask, writerPrompt, taskGuidance } from "../lib/task.js";

test("detectTask classe chaque domaine sur ses mots-clés", () => {
  assert.equal(detectTask("Analyse le code source de cette API"), "technical");
  assert.equal(detectTask("Quel est le prix de cette offre ?"), "financial");
  assert.equal(detectTask("Analyse ce contrat de prestation"), "legal");
  assert.equal(detectTask("Quelles sont les dernières annonces du secteur ?"), "current_research");
  assert.equal(detectTask("Compare ces deux méthodes de mesure"), "general_analysis");
});

test("detectTask est insensible à la casse et aux accents des mots-clés", () => {
  assert.equal(detectTask("ANALYSE DU BUDGET"), "financial");
  assert.equal(detectTask("Étude de conformité RGPD"), "legal");
});

test("detectTask applique les domaines dans l'ordre : le premier motif trouvé gagne", () => {
  // « code » (technique) et « budget » (financier) sont tous deux présents : le domaine technique
  // est testé en premier, il l'emporte. Comportement voulu, mais qu'un réordonnancement des
  // conditions casserait silencieusement.
  assert.equal(detectTask("Estime le budget de refonte du code"), "technical");
});

test("detectTask : faux positifs connus des motifs non ancrés", () => {
  // Les motifs sont recherchés en sous-chaîne, sans limite de mot. « trois » contient « roi »
  // (financier) et « rapide » contient « api » (technique). Ces deux cas sont ici *constatés*, pas
  // approuvés : ils documentent la limite actuelle pour qu'une correction future (ancrage sur des
  // limites de mots, \b) soit un changement délibéré et visible dans ce test.
  assert.equal(detectTask("Compare les trois offres du marché"), "financial");
  assert.equal(detectTask("Analyse rapide du marché européen"), "technical");
});

test("writerPrompt reprend le cadrage du domaine et la demande", () => {
  const prompt = writerPrompt("legal", "Analyse ce bail commercial");
  assert.ok(prompt.startsWith(taskGuidance.legal));
  assert.ok(prompt.includes("Analyse ce bail commercial"));
});

test("writerPrompt retombe sur le cadrage général pour un domaine inconnu", () => {
  // `task` vaut "manual" en sélection manuelle : aucune entrée ne lui correspond dans taskGuidance.
  for (const task of ["manual", undefined, "inexistant"]) {
    assert.ok(writerPrompt(task, "x").startsWith(taskGuidance.general_analysis));
  }
});
