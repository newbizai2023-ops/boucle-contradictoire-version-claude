// Affirmations (claims) : inventaire, porte de validation et détection de régression.
//
// La traçabilité de l'application s'arrêtait au document et à la source : on pouvait savoir quelles
// pages avaient été contrôlées, jamais sur quoi reposait une recommandation. Il manquait l'objet
// intermédiaire — l'affirmation — sans lequel « quelle source soutient ce paragraphe ? » et « si
// cette source tombe, qu'est-ce qui devient faux ? » restent sans réponse.
//
// Cet inventaire ne coûte aucun appel supplémentaire : l'auditeur lit déjà chaque affirmation
// matérielle et l'associe à une preuve précise (c'est la première ligne de son prompt). Il ne
// restituait que les problèmes (`anomalies`), pas l'inventaire. Le contrat JSON le lui demande
// désormais, et ce qu'il renvoie devient une table requêtable et une condition d'arrêt.

const TYPES = ["fait", "hypothese", "estimation", "calcul", "interpretation", "recommandation"];
const STATUTS = ["VERIFIE", "NON_VERIFIE", "CONTREDIT"];

/** Majuscules sans accent : les modèles écrivent « vérifié », « VÉRIFIÉE » ou « verifie » quel que
 *  soit le format demandé — même motif que les gravités d'anomalie dans audit.js. */
function normalize(value) {
  // U+0300..U+036F écrits en échappements, comme dans audit.js : les caractères littéraux seraient
  // invisibles à la relecture.
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function claimType(value) {
  const brut = normalize(value).toLowerCase();
  return TYPES.find(type => brut.startsWith(type.slice(0, 6))) || "interpretation";
}

function claimStatus(value) {
  const brut = normalize(value);
  if (/^CONTRED/.test(brut)) return "CONTREDIT";
  if (/^(NON|NOT|UNVER)/.test(brut)) return "NON_VERIFIE";
  if (/^VERIF/.test(brut)) return "VERIFIE";
  // Statut absent ou inintelligible : traité comme non vérifié, jamais comme vérifié. Un modèle qui
  // omet le champ ne doit pas obtenir gratuitement le bénéfice du doute — c'est précisément la
  // faille que cette table est censée fermer.
  return "NON_VERIFIE";
}

/** Texte comparable d'une affirmation, pour rapprocher deux cycles.
 *
 *  Les identifiants ne survivent pas d'un cycle à l'autre : l'auditeur les régénère à chaque audit.
 *  Le rapprochement se fait donc sur l'énoncé, réduit à sa forme la plus stable possible. */
export function claimKey(claim) {
  return normalize(claim?.affirmation).replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Ramène l'inventaire renvoyé par l'auditeur à une forme sûre, typée et bornée. */
export function normalizeClaims(audit, { limit = 40 } = {}) {
  const brut = Array.isArray(audit?.claims) ? audit.claims : [];
  return brut
    .slice(0, limit)
    .map((claim, index) => ({
      id: String(claim?.id || `CLAIM-${String(index + 1).padStart(3, "0")}`),
      type: claimType(claim?.type),
      affirmation: String(claim?.affirmation ?? "").trim(),
      statut: claimStatus(claim?.statut),
      critique: claim?.critique === true,
      sources: (Array.isArray(claim?.sources) ? claim.sources : []).map(source => String(source)).filter(Boolean)
    }))
    .filter(claim => claim.affirmation);
}

/** Affirmations déterminantes que l'audit n'a pas pu établir.
 *
 *  C'est la porte que réclamait la méthodologie : une conclusion ne peut pas être validée tant
 *  qu'une affirmation dont elle dépend reste non vérifiée ou contredite. À la différence du score
 *  global, ce décompte désigne *quoi* corriger. */
export function unverifiedCriticalClaims(claims = []) {
  return claims.filter(claim => claim.critique && claim.statut !== "VERIFIE");
}

/** Affirmations vérifiées au cycle précédent qui ne le sont plus au cycle courant.
 *
 *  La correction réécrit le document *intégralement* à chaque cycle : rien ne garantissait qu'un
 *  fait établi au cycle 1 survive au cycle 2. Les versions étaient conservées, jamais comparées.
 *
 *  Le rapprochement se fait sur l'énoncé normalisé, donc imparfaitement : une reformulation compte
 *  comme une disparition. C'est pourquoi ce signal est **informatif et non bloquant** — il alerte
 *  sur une régression possible sans pouvoir la prouver, et un blocage sur une correspondance floue
 *  transformerait chaque reformulation en boucle sans issue. */
export function claimRegressions(previousClaims = [], currentClaims = []) {
  const courantes = new Map(currentClaims.map(claim => [claimKey(claim), claim]));
  return previousClaims
    .filter(claim => claim.statut === "VERIFIE")
    .map(claim => {
      const apres = courantes.get(claimKey(claim));
      if (!apres) return { affirmation: claim.affirmation, avant: "VERIFIE", apres: "ABSENTE" };
      if (apres.statut !== "VERIFIE") return { affirmation: claim.affirmation, avant: "VERIFIE", apres: apres.statut };
      return null;
    })
    .filter(Boolean);
}

/** Décompte par statut, pour le fil de suivi et les agrégats. */
export function claimStats(claims = []) {
  const parStatut = Object.fromEntries(STATUTS.map(statut => [statut, 0]));
  for (const claim of claims) parStatut[claim.statut] += 1;
  return {
    total: claims.length,
    critiques: claims.filter(claim => claim.critique).length,
    verifiees: parStatut.VERIFIE,
    nonVerifiees: parStatut.NON_VERIFIE,
    contredites: parStatut.CONTREDIT
  };
}

/** Dossier d'affirmations transmis au rédacteur lors d'une correction : il doit savoir lesquelles
 *  préserver, et lesquelles étayer ou retirer. */
export function claimsBrief(claims = []) {
  if (!claims.length) return "";
  const ligne = claim => `  [${claim.statut}${claim.critique ? " · DÉTERMINANTE" : ""}] ${claim.affirmation}${claim.sources.length ? ` (${claim.sources.join(", ")})` : ""}`;
  const aTraiter = claims.filter(claim => claim.statut !== "VERIFIE");
  const acquises = claims.filter(claim => claim.statut === "VERIFIE");
  const sections = [];
  if (aTraiter.length) sections.push(`AFFIRMATIONS À ÉTAYER OU À RETIRER :\n${aTraiter.map(ligne).join("\n")}`);
  if (acquises.length) sections.push(`AFFIRMATIONS ÉTABLIES — à préserver telles quelles :\n${acquises.map(ligne).join("\n")}`);
  return sections.join("\n\n");
}
