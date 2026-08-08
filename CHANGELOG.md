# Changelog

Toutes les évolutions notables de ce projet sont documentées dans ce fichier.

Le format suit les principes de [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/),
et le projet respecte le [Versionnage Sémantique](https://semver.org/lang/fr/) (`MAJEUR.MINEUR.CORRECTIF`) :

- **MAJEUR** : changement incompatible avec les versions précédentes (ex. contrat d'API modifié, schéma de données incompatible).
- **MINEUR** : nouvelle fonctionnalité rétrocompatible.
- **CORRECTIF** : correction de bug rétrocompatible.

Le numéro de version affiché par l'application (`GET /api/health`, pied de page) est lu directement
depuis `package.json` (`server.js`) — il n'existe qu'une seule source de vérité, pour éviter toute
désynchronisation entre le code et le numéro affiché.

## [Non publié]

## [1.1.7] - 2026-08-08

### Corrigé

- **Firecrawl n'était jamais sollicité, quel que soit l'état de la case « Vérification approfondie
  des sources via Firecrawl ».** Le formulaire lisait `isChecked('#firecrawl')`, un sélecteur ne
  correspondant à aucun élément du DOM (la case réelle a l'id `webSearch`) : `isChecked` renvoyait
  donc toujours `false`, et `firecrawlEnabled` restait `false` côté serveur dans tous les cas.
  Corrigé en lisant le bon élément (`#webSearch`). Bug repéré après plusieurs analyses de test sans
  aucun log `[firecrawl]`, quelle que soit la case cochée — voir le log de diagnostic ajouté en
  1.1.6 qui a permis de confirmer que `verifySources()` n'était même jamais atteinte.

## [1.1.6] - 2026-08-08

### Ajouté

- Log `[firecrawl]` indiquant le nombre de sources candidates trouvées (annotations OpenRouter +
  URL en texte brut du document) avant même l'appel à Firecrawl. Plusieurs analyses consécutives
  n'avaient produit aucun log Firecrawl malgré l'option activée, sans qu'il soit possible de
  distinguer depuis les logs existants « aucune URL citée par le rédacteur » (normal) d'un
  éventuel bug empêchant les candidats trouvés d'atteindre `scrapeFirecrawl()`.

## [1.1.5] - 2026-08-08

### Ajouté

- La demande (tronquée) apparaît désormais en tête du fil de suivi « Suivi de l'analyse », dès le
  lancement et après une reconnexion, pour confirmer visuellement quelle demande est en cours de
  traitement.

### Corrigé

- `currentRunId` était lu depuis `localStorage` au démarrage de la page mais n'y était jamais écrit
  nulle part dans le code actuel : une valeur laissée par une version antérieure du site pouvait
  donc rester bloquée indéfiniment, faisant reprendre le suivi d'un job ancien et sans rapport à
  chaque rechargement de page, quelle que soit la nouvelle demande soumise. `currentRunId` (et la
  demande associée) est maintenant correctement persisté à chaque nouveau job.

## [1.1.4] - 2026-08-08

### Corrigé

- Le fil de suivi affichait des entrées en double (stratégie, rédaction…) après une reconnexion
  silencieuse de l'EventSource (veille mobile, changement de réseau) : le serveur rejoue alors tout
  l'historique du job, que le client réaffichait sans détecter qu'il l'avait déjà traité. Chaque
  événement porte désormais un numéro de séquence croissant par job (`emit()`), et le client ignore
  tout événement déjà vu pendant la connexion en cours.

## [1.1.3] - 2026-08-08

### Corrigé

- `OPENROUTER_MAX_TOKENS` porté de 7000 à 12000 : constaté en production, un audit détaillé
  (nombreuses anomalies décrites en détail) pouvait dépasser 7000 tokens et se faire tronquer en
  plein milieu du JSON (`finish_reason=length`), provoquant l'échec de l'analyse — repéré grâce au
  message d'erreur explicite ajouté en 1.1.1.

## [1.1.2] - 2026-08-08

### Supprimé

- Le cadre d'attente « Prêt pour une contre-analyse » du panneau de résultats. Le panneau reste
  désormais entièrement masqué (au lieu d'afficher un grand encart vide) tant qu'aucune analyse
  n'a été lancée ou reprise, et n'apparaît que pour le suivi de progression ou le résultat.

## [1.1.1] - 2026-08-08

### Corrigé

- Le message de stratégie du fil de suivi (« Claude rédige, GPT audite et Grok arbitre ») était
  codé en dur, indépendamment des modèles réellement sélectionnés (visible en sélection manuelle :
  un rédacteur Kimi affichait quand même « Claude rédige »). Il cite désormais les modèles
  effectivement utilisés.
- `scrapeFirecrawl()` ne produisait aucun log, rendant impossible de vérifier depuis les logs
  serveur si l'API Firecrawl fonctionnait réellement. Ajout de logs `[firecrawl]` par URL
  (tentative, succès avec taille extraite, échec avec raison).
- Le repli automatique vers un modèle de secours (déclenché quand un modèle ne renvoie que des
  réponses vides) ne s'appliquait qu'aux modèles Kimi et ne bénéficiait que d'une seule tentative,
  contrairement au modèle d'origine qui en avait deux (avec puis sans recherche web) — ce qui a pu
  faire échouer une analyse en production quand le repli lui-même est ressorti vide sans deuxième
  chance. Le repli s'applique désormais à n'importe quel modèle en échec, avec le même traitement
  de réessai que le modèle d'origine.
- `parseJson()` (audit et arbitrage) ne tentait qu'une seule extraction de secours en cas de JSON
  invalide, insuffisante pour un contenu enveloppé dans un bloc de code markdown ```` ```json ``` ````.
  Ajout d'une étape d'extraction supplémentaire, et journalisation du contenu brut et du
  `finish_reason` en cas d'échec total, pour diagnostiquer la cause exacte (troncature par la
  limite de tokens, texte parasite, etc.) au lieu d'une simple erreur de syntaxe sans contexte.

## [1.1.0] - 2026-08-08

### Ajouté

- La page d'accueil affiche désormais l'état des 4 services externes (OpenRouter, Firecrawl,
  authentification Google, base de données), **visible avant connexion** puisqu'il repose sur
  `GET /api/health` qui ne nécessite pas d'authentification. Auparavant, seuls OpenRouter et
  Firecrawl étaient affichés, et uniquement après connexion — ce qui rendait un défaut de
  configuration Google OAuth invisible pour un visiteur ne pouvant justement pas se connecter.
- Ce fichier CHANGELOG et une politique de versionnage explicite (SemVer).

### Corrigé

- Le numéro de version (`RELEASE` dans `server.js`) est désormais lu depuis `package.json` au lieu
  d'être dupliqué en dur, pour supprimer le risque de désynchronisation entre les deux.

## [1.0.0] - 2026-08-08

### Changé

- Le projet est présenté comme une application autonome : suppression de toute référence à un
  dépôt d'origine (« fork corrigé »), le contenu correspondant étant reformulé comme des
  caractéristiques propres à l'application (sécurité, fiabilité, ergonomie).
- Numérotation de version repartie à `1.0.0`.
- Documentation d'architecture complète ajoutée au README : stack technique, arborescence, modèle
  de données PostgreSQL, authentification, routes API, déroulé détaillé de la boucle d'analyse,
  mécanisme de diffusion SSE, gestion des jobs en mémoire.

### Corrigé

- Une erreur d'initialisation de la base de données au démarrage (`DATABASE_URL` invalide, base
  injoignable, certificat TLS refusé, etc.) faisait planter tout le processus (`exit 1`) alors que
  l'application est conçue pour fonctionner sans base, en mode dégradé (historique et tableau de
  bord alors limités à la mémoire du process). `initDb()` est désormais protégée par un
  `try/catch` : une erreur y est loguée sans interrompre le démarrage du serveur.
