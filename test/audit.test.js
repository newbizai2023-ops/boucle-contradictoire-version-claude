import test from "node:test";
import assert from "node:assert/strict";
import { isSevere, auditDecision, shouldStopAfterAudit } from "../lib/audit.js";

/** Audit qui satisfait tous les critères d'arrêt : chaque test n'en dégrade qu'un à la fois. */
const auditConforme = {
  score_global: 95,
  decision: "VALIDER",
  anomalies: [{ gravite: "faible", probleme: "formulation" }],
  sources_non_verifiees: [],
  nouveau_cycle_requis: false
};

test("isSevere reconnaît les gravités bloquantes quelle que soit leur orthographe", () => {
  // Le contrat JSON demande « elevee » sans accent, mais les modèles écrivent « élevée » —
  // l'orthographe qu'emploie le prompt d'auditeur lui-même. La comparaison par simple mise en
  // minuscules laissait passer ces anomalies comme non bloquantes.
  for (const gravite of ["critique", "CRITIQUE", "Critique", "elevee", "élevée", "Élevée", "élevé", " elevee "]) {
    assert.ok(isSevere(gravite), `${JSON.stringify(gravite)} devrait être bloquante`);
  }
});

test("isSevere laisse passer les gravités non bloquantes", () => {
  for (const gravite of ["moyenne", "faible", "", null, undefined, "inconnue"]) {
    assert.ok(!isSevere(gravite), `${JSON.stringify(gravite)} ne devrait pas être bloquante`);
  }
});

test("auditDecision interprète les deux verdicts du contrat JSON", () => {
  assert.equal(auditDecision({ decision: "VALIDER" }), "valider");
  assert.equal(auditDecision({ decision: "valider" }), "valider");
  assert.equal(auditDecision({ decision: "VALIDATION" }), "valider");
  assert.equal(auditDecision({ decision: "CORRIGER" }), "corriger");
  assert.equal(auditDecision({ decision: "corrigé" }), "corriger");
  assert.equal(auditDecision({ decision: "CORRECTION" }), "corriger");
});

test("auditDecision reste indéterminée sur un champ absent ou inintelligible", () => {
  for (const audit of [{}, undefined, { decision: "" }, { decision: null }, { decision: "peut-être" }]) {
    assert.equal(auditDecision(audit), "indeterminee");
  }
});

test("un audit conforme autorise l'arrêt de la boucle", () => {
  const verdict = shouldStopAfterAudit(auditConforme, 90);
  assert.equal(verdict.stop, true);
  assert.deepEqual(verdict.motifs, []);
});

test("un verdict CORRIGER empêche l'arrêt malgré des critères numériques satisfaits", () => {
  // Régression 1.4.0 : `decision` était demandé dans le contrat JSON, produit par le modèle,
  // affiché dans le fil de suivi — et ignoré par la condition d'arrêt. Un auditeur concluant
  // CORRIGER avec un score de 95 et aucune anomalie sévère voyait la boucle s'arrêter contre lui.
  const verdict = shouldStopAfterAudit({ ...auditConforme, decision: "CORRIGER" }, 90);
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["l'auditeur conclut à CORRIGER"]);
});

test("une anomalie élevée accentuée empêche l'arrêt", () => {
  // Même bug de fond que le précédent : un signal d'audit perdu faute de normalisation.
  const verdict = shouldStopAfterAudit(
    { ...auditConforme, anomalies: [{ gravite: "élevée", probleme: "affirmation non étayée" }] },
    90
  );
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["1 anomalie(s) critique(s) ou élevée(s)"]);
});

test("un score sous le seuil empêche l'arrêt", () => {
  const verdict = shouldStopAfterAudit({ ...auditConforme, score_global: 72 }, 90);
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["score 72/100 inférieur au seuil de 90"]);
});

test("une source essentielle non vérifiée empêche l'arrêt", () => {
  const verdict = shouldStopAfterAudit({ ...auditConforme, sources_non_verifiees: ["https://x.fr"] }, 90);
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["1 source(s) essentielle(s) non vérifiée(s)"]);
});

test("une demande explicite de nouveau cycle empêche l'arrêt", () => {
  const verdict = shouldStopAfterAudit({ ...auditConforme, nouveau_cycle_requis: true }, 90);
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["l'auditeur demande un nouveau cycle"]);
});

test("les motifs sont cumulés, pas réduits au premier rencontré", () => {
  const verdict = shouldStopAfterAudit(
    {
      score_global: 40,
      decision: "CORRIGER",
      anomalies: [{ gravite: "critique" }, { gravite: "élevée" }, { gravite: "faible" }],
      sources_non_verifiees: ["https://a.fr", "https://b.fr"],
      nouveau_cycle_requis: true
    },
    90
  );
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, [
    "score 40/100 inférieur au seuil de 90",
    "2 anomalie(s) critique(s) ou élevée(s)",
    "2 source(s) essentielle(s) non vérifiée(s)",
    "l'auditeur demande un nouveau cycle",
    "l'auditeur conclut à CORRIGER"
  ]);
});

test("une décision indéterminée ne bloque pas à elle seule", () => {
  // Un modèle omettant `decision` ferait sinon consommer tous les cycles à chaque analyse, en
  // silence : le champ manquant doit rester neutre, pas devenir un veto implicite.
  for (const decision of [undefined, "", "peut-être"]) {
    const verdict = shouldStopAfterAudit({ ...auditConforme, decision }, 90);
    assert.equal(verdict.stop, true, `decision=${JSON.stringify(decision)} ne devrait pas bloquer`);
    assert.equal(verdict.decision, "indeterminee");
  }
});

test("un audit vide ou absent ne fait pas planter la condition d'arrêt", () => {
  // parseJson peut renvoyer un objet sans les champs attendus : la boucle doit alors poursuivre,
  // jamais lever une exception qui ferait perdre toute l'analyse.
  for (const audit of [{}, undefined, null, { anomalies: null, sources_non_verifiees: null }]) {
    const verdict = shouldStopAfterAudit(audit, 90);
    assert.equal(verdict.stop, false);
    assert.ok(verdict.motifs.length > 0);
  }
});

test("le seuil de score est respecté à l'égalité", () => {
  assert.equal(shouldStopAfterAudit({ ...auditConforme, score_global: 90 }, 90).stop, true);
  assert.equal(shouldStopAfterAudit({ ...auditConforme, score_global: 89 }, 90).stop, false);
});
