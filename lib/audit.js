// Lecture du verdict d'audit et condition d'arrêt de la boucle contradictoire.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

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
export function shouldStopAfterAudit(audit, minScore) {
  const motifs = [];

  const score = Number(audit?.score_global || 0);
  if (score < minScore) motifs.push(`score ${score}/100 inférieur au seuil de ${minScore}`);

  const severes = (audit?.anomalies || []).filter(anomalie => isSevere(anomalie?.gravite));
  if (severes.length) motifs.push(`${severes.length} anomalie(s) critique(s) ou élevée(s)`);

  const nonVerifiees = (audit?.sources_non_verifiees || []).length;
  if (nonVerifiees) motifs.push(`${nonVerifiees} source(s) essentielle(s) non vérifiée(s)`);

  if (audit?.nouveau_cycle_requis === true) motifs.push("l'auditeur demande un nouveau cycle");

  const decision = auditDecision(audit);
  if (decision === "corriger") motifs.push("l'auditeur conclut à CORRIGER");

  return { stop: motifs.length === 0, motifs, decision };
}
