import test from "node:test";
import assert from "node:assert/strict";
import {
  isSevere,
  auditDecision,
  shouldStopAfterAudit,
  unreachableCitedSources,
  stagnationBetween,
  normalizeArbitration
} from "../lib/audit.js";

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

// ---------------------------------------------------------------------------
// Vérité terrain des sources
// ---------------------------------------------------------------------------

const DOCUMENT_CITANT = "Voir https://vivante.example/a et https://morte.example/b pour le détail.";
const SOURCES_MESUREES = [
  { url: "https://vivante.example/a", accessible: true },
  { url: "https://morte.example/b", accessible: false, reason: "HTTP 404" }
];

test("une source citée et mesurée injoignable empêche l'arrêt, même si l'auditeur ne signale rien", () => {
  // Le cœur du correctif : la condition d'arrêt ne lisait que `sources_non_verifiees`, une liste
  // écrite par le modèle. Un auditeur omettant le champ laissait valider un document truffé de
  // liens morts, alors que Firecrawl avait mesuré leur inaccessibilité.
  const verdict = shouldStopAfterAudit(auditConforme, 90, { sources: SOURCES_MESUREES, document: DOCUMENT_CITANT });
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["1 source(s) citée(s) et injoignable(s) au contrôle"]);
  assert.deepEqual(verdict.injoignables, ["https://morte.example/b"]);
});

test("une source injoignable retirée du document ne bloque plus la validation", () => {
  // Condition de convergence : le cache des sources n'oublie jamais une URL contrôlée. Sans le
  // filtre sur les URL réellement citées, un lien mort supprimé par une correction bloquerait la
  // boucle indéfiniment — la correction attendue deviendrait impossible à satisfaire.
  const verdict = shouldStopAfterAudit(auditConforme, 90, {
    sources: SOURCES_MESUREES,
    document: "Le lien mort a été retiré, seul https://vivante.example/a subsiste."
  });
  assert.equal(verdict.stop, true);
  assert.deepEqual(verdict.motifs, []);
});

test("une source non contrôlée ne compte pas comme un échec de contrôle", () => {
  // `accessible: null` = Firecrawl désactivé ou budget épuisé. On ne peut pas reprocher au
  // document une vérification qui n'a pas eu lieu, sinon désactiver Firecrawl condamnerait toute
  // analyse à consommer tous ses cycles.
  const verdict = shouldStopAfterAudit(auditConforme, 90, {
    sources: [{ url: "https://morte.example/b", accessible: null, reason: "Vérification Firecrawl désactivée" }],
    document: DOCUMENT_CITANT
  });
  assert.equal(verdict.stop, true);
});

test("unreachableCitedSources ignore les URL absentes du document et tolère les entrées vides", () => {
  assert.deepEqual(unreachableCitedSources(DOCUMENT_CITANT, SOURCES_MESUREES), ["https://morte.example/b"]);
  assert.deepEqual(unreachableCitedSources("", SOURCES_MESUREES), []);
  assert.deepEqual(unreachableCitedSources(DOCUMENT_CITANT, []), []);
  assert.deepEqual(unreachableCitedSources(DOCUMENT_CITANT, null), []);
  assert.doesNotThrow(() => unreachableCitedSources(undefined, [null, undefined, {}]));
});

test("la citation est reconnue au-delà des douze premières URL du document", () => {
  // extractUrls borne les *candidates à la vérification* à douze pour maîtriser le coût Firecrawl.
  // La condition d'arrêt, elle, doit voir tous les liens du document : sinon un lien mort placé en
  // fin de bibliographie échappe au contrôle.
  const document = Array.from({ length: 20 }, (_, index) => `https://exemple.fr/${index}`).join(" ");
  const sources = [{ url: "https://exemple.fr/19", accessible: false }];
  assert.deepEqual(unreachableCitedSources(document, sources), ["https://exemple.fr/19"]);
});

test("une affirmation déterminante non établie empêche l'arrêt", () => {
  // Le score global dit qu'un document est bon ; l'inventaire dit *ce qui* n'est pas démontré. Une
  // conclusion ne peut pas être validée tant qu'une affirmation dont elle dépend reste en l'air.
  const verdict = shouldStopAfterAudit(auditConforme, 90, {
    claims: [
      { affirmation: "Porte la conclusion", critique: true, statut: "NON_VERIFIE" },
      { affirmation: "Établie", critique: true, statut: "VERIFIE" },
      { affirmation: "Accessoire", critique: false, statut: "NON_VERIFIE" }
    ]
  });
  assert.equal(verdict.stop, false);
  assert.deepEqual(verdict.motifs, ["1 affirmation(s) déterminante(s) non vérifiée(s)"]);
  assert.deepEqual(verdict.claimsCritiques.map(claim => claim.affirmation), ["Porte la conclusion"]);
});

test("un inventaire entièrement établi n'ajoute aucun motif", () => {
  const verdict = shouldStopAfterAudit(auditConforme, 90, {
    claims: [{ affirmation: "Établie", critique: true, statut: "VERIFIE" }]
  });
  assert.equal(verdict.stop, true);
  assert.deepEqual(verdict.motifs, []);
});

// ---------------------------------------------------------------------------
// Stagnation
// ---------------------------------------------------------------------------

const audit = (score, severes) => ({
  score_global: score,
  anomalies: Array.from({ length: severes }, () => ({ gravite: "critique" }))
});

test("stagnationBetween ne signale rien tant qu'une dimension progresse", () => {
  assert.equal(stagnationBetween(audit(60, 2), audit(70, 2)), null, "le score progresse");
  assert.equal(stagnationBetween(audit(60, 2), audit(60, 1)), null, "les anomalies sévères reculent");
  assert.equal(stagnationBetween(audit(60, 3), audit(55, 1)), null, "un score en baisse reste un progrès si les anomalies reculent");
});

test("stagnationBetween signale deux cycles sans le moindre progrès", () => {
  assert.deepEqual(stagnationBetween(audit(72, 2), audit(72, 2)), {
    avant: { score: 72, severes: 2, critiques: 0 },
    apres: { score: 72, severes: 2, critiques: 0 }
  });
  assert.ok(stagnationBetween(audit(72, 2), audit(68, 3)), "régression sur toutes les dimensions");
});

test("résoudre des affirmations déterminantes est un progrès, même à score constant", () => {
  // Régression introduite en 1.7.0 : depuis que les affirmations déterminantes non établies bloquent
  // la validation, un cycle qui en résout trois sans faire bouger le score fait le travail utile.
  // L'arrêter là aurait gaspillé exactement ce qu'on cherchait à obtenir.
  const avecClaims = (score, critiques) => ({
    ...audit(score, 0),
    claims: Array.from({ length: critiques }, (_, index) => ({ affirmation: `A${index}`, critique: true, statut: "NON_VERIFIE" }))
  });
  assert.equal(stagnationBetween(avecClaims(91, 3), avecClaims(91, 0)), null, "trois affirmations établies");
  assert.ok(stagnationBetween(avecClaims(91, 3), avecClaims(91, 3)), "aucune des trois dimensions ne progresse");
});

test("stagnationBetween reste muet faute de deux cycles à comparer", () => {
  assert.equal(stagnationBetween(undefined, audit(72, 2)), null);
  assert.equal(stagnationBetween(audit(72, 2), undefined), null);
  assert.doesNotThrow(() => stagnationBetween({}, {}));
});

// ---------------------------------------------------------------------------
// Confiances de l'arbitrage
// ---------------------------------------------------------------------------

test("normalizeArbitration conserve deux dimensions de confiance indépendantes", () => {
  // Le cas que la confiance unique rendait inexprimable : base factuelle solide, recommandation
  // dépendante d'hypothèses métier.
  const arbitrage = normalizeArbitration({ decision: "APPROUVE_AVEC_RESERVES", confiance: 60, confiance_preuves: 92, confiance_conclusion: 60 });
  assert.equal(arbitrage.confiance_preuves, 92);
  assert.equal(arbitrage.confiance_conclusion, 60);
  assert.equal(arbitrage.confiance, 60);
  assert.ok(!("confiance_annoncee" in arbitrage), "aucun plafonnement ne s'est appliqué");
});

test("la confiance globale est plafonnée par la plus faible dimension, sans effacer la valeur annoncée", () => {
  const arbitrage = normalizeArbitration({ confiance: 95, confiance_preuves: 40, confiance_conclusion: 80 });
  assert.equal(arbitrage.confiance, 40, "on ne peut pas être plus sûr que ce qui soutient la conclusion");
  assert.equal(arbitrage.confiance_annoncee, 95, "l'ajustement doit rester visible");
});

test("normalizeArbitration déduit la confiance globale quand le modèle l'omet", () => {
  assert.equal(normalizeArbitration({ confiance_preuves: 70, confiance_conclusion: 55 }).confiance, 55);
  assert.equal(normalizeArbitration({ confiance_preuves: 70 }).confiance, 70, "une seule dimension suffit à plafonner");
});

test("normalizeArbitration borne les valeurs aberrantes et tolère un arbitrage incomplet", () => {
  assert.equal(normalizeArbitration({ confiance: 250, confiance_preuves: 250 }).confiance, 100);
  assert.equal(normalizeArbitration({ confiance_preuves: -30, confiance_conclusion: 40 }).confiance, 0);
  assert.equal(normalizeArbitration({ confiance: "82" }).confiance, 82, "un entier transmis en chaîne reste exploitable");
  assert.deepEqual(normalizeArbitration({ decision: "REJETE" }), { decision: "REJETE" });
  assert.equal(normalizeArbitration({ confiance: "élevée" }).confiance, "élevée", "une valeur inintelligible est laissée telle quelle");
  assert.equal(normalizeArbitration(null), null);
});
