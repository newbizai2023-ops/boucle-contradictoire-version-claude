import test from "node:test";
import assert from "node:assert/strict";
import { detectTask, detectDomains, writerPrompt, taskGuidance } from "../lib/task.js";

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

test("sur une demande multi-domaine, le domaine dont l'erreur coûte le plus cher l'emporte", () => {
  // « code » (technique) et « budget » (financier) sont tous deux présents. L'ordre n'est plus celui
  // des conditions dans le fichier mais une priorité explicite : juridique, puis financier, puis
  // technique, puis actualité. Une « architecture financière » relevait auparavant du technique par
  // simple position du test — et déclenchait donc les mauvais modèles.
  assert.equal(detectTask("Estime le budget de refonte du code"), "financial");
  assert.equal(detectTask("Analyse de l'architecture financière"), "financial");
  assert.equal(detectTask("Quels sont les coûts de conformité RGPD ?"), "legal");
  assert.deepEqual(detectDomains("Quels sont les coûts de conformité RGPD ?"), ["legal", "financial"]);
});

test("les mots-clés sont cherchés sur des mots entiers, pas en sous-chaîne", () => {
  // Faux positifs corrigés : « trois » contenait « roi » (financier) et « rapide » contenait « api »
  // (technique). Anodins tant que le domaine ne pilotait que le choix des modèles, coûteux depuis
  // qu'il déclenche un second avis — soit deux appels de modèle de plus sur une classification
  // absurde.
  assert.equal(detectTask("Compare les trois offres du marché"), "general_analysis");
  assert.equal(detectTask("Analyse rapide du marché européen"), "general_analysis");
  assert.deepEqual(detectDomains("Compare les trois offres du marché"), []);
});

test("les mots-clés accentués et leurs pluriels restent reconnus", () => {
  // La frontière de mot ne peut pas être \b : celui-ci coupe sur les caractères accentués, si bien
  // que « coût » ou « coûts » échapperaient à un motif ancré naïvement.
  for (const demande of ["Quel est le coût du projet ?", "Compare les coûts annuels", "Analyse des économies possibles"]) {
    assert.equal(detectTask(demande), "financial", demande);
  }
  assert.equal(detectTask("Quelles annonces récentes ?"), "current_research");
  assert.equal(detectTask("Vérifie la conformité du règlement"), "legal");
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
