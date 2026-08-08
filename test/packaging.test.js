// Cohérence entre ce que le code importe et ce que l'image Docker embarque.
//
// L'extraction de la logique dans `lib/` (1.3.0) a rendu l'image inutilisable pendant quatre
// versions : le Dockerfile ne copiait que `server.js` et `public/`, et le conteneur s'arrêtait au
// démarrage sur « Cannot find module .../lib/task.js ». Rien ne l'avait signalé — Render déploie
// depuis le dépôt via render.yaml, pas depuis le Dockerfile, donc seule l'image était touchée.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = name => readFileSync(new URL(name, import.meta.url), "utf8");
const server = read("../server.js");
const dockerfile = read("../Dockerfile");

/** Premier segment de chemin d'un import relatif : « ./lib/task.js » → « lib ». */
const racine = specifier => specifier.replace(/^\.\//, "").split("/")[0];

const importsRelatifs = [
  ...server.matchAll(/(?:from|require\()\s*["'](\.\/[^"']+)["']/g)
].map(match => racine(match[1]));

const copies = [...dockerfile.matchAll(/^COPY\s+(\S+)/gm)].map(match => match[1]);

test("l'analyse des imports et du Dockerfile a bien trouvé quelque chose", () => {
  assert.ok(importsRelatifs.length > 0, "aucun import relatif détecté dans server.js");
  assert.ok(copies.length > 0, "aucune instruction COPY détectée dans le Dockerfile");
});

test("tout ce que server.js importe est copié dans l'image Docker", () => {
  const couvert = chemin => copies.some(source => source === chemin || source === `${chemin}/` || new RegExp(`^${source.replace(/\*/g, ".*")}$`).test(chemin));
  const manquants = [...new Set(importsRelatifs)].filter(chemin => !couvert(chemin));
  assert.deepEqual(manquants, [], `absent(s) du Dockerfile : ${manquants.join(", ")}`);
});

test("le point d'entrée du conteneur est bien celui déclaré par package.json", () => {
  const { scripts } = JSON.parse(read("../package.json"));
  const [, commande] = dockerfile.match(/^CMD\s+\[(.+)\]/m);
  const fichier = commande.split(",").map(part => part.trim().replace(/"/g, "")).at(-1);
  assert.ok(scripts.start.includes(fichier), `CMD lance ${fichier}, npm start lance « ${scripts.start} »`);
});
