import test from "node:test";
import assert from "node:assert/strict";
import { normalizeClaims, unverifiedCriticalClaims, claimRegressions, claimStats, claimsBrief, claimKey } from "../lib/claims.js";

const claim = (affirmation, extra = {}) => ({ id: "CLAIM-001", type: "fait", affirmation, statut: "VERIFIE", critique: false, sources: [], ...extra });

test("normalizeClaims typé et borné, quelle que soit la forme reçue", () => {
  const claims = normalizeClaims({
    claims: [
      { id: "C1", type: "Fait", affirmation: "Le support prend fin en 2026.", statut: "vérifié", critique: true, sources: ["https://a.fr"] },
      { type: "RECOMMANDATION", affirmation: "Renouveler à 5 ans.", statut: "NON_VERIFIE" }
    ]
  });
  assert.equal(claims.length, 2);
  assert.deepEqual(claims[0], { id: "C1", type: "fait", affirmation: "Le support prend fin en 2026.", statut: "VERIFIE", critique: true, sources: ["https://a.fr"] });
  assert.equal(claims[1].id, "CLAIM-002", "un identifiant est attribué quand le modèle l'omet");
  assert.equal(claims[1].type, "recommandation");
  assert.equal(claims[1].critique, false, "critique n'est vrai que s'il vaut explicitement true");
});

test("un statut absent ou inintelligible vaut NON_VERIFIE, jamais VERIFIE", () => {
  // C'est la faille que cet inventaire est censé fermer : un modèle qui omet le champ ne doit pas
  // obtenir gratuitement le bénéfice du doute sur une affirmation déterminante.
  for (const statut of [undefined, "", null, "peut-être", "en cours"]) {
    assert.equal(normalizeClaims({ claims: [claim("A", { statut })] })[0].statut, "NON_VERIFIE", `statut=${JSON.stringify(statut)}`);
  }
  assert.equal(normalizeClaims({ claims: [claim("A", { statut: "CONTREDITE" })] })[0].statut, "CONTREDIT");
  assert.equal(normalizeClaims({ claims: [claim("A", { statut: "Vérifiée" })] })[0].statut, "VERIFIE");
});

test("normalizeClaims tolère un audit sans inventaire et écarte les entrées vides", () => {
  for (const audit of [{}, undefined, null, { claims: "pas un tableau" }]) {
    assert.deepEqual(normalizeClaims(audit), []);
  }
  assert.deepEqual(normalizeClaims({ claims: [{ affirmation: "   " }, { statut: "VERIFIE" }] }), []);
});

test("normalizeClaims borne l'inventaire", () => {
  const claims = normalizeClaims({ claims: Array.from({ length: 80 }, (_, i) => claim(`Affirmation ${i}`)) });
  assert.equal(claims.length, 40);
});

test("unverifiedCriticalClaims ne retient que ce qui porte la conclusion", () => {
  const claims = [
    claim("Déterminante et établie", { critique: true, statut: "VERIFIE" }),
    claim("Déterminante et non établie", { critique: true, statut: "NON_VERIFIE" }),
    claim("Déterminante et démentie", { critique: true, statut: "CONTREDIT" }),
    claim("Accessoire et non établie", { critique: false, statut: "NON_VERIFIE" })
  ];
  assert.deepEqual(unverifiedCriticalClaims(claims).map(c => c.affirmation), ["Déterminante et non établie", "Déterminante et démentie"]);
  assert.deepEqual(unverifiedCriticalClaims([]), []);
});

test("claimRegressions repère ce que la réécriture a fait perdre", () => {
  // La correction réécrit le document intégralement : sans ce rapprochement, un fait établi au
  // cycle 1 pouvait disparaître au cycle 2 sans que rien ne le signale.
  const avant = [claim("Le support prend fin en 2026."), claim("Le parc compte 100 postes."), claim("Non établie", { statut: "NON_VERIFIE" })];
  const apres = [claim("Le support prend fin en 2026."), claim("Le parc compte 100 postes.", { statut: "CONTREDIT" })];
  assert.deepEqual(claimRegressions(avant, apres), [
    { affirmation: "Le parc compte 100 postes.", avant: "VERIFIE", apres: "CONTREDIT" }
  ]);
});

test("claimRegressions signale une affirmation établie qui a disparu", () => {
  const regressions = claimRegressions([claim("Le support prend fin en 2026.")], [claim("Tout autre chose.")]);
  assert.deepEqual(regressions, [{ affirmation: "Le support prend fin en 2026.", avant: "VERIFIE", apres: "ABSENTE" }]);
});

test("le rapprochement résiste à la ponctuation, à la casse et aux accents", () => {
  // Les identifiants ne survivent pas d'un cycle à l'autre : le rapprochement se fait sur l'énoncé,
  // qu'une correction peut re-ponctuer sans en changer le sens.
  assert.equal(claimKey(claim("Le support prend fin en 2026.")), claimKey(claim("LE SUPPORT PREND FIN EN 2026 !")));
  assert.deepEqual(claimRegressions([claim("Coût vérifié : 100 €.")], [claim("COUT VERIFIE 100 €")]), []);
});

test("claimRegressions ne signale rien sans cycle précédent", () => {
  assert.deepEqual(claimRegressions(undefined, [claim("A")]), []);
  assert.deepEqual(claimRegressions([], [claim("A")]), []);
});

test("claimStats compte par statut et par criticité", () => {
  const stats = claimStats([
    claim("A", { critique: true }),
    claim("B", { statut: "NON_VERIFIE", critique: true }),
    claim("C", { statut: "CONTREDIT" })
  ]);
  assert.deepEqual(stats, { total: 3, critiques: 2, verifiees: 1, nonVerifiees: 1, contredites: 1 });
  assert.deepEqual(claimStats(), { total: 0, critiques: 0, verifiees: 0, nonVerifiees: 0, contredites: 0 });
});

test("claimsBrief sépare ce qu'il faut étayer de ce qu'il faut préserver", () => {
  const brief = claimsBrief([claim("Acquise"), claim("À étayer", { statut: "NON_VERIFIE", critique: true })]);
  assert.match(brief, /AFFIRMATIONS À ÉTAYER OU À RETIRER/);
  assert.match(brief, /DÉTERMINANTE\] À étayer/);
  assert.match(brief, /AFFIRMATIONS ÉTABLIES/);
  assert.equal(claimsBrief([]), "", "aucun bloc inutile quand l'inventaire est vide");
});
