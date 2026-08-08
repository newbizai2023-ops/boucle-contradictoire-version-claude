// Classification du domaine de la demande et cadrage correspondant du rédacteur.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

export const taskGuidance = {
  technical: "DOMAINE TECHNIQUE : vérifie versions, prérequis, compatibilités, limites, sécurité, exemples reproductibles et documentation officielle. Sépare comportement documenté, comportement observé et hypothèse.",
  financial: "DOMAINE FINANCIER/FINOPS : indique devise, région, période, taxes, remises, hypothèses d'usage, coûts unitaires, formules, scénarios et sensibilité. Ne compare que des périmètres économiquement équivalents.",
  legal: "DOMAINE JURIDIQUE/CONFORMITÉ : privilégie textes officiels et versions consolidées. Indique juridiction, date d'entrée en vigueur, champ d'application, exceptions et incertitude. Ne présente pas l'analyse comme un avis juridique.",
  current_research: "DOMAINE D'ACTUALITÉ : distingue date de publication et date de l'événement, vérifie les mises à jour, privilégie documents de première main et signale les faits encore évolutifs.",
  general_analysis: "DOMAINE GÉNÉRAL : explicite critères, périmètre, hypothèses et limites ; privilégie les sources primaires et les comparaisons homogènes."
};

export function writerPrompt(task, request) {
  return `${taskGuidance[task] || taskGuidance.general_analysis}\n\nDEMANDE À TRAITER :\n${request}`;
}

// Mots-clés par domaine, testés sur des mots entiers. La recherche par sous-chaîne produisait des
// faux positifs silencieux et absurdes : « trois » contient « roi » (donc financial), « rapide »
// contient « api » (donc technical). Anodin tant que le type de tâche ne pilotait que le choix des
// modèles ; devenu coûteux depuis que `financial` et `legal` déclenchent automatiquement un second
// avis, c'est-à-dire deux appels de modèle de plus.
//
// Les frontières ne peuvent pas être `\b` : celui-ci se place entre un caractère de mot et un
// non-mot au sens ASCII, si bien que « coût » se coupe au « û » et que `\bcout\b` échouerait sur
// « coûts ». La délimitation se fait donc sur les caractères qui ne sont ni lettres (accents
// compris) ni chiffres.
const FRONTIERE = "[^\\p{L}\\p{N}]";
const DOMAIN_KEYWORDS = {
  legal: ["contrat", "contrats", "juridique", "juridiques", "loi", "lois", "légal", "légale", "réglement", "règlement", "règlementation", "réglementation", "conformité", "rgpd", "clause", "clauses", "litige"],
  financial: ["prix", "coût", "coûts", "cout", "couts", "budget", "budgets", "finops", "roi", "rentabilité", "économie", "économies", "facturation", "amortissement", "tco", "financier", "financière"],
  technical: ["code", "bug", "bugs", "api", "apis", "architecture", "développement", "développer", "script", "scripts", "github", "déploiement", "logiciel", "serveur"],
  current_research: ["actualité", "actualités", "récent", "récente", "récents", "récentes", "dernier", "dernière", "derniers", "dernières", "aujourd'hui", "annonce", "annonces", "veille"]
};

// Ordre d'arbitrage lorsqu'une demande relève de plusieurs domaines. Le domaine dont une erreur se
// paie le plus cher l'emporte : une « architecture financière » doit être traitée comme financière,
// pas comme technique — c'était l'inverse auparavant, le premier test gagnant par simple position.
const DOMAIN_PRIORITY = ["legal", "financial", "technical", "current_research"];

const motPresent = (value, mot) => {
  const motif = mot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|${FRONTIERE})${motif}($|${FRONTIERE})`, "iu").test(value);
};

/** Domaines détectés dans la demande, du plus au moins prioritaire. Exposé pour les diagnostics et
 *  les tests : une demande multi-domaine doit rester lisible comme telle. */
export function detectDomains(request) {
  const value = String(request ?? "");
  return DOMAIN_PRIORITY.filter(domain => DOMAIN_KEYWORDS[domain].some(mot => motPresent(value, mot)));
}

/** Classe la demande par domaine. À n'appliquer qu'à la demande saisie par l'utilisateur, jamais au
 *  texte des documents joints : une pièce jointe ne doit pas choisir le modèle qui la traitera. */
export function detectTask(request) {
  return detectDomains(request)[0] || "general_analysis";
}
