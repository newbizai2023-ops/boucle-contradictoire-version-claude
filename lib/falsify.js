// FALSIFY — chercher activement ce qui invaliderait la conclusion.
//
// L'auditeur travaille sans recherche web, délibérément : il juge sur pièces, et un auditeur qui
// recherche finit par auditer sa propre recherche. La conséquence méthodologique était lourde —
// l'application pouvait établir qu'une affirmation n'était **pas étayée**, jamais qu'une source la
// **contredisait**. Elle constatait des absences, pas des réfutations. Un document parfaitement
// sourcé dont la conclusion est démentie par une publication plus récente passait tous les
// contrôles.
//
// Cette étape comble ce trou sans toucher au principe : un appel distinct, adversarial, avec
// recherche, dont la mission n'est pas d'auditer le document mais de le mettre en défaut.
// Conditionnel, parce qu'il ne se justifie que là où le doute est mesurable.

import { isSevere } from "./audit.js";
import { unverifiedCriticalClaims } from "./claims.js";

export const falsifierSystem = `Tu cherches à démontrer qu'un document est faux. Tu n'es pas son auditeur : tu es son adversaire. Utilise la recherche web pour trouver ce qui le contredit. Réponds uniquement en JSON valide.

MISSION
- Cherche des sources qui contredisent les affirmations déterminantes du document, pas des sources qui les confirment.
- Cherche des données plus récentes que celles employées : une information exacte à une date peut être fausse aujourd'hui.
- Cherche les exceptions, cas limites, juridictions, populations ou périmètres où la conclusion ne tient plus.
- Attaque les hypothèses implicites : ce que le document tient pour acquis sans le démontrer.
- Recalcule les ordres de grandeur déterminants et signale ceux qui ne tiennent pas.

RÈGLES
- Toute contradiction doit être appuyée sur une URL complète et un extrait précis. Une objection sans source n'est pas une contradiction, c'est une opinion : ne la retourne pas.
- N'invente jamais de source, de citation ni de chiffre. Si tu ne trouves rien qui contredise le document, dis-le : un verdict CONFIRME honnête vaut mieux qu'une objection fabriquée.
- Ne reformule pas les anomalies déjà relevées par l'audit : elles sont connues. Cherche ce que l'audit ne pouvait pas voir, faute d'accès à la recherche.
- verdict vaut CONTREDIT si une affirmation déterminante est démentie par une source, AFFAIBLI si des hypothèses ou un périmètre fragilisent la conclusion sans la démentir, CONFIRME si la recherche adverse n'a rien trouvé de probant.`;

/** Faut-il payer cet appel ? Décision déterministe, prise sur des mesures et non sur une impression.
 *
 *  Les quatre déclencheurs correspondent aux situations où la validation repose sur quelque chose
 *  d'invérifié : un audit qui bute encore, une affirmation déterminante non établie, une boucle qui
 *  a renoncé, ou — le cas le plus traître — un excellent score adossé à aucune source primaire
 *  réellement joignable, c'est-à-dire un document convaincant que rien n'atteste. */
export function shouldFalsify({ audit, claims = [], sources = [], minScore, stagnated = false } = {}) {
  const motifs = [];

  const severes = (audit?.anomalies || []).filter(anomalie => isSevere(anomalie?.gravite)).length;
  if (severes) motifs.push(`${severes} anomalie(s) sévère(s) subsistante(s)`);

  const critiques = unverifiedCriticalClaims(claims).length;
  if (critiques) motifs.push(`${critiques} affirmation(s) déterminante(s) non vérifiée(s)`);

  if (stagnated) motifs.push("la boucle s'est arrêtée sans converger");

  const primairesAccessibles = sources.filter(
    source => source?.accessible === true && ["primary_official", "primary_documentation"].includes(source.sourceClass)
  ).length;
  if (Number(audit?.score_global || 0) >= minScore && primairesAccessibles === 0) {
    motifs.push("score au seuil sans aucune source primaire joignable");
  }

  return { run: motifs.length > 0, motifs };
}

export function falsifyPrompt(request, document, claims, audit) {
  const affirmations = claims.filter(claim => claim.critique).map(claim => `- ${claim.affirmation}`).join("\n");
  return `DEMANDE INITIALE :
${request}

DOCUMENT À METTRE EN DÉFAUT :
${document}

AFFIRMATIONS DÉTERMINANTES À ATTAQUER EN PRIORITÉ :
${affirmations || "(inventaire indisponible : attaque les affirmations que tu juges déterminantes)"}

ANOMALIES DÉJÀ CONNUES DE L'AUDIT — ne les répète pas :
${JSON.stringify((audit?.anomalies || []).map(anomalie => anomalie?.probleme).filter(Boolean), null, 2)}

Retourne ce JSON strict : {"verdict":"CONFIRME|AFFAIBLI|CONTREDIT","contradictions":[{"affirmation":"","source":"","extrait":"","gravite":"critique|elevee|moyenne|faible"}],"donnees_plus_recentes":[{"sujet":"","valeur_document":"","valeur_trouvee":"","source":""}],"hypotheses_fragiles":[""],"perimetres_non_couverts":[""]}. Chaque contradiction et chaque donnée plus récente doit porter une URL complète.`;
}

/** Ramène la réfutation à une forme sûre et bornée. */
export function normalizeFalsification(falsification) {
  if (!falsification || typeof falsification !== "object") return null;
  const liste = (value, limite) => (Array.isArray(value) ? value : []).slice(0, limite);
  const verdict = String(falsification.verdict ?? "").trim().toUpperCase();
  return {
    verdict: ["CONFIRME", "AFFAIBLI", "CONTREDIT"].includes(verdict) ? verdict : "CONFIRME",
    // Une contradiction sans URL n'est pas une contradiction : le prompt l'interdit, le code
    // l'applique. Sans ce filtre, l'étape adversariale deviendrait un générateur d'objections
    // invérifiables — exactement ce qu'elle est censée remplacer.
    contradictions: liste(falsification.contradictions, 12).filter(item => /^https?:\/\//.test(String(item?.source || ""))),
    donnees_plus_recentes: liste(falsification.donnees_plus_recentes, 12).filter(item => /^https?:\/\//.test(String(item?.source || ""))),
    hypotheses_fragiles: liste(falsification.hypotheses_fragiles, 8).map(item => String(item)).filter(Boolean),
    perimetres_non_couverts: liste(falsification.perimetres_non_couverts, 8).map(item => String(item)).filter(Boolean)
  };
}

/** URL citées par la réfutation, à soumettre au même contrôle que les autres : une source
 *  contradictoire qui ne répond pas ne réfute rien. */
export function falsificationUrls(falsification) {
  if (!falsification) return [];
  return [
    ...falsification.contradictions.map(item => String(item.source)),
    ...falsification.donnees_plus_recentes.map(item => String(item.source))
  ];
}

/** Contradictions à la fois graves et **mesurées joignables**.
 *
 *  Une réfutation reste la parole d'un modèle : elle peut inventer une objection et lui coller une
 *  URL. Ne comptent donc que les contradictions sévères dont la source a été réellement extraite
 *  par Firecrawl. C'est le fait le plus lourd que l'application sache produire contre un document,
 *  et il ne doit pas dépendre de l'appréciation de l'arbitre — la même raison qui a fait entrer la
 *  mesure d'accessibilité dans la condition d'arrêt. */
export function confirmedContradictions(falsification, sources = []) {
  if (!falsification) return [];
  const joignables = new Set((sources ?? []).filter(source => source?.accessible === true).map(source => source.url));
  return falsification.contradictions.filter(
    contradiction => isSevere(contradiction?.gravite) && joignables.has(String(contradiction.source))
  );
}

export function falsifySummary(falsification) {
  if (!falsification) return "Réfutation non concluante.";
  const libelle = { CONFIRME: "rien de probant contre le document", AFFAIBLI: "conclusion fragilisée", CONTREDIT: "affirmation déterminante démentie" };
  return `Réfutation : ${falsification.verdict} — ${libelle[falsification.verdict]}. ` +
    `${falsification.contradictions.length} contradiction(s) sourcée(s), ` +
    `${falsification.donnees_plus_recentes.length} donnée(s) plus récente(s), ` +
    `${falsification.hypotheses_fragiles.length} hypothèse(s) fragile(s).`;
}
