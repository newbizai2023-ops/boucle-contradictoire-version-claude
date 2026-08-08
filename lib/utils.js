// Utilitaires génériques sans effet de bord : concurrence bornée, lecture des réponses OpenRouter,
// parsing JSON tolérant.
//
// Extraits de server.js pour être testables : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

/** Applique `mapper` sur `items` avec au plus `limit` exécutions concurrentes. */
export async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function usageOf(payload) {
  return {
    prompt_tokens: Number(payload?.prompt_tokens || 0),
    completion_tokens: Number(payload?.completion_tokens || 0),
    cost: Number(payload?.cost || 0)
  };
}

export function extractMessageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) return content.map(part => (typeof part === "string" ? part : part?.text || part?.content || "")).join("\n").trim();
  if (content && typeof content === "object") return String(content.text || content.content || "").trim();
  return "";
}

/** Tente plusieurs extractions successives avant d'abandonner : le JSON brut, un éventuel bloc de
 *  code markdown ```json ... ``` (certains modèles en ajoutent malgré response_format:json_object),
 *  puis le plus grand fragment entre la première { et la dernière }. Journalise le contenu brut en
 *  cas d'échec total, pour pouvoir diagnostiquer la cause exacte (troncature, texte parasite, etc.)
 *  a posteriori depuis les logs plutôt qu'à l'aveugle. */
export function parseJson(content, label, finishReason) {
  const candidates = [content];
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) candidates.push(fenced[1]);
  const braced = content.match(/\{[\s\S]*\}/);
  if (braced) candidates.push(braced[0]);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // essaie la variante suivante
    }
  }
  console.error(`[json] ${label} : échec du parsing (finish_reason=${finishReason ?? "inconnu"}). Contenu brut (tronqué) : ${content.slice(0, 2000)}`);
  const truncated = finishReason === "length" ? " La réponse a été tronquée par la limite de tokens (finish_reason=length) : augmenter OPENROUTER_MAX_TOKENS." : "";
  throw new Error(`${label} n'est pas un JSON valide.${truncated}`);
}

/** Booléen optionnel tel qu'il arrive d'un formulaire multipart, où tout est chaîne.
 *
 *  `undefined` signifie « non exprimé » et doit le rester : c'est ce qui distingue « laisse le
 *  serveur décider » de « désactive ». Comparer directement à `true` traitait "true" comme "false",
 *  transformant silencieusement un choix explicite de l'utilisateur en son contraire. */
export function parseOptionalBoolean(value) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

export function safeName(value) {
  return String(value || "boucle-contradictoire").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60);
}
