import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency, usageOf, extractMessageText, parseJson, safeName } from "../lib/utils.js";

test("mapWithConcurrency préserve l'ordre des résultats malgré les durées inégales", async () => {
  const results = await mapWithConcurrency([30, 10, 20, 0], 2, async delay => {
    await new Promise(resolve => setTimeout(resolve, delay));
    return delay;
  });
  assert.deepEqual(results, [30, 10, 20, 0]);
});

test("mapWithConcurrency ne dépasse jamais la limite d'exécutions simultanées", async () => {
  let actives = 0;
  let maximum = 0;
  await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
    actives += 1;
    maximum = Math.max(maximum, actives);
    await new Promise(resolve => setTimeout(resolve, 5));
    actives -= 1;
  });
  assert.ok(maximum <= 4, `jusqu'à ${maximum} exécutions simultanées pour une limite de 4`);
  assert.equal(maximum, 4, "la limite doit être effectivement atteinte, sinon la concurrence est inopérante");
});

test("mapWithConcurrency traite chaque élément exactement une fois", async () => {
  const vus = [];
  await mapWithConcurrency(["a", "b", "c", "d", "e"], 3, async item => vus.push(item));
  assert.deepEqual([...vus].sort(), ["a", "b", "c", "d", "e"]);
});

test("mapWithConcurrency se termine sur une liste vide", async () => {
  assert.deepEqual(await mapWithConcurrency([], 4, async () => "x"), []);
});

test("usageOf normalise une consommation absente ou partielle", () => {
  assert.deepEqual(usageOf(undefined), { prompt_tokens: 0, completion_tokens: 0, cost: 0 });
  assert.deepEqual(usageOf({ prompt_tokens: 12, cost: 0.5 }), { prompt_tokens: 12, completion_tokens: 0, cost: 0.5 });
  assert.deepEqual(usageOf({ prompt_tokens: "12" }), { prompt_tokens: 12, completion_tokens: 0, cost: 0 });
});

test("extractMessageText accepte les différentes formes de contenu OpenRouter", () => {
  assert.equal(extractMessageText({ content: "  texte  " }), "texte");
  assert.equal(extractMessageText({ content: ["a", "b"] }), "a\nb");
  assert.equal(extractMessageText({ content: [{ text: "a" }, { content: "b" }] }), "a\nb");
  assert.equal(extractMessageText({ content: { text: "a" } }), "a");
});

test("extractMessageText renvoie une chaîne vide plutôt que de lever pour un message absent", () => {
  // Une réponse vide déclenche le réessai puis la bascule sur le modèle de repli : elle doit
  // rester détectable comme chaîne vide, jamais provoquer une exception.
  for (const message of [undefined, null, {}, { content: null }, { content: 42 }]) {
    assert.equal(extractMessageText(message), "");
  }
});

test("parseJson lit un objet JSON direct", () => {
  assert.deepEqual(parseJson('{"score_global":90}', "L'audit"), { score_global: 90 });
});

test("parseJson récupère un JSON encadré par un bloc de code markdown", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```', "L'audit"), { a: 1 });
  assert.deepEqual(parseJson('```\n{"a":1}\n```', "L'audit"), { a: 1 });
});

test("parseJson récupère un JSON noyé dans du texte parasite", () => {
  assert.deepEqual(parseJson('Voici mon audit :\n{"a":1}\nJ\'espère que cela convient.', "L'audit"), { a: 1 });
});

test("parseJson signale explicitement une réponse tronquée par la limite de tokens", (t) => {
  t.mock.method(console, "error", () => {});
  assert.throws(
    () => parseJson('{"anomalies":[{"probleme":"coup', "L'audit", "length"),
    /tronquée par la limite de tokens.*OPENROUTER_MAX_TOKENS/s
  );
});

test("parseJson échoue sans mentionner la troncature quand la réponse est complète", (t) => {
  t.mock.method(console, "error", () => {});
  assert.throws(() => parseJson("désolé, je ne peux pas", "L'arbitrage", "stop"), error => {
    assert.match(error.message, /L'arbitrage n'est pas un JSON valide\./);
    assert.doesNotMatch(error.message, /tronquée/);
    return true;
  });
});

test("parseJson journalise le contenu brut pour permettre le diagnostic a posteriori", (t) => {
  const logs = [];
  t.mock.method(console, "error", message => logs.push(message));
  assert.throws(() => parseJson("pas du json", "L'audit", "stop"));
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[json\] L'audit.*finish_reason=stop.*pas du json/s);
});

test("safeName neutralise les caractères de chemin dans un nom de fichier exporté", () => {
  // Le nom part dans un en-tête Content-Disposition : ni séparateur de chemin, ni remontée de
  // répertoire, ni guillemet ne doit survivre.
  for (const dangereux of ["boucle-../../etc/passwd", 'x"; rm -rf /', "a\\b\r\nc"]) {
    assert.doesNotMatch(safeName(dangereux), /[^a-z0-9_-]/i, `nom non assaini : ${safeName(dangereux)}`);
  }
  assert.equal(safeName("boucle-../../etc/passwd"), "boucle--etc-passwd");
});

test("safeName fournit un nom par défaut et borne sa longueur", () => {
  assert.equal(safeName(""), "boucle-contradictoire");
  assert.equal(safeName(undefined), "boucle-contradictoire");
  assert.ok(safeName("x".repeat(200)).length <= 60);
});
