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

/** Classe la demande par domaine. À n'appliquer qu'à la demande saisie par l'utilisateur, jamais au
 *  texte des documents joints : une pièce jointe ne doit pas choisir le modèle qui la traitera. */
export function detectTask(request) {
  const value = request.toLowerCase();
  if (/code|bug|api|architecture|dévelop|script|github/.test(value)) return "technical";
  if (/prix|coût|budget|finops|roi|économie|facturation/.test(value)) return "financial";
  if (/contrat|juridique|loi|règlement|conformité/.test(value)) return "legal";
  if (/actualité|récent|derni|aujourd|annonce|veille/.test(value)) return "current_research";
  return "general_analysis";
}
