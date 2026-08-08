// Cohérence entre l'interface (public/) et le serveur.
//
// Ces contrôles visent une classe de bugs que les tests unitaires ne voient pas : le formulaire et
// le serveur restent chacun valides, mais ne parlent plus du même vocabulaire. La 1.1.7 en est
// l'exemple — `isChecked('#firecrawl')` visait un identifiant qui n'existait pas dans le DOM (la
// case réelle porte l'id `webSearch`), la lecture renvoyait donc toujours `false` et Firecrawl
// n'était jamais sollicité, sans la moindre erreur visible. Le premier test ci-dessous détecte ce
// cas ; vérifié en le rejouant sur la révision fautive.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALLOWED_MODELS } from "../lib/models.js";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const html = read("../public/index.html");
const clientScript = read("../public/app.js");
const server = read("../server.js");

const matchAll = (source, pattern) => [...source.matchAll(pattern)].map(match => match[1]);

test("tout identifiant interrogé par app.js existe dans le DOM", () => {
  // Identifiants disponibles : ceux du document statique, plus ceux que l'interface injecte
  // elle-même via innerHTML (le bouton de déconnexion, par exemple).
  const declared = new Set([...matchAll(html, /id="([^"]+)"/g), ...matchAll(clientScript, /id="([^"]+)"/g)]);
  const referenced = new Set(matchAll(clientScript, /['"]#([A-Za-z][\w-]*)['"]/g));

  assert.ok(referenced.size > 30, "l'extraction des sélecteurs semble avoir échoué");
  const manquants = [...referenced].filter(id => !declared.has(id));
  assert.deepEqual(manquants, [], `sélecteur(s) sans élément correspondant : ${manquants.join(", ")}`);
});

test("les modèles proposés par le formulaire sont tous acceptés par le serveur", () => {
  // Un modèle ajouté au <select> mais absent de la liste blanche serait rejeté à l'exécution,
  // après le 202 et donc seulement dans le flux d'événements — un échec tardif et déroutant.
  const proposes = new Set(matchAll(html, /<option value="([^"]+)"/g));
  assert.ok(proposes.size > 0, "aucune option de modèle trouvée dans le formulaire");
  for (const model of proposes) {
    assert.ok(ALLOWED_MODELS.has(model), `${model} est proposé par le formulaire mais absent de ALLOWED_MODELS`);
  }
});

test("les formats d'export proposés sont tous gérés par la route d'export", () => {
  const proposes = new Set(matchAll(html, /data-export="([^"]+)"/g));
  const geres = new Set(matchAll(server, /format === "([a-z]+)"/g));
  assert.ok(proposes.size > 0, "aucun lien d'export trouvé dans le formulaire");
  for (const format of proposes) {
    assert.ok(geres.has(format), `l'export ${format} est proposé mais non géré par le serveur`);
  }
});

test("les extensions acceptées par le sélecteur de fichiers sont celles autorisées par le serveur", () => {
  const [accept] = matchAll(html, /accept="([^"]+)"/g);
  const proposees = new Set(accept.split(",").map(extension => extension.trim()));
  const [liste] = matchAll(server, /ALLOWED_DOCUMENT_EXTENSIONS = new Set\(\[([^\]]+)\]/g);
  const autorisees = new Set(liste.split(",").map(extension => extension.trim().replace(/"/g, "")));
  assert.deepEqual([...proposees].sort(), [...autorisees].sort());
});
