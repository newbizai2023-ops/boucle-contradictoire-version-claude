import test from "node:test";
import assert from "node:assert/strict";
import { resolveReleaseDate, RELEASE_DATE_SOURCES } from "../lib/release.js";

test("resolveReleaseDate retient la date du commit quand elle est disponible", () => {
  const resolu = resolveReleaseDate({
    commitDate: "2026-08-09T10:59:18+00:00",
    packageMtime: "2026-08-09T11:04:00.000Z",
    startedAt: "2026-08-09T12:00:00.000Z"
  });
  assert.equal(resolu.date, "2026-08-09T10:59:18.000Z");
  assert.equal(resolu.source, "commit");
  assert.equal(resolu.precision, RELEASE_DATE_SOURCES.commit);
});

test("resolveReleaseDate descend la cascade quand une source manque", () => {
  // Le dépôt Git n'accompagne pas toujours le déploiement : la date du commit est alors absente,
  // et c'est la récupération des fichiers qui approche le mieux le moment de la construction.
  const sansGit = resolveReleaseDate({ packageMtime: "2026-08-09T11:04:00.000Z", startedAt: "2026-08-09T12:00:00.000Z" });
  assert.equal(sansGit.source, "fichiers");
  assert.equal(sansGit.date, "2026-08-09T11:04:00.000Z");

  const dernierRepli = resolveReleaseDate({ startedAt: "2026-08-09T12:00:00.000Z" });
  assert.equal(dernierRepli.source, "demarrage");
  assert.equal(dernierRepli.date, "2026-08-09T12:00:00.000Z");
});

test("resolveReleaseDate écarte une date inexploitable au lieu de la propager", () => {
  // `new Date("indisponible")` ne lève pas : il produit une date invalide, dont `toISOString()`
  // lèverait plus loin, dans la route de santé. Le tri se fait donc ici, pas chez l'appelant.
  const resolu = resolveReleaseDate({ commitDate: "indisponible", packageMtime: "", startedAt: "2026-08-09T12:00:00.000Z" });
  assert.equal(resolu.source, "demarrage");
  assert.equal(resolu.date, "2026-08-09T12:00:00.000Z");
});

test("resolveReleaseDate renvoie une absence de date, jamais une date inventée", () => {
  // Aucune source exploitable : l'interface masque le badge. Afficher l'heure courante à la place
  // laisserait croire que la version vient d'être produite, ce qui serait faux à chaque appel.
  for (const entree of [{}, undefined, { commitDate: null, packageMtime: undefined, startedAt: "pas une date" }]) {
    const resolu = resolveReleaseDate(entree);
    assert.deepEqual(resolu, { date: null, source: null, precision: null });
  }
});

test("chaque source de la cascade porte une explication affichable", () => {
  // La précision est reprise telle quelle dans l'infobulle du badge : une source sans texte
  // afficherait une bulle vide, sans que rien n'échoue.
  for (const source of ["commit", "fichiers", "demarrage"]) {
    assert.equal(typeof RELEASE_DATE_SOURCES[source], "string");
    assert.ok(RELEASE_DATE_SOURCES[source].length > 0, `${source} sans explication`);
  }
});
