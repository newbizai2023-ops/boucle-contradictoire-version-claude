// Lecture du verdict d'audit et condition d'arrêt de la boucle contradictoire.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

import { extractUrls } from "./sources.js";
import { unverifiedCriticalClaims } from "./claims.js";

/** Majuscules, sans accent ni espace superflu : les modèles répondent en français libre, avec ou
 *  sans accents et avec une casse variable, quel que soit le format demandé par le contrat JSON. */
function normalize(value) {
  // U+0300..U+036F : diacritiques combinants isolés par la décomposition NFD. Écrits en échappements
  // plutôt qu'en caractères littéraux, qui seraient invisibles à la relecture.
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

const SEVERE_LEVELS = new Set(["CRITIQUE", "ELEVEE", "ELEVE"]);

/** Une anomalie critique ou élevée interdit la validation.
 *
 *  La comparaison ignore les accents : le contrat JSON demande `critique|elevee|moyenne|faible`
 *  sans accent, mais les modèles écrivent naturellement « élevée » — l'orthographe qu'emploie le
 *  prompt d'auditeur lui-même. Une simple mise en minuscules laissait donc passer « élevée »,
 *  « Élevée » et « élevé » comme non bloquantes, alors que ce sont précisément les anomalies
 *  censées empêcher l'arrêt de la boucle. */
export function isSevere(gravite) {
  return SEVERE_LEVELS.has(normalize(gravite));
}

/** Interprète le champ `decision` de l'audit (`VALIDER` ou `CORRIGER` selon le contrat JSON).
 *
 *  Renvoie `"valider"`, `"corriger"`, ou `"indeterminee"` lorsque le champ est absent ou
 *  inintelligible — auquel cas il ne doit pas peser sur la décision, faute de quoi un modèle qui
 *  omet le champ ferait consommer tous les cycles à chaque analyse. */
export function auditDecision(audit) {
  const value = normalize(audit?.decision);
  if (/^VALID/.test(value)) return "valider";
  if (/^(CORRIG|CORREC)/.test(value)) return "corriger";
  return "indeterminee";
}

/** Décide si la boucle peut s'arrêter au vu de l'audit du cycle courant, et pourquoi.
 *
 *  Les motifs sont renvoyés plutôt que réduits à un booléen : ils alimentent le fil de suivi et la
 *  raison d'arrêt enregistrée, pour que « un cycle de plus » soit une décision lisible plutôt
 *  qu'un comportement opaque.
 *
 *  Le verdict explicite de l'auditeur (`decision`) est pris en compte depuis la 1.4.0 : il était
 *  demandé dans le contrat JSON, produit par le modèle, affiché dans le fil de suivi — et ignoré
 *  par la condition d'arrêt, qui ne lisait que le score, la gravité des anomalies et
 *  `nouveau_cycle_requis`. Un auditeur concluant `CORRIGER` avec un score de 95 et aucune anomalie
 *  sévère voyait donc la boucle s'arrêter contre son avis. */
export function shouldStopAfterAudit(audit, minScore, { sources = [], document = "", claims = [] } = {}) {
  const motifs = [];

  const score = Number(audit?.score_global || 0);
  if (score < minScore) motifs.push(`score ${score}/100 inférieur au seuil de ${minScore}`);

  const severes = (audit?.anomalies || []).filter(anomalie => isSevere(anomalie?.gravite));
  if (severes.length) motifs.push(`${severes.length} anomalie(s) critique(s) ou élevée(s)`);

  const nonVerifiees = (audit?.sources_non_verifiees || []).length;
  if (nonVerifiees) motifs.push(`${nonVerifiees} source(s) essentielle(s) non vérifiée(s)`);

  const injoignables = unreachableCitedSources(document, sources);
  if (injoignables.length) motifs.push(`${injoignables.length} source(s) citée(s) et injoignable(s) au contrôle`);

  // Une conclusion ne peut pas être validée tant qu'une affirmation dont elle dépend reste non
  // établie. À la différence du score global, ce motif désigne *quoi* corriger.
  const critiques = unverifiedCriticalClaims(claims);
  if (critiques.length) motifs.push(`${critiques.length} affirmation(s) déterminante(s) non vérifiée(s)`);

  if (audit?.nouveau_cycle_requis === true) motifs.push("l'auditeur demande un nouveau cycle");

  const decision = auditDecision(audit);
  if (decision === "corriger") motifs.push("l'auditeur conclut à CORRIGER");

  return { stop: motifs.length === 0, motifs, decision, injoignables, claimsCritiques: critiques };
}

/** URL encore citées par le document et dont le contrôle a établi qu'elles sont injoignables.
 *
 *  C'est la seule vérité terrain dont dispose la boucle : `accessible` vient de Firecrawl, pas d'un
 *  modèle. Jusqu'ici la condition d'arrêt ne lisait que `sources_non_verifiees`, une liste *écrite
 *  par l'auditeur* — l'application mesurait donc la bonne chose et décidait sur une autre. Un
 *  auditeur omettant le champ laissait valider un document truffé de liens morts.
 *
 *  `accessible === null` (contrôle désactivé, budget épuisé) n'est pas un échec de contrôle et ne
 *  bloque pas : on ne peut pas reprocher au document une vérification qui n'a pas eu lieu.
 *
 *  Le filtre sur les URL réellement citées conditionne la convergence de la boucle : le cache des
 *  sources n'oublie jamais une URL contrôlée, si bien qu'un lien mort *retiré* du document par une
 *  correction continuerait sinon de bloquer la validation indéfiniment. Retirer ou remplacer le lien
 *  lève le blocage — c'est exactement la correction attendue. */
export function unreachableCitedSources(document, sources = []) {
  const citees = new Set(extractUrls(document, Infinity));
  return (sources ?? []).filter(source => source?.accessible === false && citees.has(source.url)).map(source => source.url);
}

/** Compare deux cycles consécutifs et signale l'absence de tout progrès mesurable.
 *
 *  Sans ce contrôle, une boucle qui plafonne consomme `maxCycles` intégralement : trois rédactions
 *  et trois audits payés pour un score qui ne bouge pas. Deux dimensions sont suivies, car
 *  progresser sur l'une suffit à justifier un cycle de plus — un score stable dont les anomalies
 *  sévères diminuent est un vrai progrès, et l'inverse aussi.
 *
 *  Renvoie `null` tant qu'il y a progrès (ou qu'il n'y a pas encore deux cycles à comparer), sinon
 *  les deux mesures, à charge de l'appelant d'en formuler la raison d'arrêt. */
export function stagnationBetween(previous, current) {
  if (!previous || !current) return null;
  const mesure = audit => ({
    score: Number(audit?.score_global || 0),
    severes: (audit?.anomalies || []).filter(anomalie => isSevere(anomalie?.gravite)).length,
    // Troisième dimension, indispensable depuis que les affirmations déterminantes non établies
    // bloquent la validation : un cycle qui en résout trois sans faire bouger le score d'un point
    // est un progrès décisif, et l'arrêter là gaspillerait précisément le travail utile.
    critiques: unverifiedCriticalClaims(audit?.claims).length
  });
  const avant = mesure(previous);
  const apres = mesure(current);
  if (apres.score > avant.score || apres.severes < avant.severes || apres.critiques < avant.critiques) return null;
  return { avant, apres };
}

/** Entier borné à [0,100], ou null si la valeur est absente ou inintelligible. */
function confiance(value) {
  const nombre = Number(value);
  return Number.isFinite(nombre) ? Math.min(100, Math.max(0, Math.trunc(nombre))) : null;
}

/** Normalise les confiances de l'arbitrage et rend la confiance globale cohérente avec ses deux
 *  dimensions.
 *
 *  L'arbitre rend désormais trois nombres : la confiance dans les preuves (qualité, indépendance et
 *  accessibilité des sources) et la confiance dans la conclusion (dépendance aux hypothèses métier)
 *  sont indépendantes — une base factuelle solide peut porter une recommandation fragile, cas que
 *  la confiance unique rendait inexprimable.
 *
 *  La confiance globale est plafonnée par la plus faible des deux : on ne peut pas être plus sûr de
 *  sa conclusion que de ce qui la soutient. Le plafonnement est appliqué en code plutôt que demandé
 *  au modèle, et la valeur annoncée est conservée dans `confiance_annoncee` — un ajustement
 *  silencieux serait un mensonge de plus, pas une correction. */
export function normalizeArbitration(arbitration) {
  if (!arbitration || typeof arbitration !== "object") return arbitration;

  const preuves = confiance(arbitration.confiance_preuves);
  const conclusion = confiance(arbitration.confiance_conclusion);
  const annoncee = confiance(arbitration.confiance);
  const normalisee = { ...arbitration };

  if (preuves !== null) normalisee.confiance_preuves = preuves;
  if (conclusion !== null) normalisee.confiance_conclusion = conclusion;

  const dimensions = [preuves, conclusion].filter(valeur => valeur !== null);
  if (!dimensions.length) {
    if (annoncee !== null) normalisee.confiance = annoncee;
    return normalisee;
  }

  const plafond = Math.min(...dimensions);
  normalisee.confiance = annoncee === null ? plafond : Math.min(annoncee, plafond);
  if (annoncee !== null && annoncee > plafond) normalisee.confiance_annoncee = annoncee;
  return normalisee;
}
