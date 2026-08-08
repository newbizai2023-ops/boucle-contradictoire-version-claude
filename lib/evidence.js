// Validation opposable des relations affirmation → source et contradiction → source.
//
// Jusqu'ici, une source était réputée probante dès lors qu'elle répondait. C'est insuffisant, et
// c'est la faiblesse que le dépôt documentait lui-même : **accessible ≠ probant**. Une page peut
// répondre tout en parlant d'un autre produit, d'une autre version, d'une autre région, ou en ne
// mentionnant le sujet que de loin. Le système passait donc de « le modèle affirme que cette source
// contredit le document » à « la contradiction est confirmée » simplement parce que l'URL répondait.
//
// Ce module ajoute le contrôle qui manquait, en restant déterministe. Le levier est simple et
// décisif : **le modèle cite un extrait, et cet extrait doit se retrouver dans la page réellement
// extraite par Firecrawl.** Un modèle qui fabrique une citation est alors pris en défaut par du
// code, sans appel supplémentaire et sans jugement sémantique.
//
// Ce que ce module ne fait pas : établir que la source *implique* logiquement la contradiction.
// L'entailment sémantique reste une appréciation du modèle. Ce qui change, c'est qu'elle doit
// désormais s'appuyer sur une citation dont l'existence est prouvée.

/** Forme comparable d'un texte : minuscules, sans accents, ponctuation et espaces normalisés.
 *
 *  U+0300..U+036F en échappements, comme partout ailleurs dans le dépôt : les diacritiques
 *  littéraux seraient invisibles à la relecture. */
function comparable(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Mots significatifs d'un extrait, hors mots-outils trop courts pour discriminer. */
function motsSignificatifs(texte) {
  return comparable(texte).split(" ").filter(mot => mot.length > 3);
}

/** L'extrait cité se retrouve-t-il dans la page réellement extraite ?
 *
 *  Deux niveaux, parce qu'une citation exacte est rare : un modèle recopie rarement au caractère
 *  près, il abrège, recompose, traduit parfois. La correspondance littérale est donc tentée d'abord,
 *  puis un recouvrement lexical suffisamment élevé pour qu'une citation inventée ne passe pas.
 *
 *  Le seuil de 0,6 est un compromis assumé : trop haut, une reformulation fidèle serait rejetée ;
 *  trop bas, une phrase vaguement thématique passerait. Il porte sur les mots de plus de trois
 *  lettres, ce qui neutralise les mots-outils. */
export const RECOUVREMENT_MINIMAL = 0.6;

export function citationPresente(extrait, contenu) {
  const cible = comparable(extrait);
  const page = comparable(contenu);
  if (!cible || !page) return false;

  // Le seuil de longueur s'applique **avant** la correspondance littérale, et pas seulement au
  // recouvrement : « le support » se retrouve littéralement dans à peu près toute page traitant du
  // sujet. Accorder la relation sur deux mots reviendrait à revenir au contrôle qu'on remplace.
  const mots = motsSignificatifs(extrait);
  if (mots.length < 3) return false;

  if (page.includes(cible)) return true;

  const motsPage = new Set(motsSignificatifs(contenu));
  const trouves = mots.filter(mot => motsPage.has(mot)).length;
  return trouves / mots.length >= RECOUVREMENT_MINIMAL;
}

export const RELATIONS = {
  SUPPORTS: "SUPPORTS",
  SOURCE_ABSENTE: "SOURCE_ABSENTE",
  SOURCE_INJOIGNABLE: "SOURCE_INJOIGNABLE",
  CITATION_ABSENTE: "CITATION_ABSENTE",
  CITATION_INTROUVABLE: "CITATION_INTROUVABLE"
};

const MOTIFS = {
  SOURCE_ABSENTE: "l'URL ne figure pas dans le dossier de sources contrôlées",
  SOURCE_INJOIGNABLE: "la page n'a pas pu être extraite",
  CITATION_ABSENTE: "aucun extrait n'est cité à l'appui",
  CITATION_INTROUVABLE: "l'extrait cité ne se retrouve pas dans la page extraite",
  SUPPORTS: "extrait retrouvé dans la page contrôlée"
};

/** Confronte une relation annoncée par un modèle au dossier de sources réellement contrôlé.
 *
 *  Renvoie toujours `{ relation, motif, url }` : la relation est opposable, le motif explique la
 *  décision à un lecteur, et l'URL permet de remonter à la source. */
export function validateEvidence({ url, extrait }, sources = []) {
  const cible = String(url ?? "");
  const source = (sources ?? []).find(candidate => candidate?.url === cible);

  if (!source) return { url: cible, relation: RELATIONS.SOURCE_ABSENTE, motif: MOTIFS.SOURCE_ABSENTE };
  if (source.accessible !== true) return { url: cible, relation: RELATIONS.SOURCE_INJOIGNABLE, motif: MOTIFS.SOURCE_INJOIGNABLE };

  const cite = String(extrait ?? "").trim();
  if (!cite) return { url: cible, relation: RELATIONS.CITATION_ABSENTE, motif: MOTIFS.CITATION_ABSENTE };
  if (!citationPresente(cite, source.markdown)) {
    return { url: cible, relation: RELATIONS.CITATION_INTROUVABLE, motif: MOTIFS.CITATION_INTROUVABLE };
  }
  return { url: cible, relation: RELATIONS.SUPPORTS, motif: MOTIFS.SUPPORTS };
}

/** Une contradiction n'est opposable que si sa citation est prouvée présente dans la page.
 *
 *  Sans ce contrôle, il suffisait qu'une URL réponde pour qu'une contradiction inventée dégrade le
 *  statut d'une analyse. */
export function validateContradiction(contradiction, sources = []) {
  const preuve = validateEvidence({ url: contradiction?.source, extrait: contradiction?.extrait }, sources);
  return { ...contradiction, preuve, confirmee: preuve.relation === RELATIONS.SUPPORTS };
}

/** Règles déterministes de rétrogradation d'une affirmation.
 *
 *  Le statut `VERIFIE` est décidé par l'auditeur, un modèle. Ces trois règles ne demandent aucun
 *  jugement : elles constatent qu'une affirmation dite vérifiée ne s'appuie sur rien de contrôlable.
 *  Une affirmation rétrogradée conserve la trace de ce qui l'a fait rétrograder.
 *
 *  Aucune promotion en sens inverse : le code peut retirer un statut que rien n'étaye, il n'est pas
 *  fondé à en accorder un. */
export function validateClaimSources(claim, sources = []) {
  if (claim?.statut !== "VERIFIE") return claim;

  const referencees = claim.sources ?? [];
  if (!referencees.length) {
    return { ...claim, statut: "NON_VERIFIE", retrogradation: "aucune source n'est rattachée à cette affirmation" };
  }

  const connues = new Map((sources ?? []).map(source => [source?.url, source]));
  const presentes = referencees.filter(url => connues.has(url));
  if (!presentes.length) {
    return { ...claim, statut: "NON_VERIFIE", retrogradation: "aucune des sources citées ne figure dans le dossier contrôlé" };
  }

  const joignables = presentes.filter(url => connues.get(url)?.accessible === true);
  if (!joignables.length) {
    return { ...claim, statut: "NON_VERIFIE", retrogradation: "aucune des sources citées n'a pu être extraite" };
  }

  return { ...claim, sourcesJoignables: joignables };
}

export function validateClaims(claims = [], sources = []) {
  return (claims ?? []).map(claim => validateClaimSources(claim, sources));
}

/** Décompte des rétrogradations, pour le fil de suivi. */
export function downgradedClaims(claims = []) {
  return (claims ?? []).filter(claim => claim.retrogradation);
}
