import test from "node:test";
import assert from "node:assert/strict";
import { cycleProgress, PROGRESS_DRAFT, PROGRESS_ARBITER, PROGRESS_COMPLETE } from "../lib/progress.js";

const ETAPES = ["sources", "audit", "correction"];

/** Reconstitue la suite des pourcentages d'une analyse menée jusqu'au dernier cycle. */
function deroule(maxCycles) {
  const suite = [PROGRESS_DRAFT];
  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    for (const etape of ETAPES) suite.push(cycleProgress(etape, cycle, maxCycles));
  }
  return [...suite, PROGRESS_ARBITER, PROGRESS_COMPLETE];
}

test("la progression est strictement croissante, quel que soit le nombre de cycles", () => {
  // Régression : les formules précédentes ignoraient maxCycles. Avec le réglage par défaut de trois
  // cycles, la barre affichait 46 % à la fin du cycle 1 puis 36 % au début du cycle 2.
  for (let maxCycles = 1; maxCycles <= 5; maxCycles += 1) {
    const suite = deroule(maxCycles);
    for (let i = 1; i < suite.length; i += 1) {
      assert.ok(
        suite[i] > suite[i - 1],
        `maxCycles=${maxCycles} : la barre passe de ${suite[i - 1]} % à ${suite[i]} % (suite : ${suite.join(" → ")})`
      );
    }
  }
});

test("la progression ne dépasse jamais 100 %, même au nombre maximal de cycles", () => {
  // 30 + 4 × 16 = 94 puis 110 au cinquième cycle : l'ancienne formule dépassait 100 dès quatre
  // cycles, ce que seule la borne appliquée côté client masquait.
  for (let maxCycles = 1; maxCycles <= 5; maxCycles += 1) {
    for (const percent of deroule(maxCycles)) {
      assert.ok(percent >= 0 && percent <= PROGRESS_COMPLETE, `${percent} % hors bornes (maxCycles=${maxCycles})`);
    }
  }
});

test("les étapes de cycle restent entre la rédaction initiale et l'arbitrage", () => {
  for (let maxCycles = 1; maxCycles <= 5; maxCycles += 1) {
    for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
      for (const etape of ETAPES) {
        const percent = cycleProgress(etape, cycle, maxCycles);
        assert.ok(percent > PROGRESS_DRAFT, `${etape} cycle ${cycle}/${maxCycles} : ${percent} % ≤ rédaction`);
        assert.ok(percent < PROGRESS_ARBITER, `${etape} cycle ${cycle}/${maxCycles} : ${percent} % ≥ arbitrage`);
      }
    }
  }
});

test("un arrêt anticipé de la boucle avance la barre, ne la fait pas reculer", () => {
  // La boucle sort dès que le score cible est atteint : on saute alors directement à l'arbitrage.
  const dernierCycleAffiche = cycleProgress("audit", 1, 5);
  assert.ok(dernierCycleAffiche < PROGRESS_ARBITER);
});

test("chaque cycle occupe une tranche de largeur égale", () => {
  // À un point près, les pourcentages étant arrondis à l'entier pour l'affichage.
  for (const maxCycles of [2, 3, 4, 5]) {
    const debuts = Array.from({ length: maxCycles }, (_, i) => cycleProgress("sources", i + 1, maxCycles));
    const largeurs = debuts.slice(1).map((debut, i) => debut - debuts[i]);
    assert.ok(
      Math.max(...largeurs) - Math.min(...largeurs) <= 1,
      `maxCycles=${maxCycles} : tranches de largeurs ${largeurs.join(", ")} (débuts : ${debuts.join(", ")})`
    );
  }
});

test("les trois étapes d'un cycle se répartissent dans sa tranche", () => {
  const [sources, audit, correction] = ETAPES.map(etape => cycleProgress(etape, 2, 3));
  assert.ok(sources < audit && audit < correction, `${sources} / ${audit} / ${correction}`);
  assert.ok(correction < cycleProgress("sources", 3, 3), "la correction déborde sur le cycle suivant");
});

test("cycleProgress refuse une étape inconnue plutôt que de renvoyer un pourcentage faux", () => {
  assert.throws(() => cycleProgress("arbiter", 1, 3), /Étape de cycle inconnue : arbiter/);
  assert.throws(() => cycleProgress(undefined, 1, 3), /Étape de cycle inconnue/);
});

test("cycleProgress tolère un maxCycles absent ou incohérent", () => {
  // `maxCycles` est borné à [1, 5] côté serveur, mais la fonction ne doit pas produire NaN ni
  // dépasser ses bornes si elle est appelée autrement.
  for (const maxCycles of [undefined, 0, -3, NaN, "3"]) {
    const percent = cycleProgress("sources", 1, maxCycles);
    assert.ok(Number.isFinite(percent), `maxCycles=${maxCycles} produit ${percent}`);
    assert.ok(percent >= PROGRESS_DRAFT && percent < PROGRESS_ARBITER);
  }
});

test("cycleProgress borne un cycle qui dépasserait maxCycles", () => {
  assert.equal(cycleProgress("correction", 9, 3), cycleProgress("correction", 3, 3));
});
