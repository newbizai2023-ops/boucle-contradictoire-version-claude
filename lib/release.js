// Moment où la version en cours d'exécution a été produite.
//
// Le numéro de version dit *quoi* tourne ; il ne dit pas *depuis quand*. La question s'est posée
// concrètement : après une fusion, savoir si l'instance déployée sert déjà le nouveau code demandait
// d'aller lire l'historique des déploiements chez l'hébergeur.
//
// Aucune de ces dates n'est parfaite, et le projet n'a pas d'étape de construction où en graver une.
// D'où une cascade, de la plus fidèle à la plus approximative, chacune assumée comme telle :
//
//   1. la date du commit — c'est littéralement le moment où la version a été produite, et elle ne
//      bouge pas si le service redémarre ;
//   2. la date du fichier `package.json` — celle de la récupération du dépôt par l'hébergeur, donc
//      la construction ; utile quand le dépôt Git n'accompagne pas le déploiement ;
//   3. le démarrage du processus — toujours disponible, mais c'est la seule qui *ment* sur une
//      instance qui s'endort : le plan gratuit redémarre plusieurs fois par jour sans qu'aucune
//      version nouvelle ait été produite.
//
// La source retenue est renvoyée avec la date, pour que l'interface puisse dire ce qu'elle affiche
// au lieu de laisser croire à une précision qu'elle n'a pas.

export const RELEASE_DATE_SOURCES = {
  commit: "date du commit de cette version",
  fichiers: "date de récupération du dépôt par l'hébergeur",
  demarrage: "démarrage du service — la version peut être plus ancienne"
};

/** Date ISO valide, ou null. Écarte aussi bien `undefined` qu'une chaîne inexploitable. */
function isoValide(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Retient la première date exploitable de la cascade, et nomme sa provenance.
 *
 *  Renvoie toujours un objet : `startedAt` étant fourni par l'appelant au chargement du module, le
 *  dernier repli ne peut pas manquer. Si même lui est inexploitable, `date` vaut null et l'interface
 *  n'affiche simplement rien — un champ absent vaut mieux qu'une date inventée. */
export function resolveReleaseDate({ commitDate, packageMtime, startedAt } = {}) {
  for (const [source, valeur] of [["commit", commitDate], ["fichiers", packageMtime], ["demarrage", startedAt]]) {
    const date = isoValide(valeur);
    if (date) return { date, source, precision: RELEASE_DATE_SOURCES[source] };
  }
  return { date: null, source: null, precision: null };
}
