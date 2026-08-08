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

## [1.4.0] - 2026-08-08

### Corrigé

- **Le verdict explicite de l'auditeur était ignoré par la condition d'arrêt.** Le contrat JSON
  impose un champ `decision` valant `VALIDER` ou `CORRIGER`, le prompt d'auditeur détaille
  longuement quand refuser la validation, et la valeur produite était affichée dans le fil de
  suivi — mais la boucle ne lisait que `score_global`, la gravité des anomalies et
  `nouveau_cycle_requis`. Un auditeur concluant `CORRIGER` avec un score de 95 et aucune anomalie
  sévère voyait la boucle s'arrêter contre son avis. Vérifié de bout en bout : à chiffres
  identiques, un audit `VALIDER` s'arrête après un cycle, un audit `CORRIGER` en exécute trois.

- **Les anomalies de gravité « élevée » écrites avec accents n'étaient pas reconnues comme
  bloquantes.** La comparaison se faisait par simple mise en minuscules contre `["critique",
  "elevee"]`. Le contrat JSON demande bien `elevee` sans accent, mais les modèles écrivent
  naturellement « élevée » — l'orthographe qu'emploie le prompt d'auditeur lui-même. Une anomalie
  élevée accentuée passait donc pour non bloquante et laissait valider un document que l'auditeur
  jugeait insuffisant : exactement le contraire de la règle « une affirmation importante non
  prouvée est au minimum une anomalie élevée ». La comparaison ignore désormais casse et accents.

### Modifié

- La condition d'arrêt est isolée dans `shouldStopAfterAudit()` (`lib/audit.js`) et renvoie les
  **motifs** de poursuite plutôt qu'un simple booléen. Ils apparaissent dans le fil de suivi et
  dans la raison d'arrêt enregistrée : « un cycle de plus » devient une décision lisible
  (« score 72/100 inférieur au seuil de 90 ; 2 anomalie(s) critique(s) ou élevée(s) ») au lieu
  d'un comportement opaque.
- Un champ `decision` absent ou inintelligible reste neutre et ne bloque pas à lui seul : sans
  cette réserve, un modèle omettant le champ ferait consommer tous les cycles à chaque analyse, en
  silence.

## [1.3.2] - 2026-08-08

### Corrigé

- **La barre de progression reculait au passage d'un cycle au suivant.** Les pourcentages étaient
  calculés par trois formules affines du numéro de cycle (`12 + cycle × 12` pour la vérification
  des sources, `22 + cycle × 14` pour l'audit, `30 + cycle × 16` pour la correction) qui ignoraient
  `maxCycles` et se chevauchaient : avec le réglage par défaut de trois cycles, la barre affichait
  46 % à la fin du cycle 1 puis **36 %** au début du cycle 2, et de nouveau 62 % puis 48 %. Les
  mêmes formules dépassaient 100 % dès quatre cycles (94 %, puis 110 % au cinquième), ce que seule
  la borne appliquée côté client masquait.

  Les étapes de cycle se répartissent désormais dans une bande [10 %, 90 %] découpée en tranches
  égales — une par cycle, elle-même partagée entre les trois étapes (`lib/progress.js`). La
  progression est strictement croissante quel que soit le nombre de cycles, et les bornes fixes
  (rédaction initiale 8 %, arbitrage 92 %, fin 100 %) encadrent l'ensemble. Un arrêt anticipé de la
  boucle fait sauter la barre vers l'arbitrage, sans jamais la faire revenir en arrière.

  Suites effectivement émises, vérifiées de bout en bout sur le flux SSE :
  - trois cycles : 8 → 10 → 19 → 28 → 37 → 46 → 54 → 63 → 72 → 92 → 100 ;
  - cinq cycles : 8 → 10 → 15 → 21 → … → 74 → 79 → 92 → 100.

## [1.3.1] - 2026-08-08

### Corrigé

- **Le formulaire annonçait des limites d'upload que le serveur refusait.** Le sélecteur de
  documents indiquait « Ajouter jusqu'à 5 documents · 10 Mo maximum par fichier » alors que
  `UPLOAD_MAX_FILES` vaut 3 et `UPLOAD_MAX_FILE_BYTES` 5 Mo : l'utilisateur qui suivait l'interface
  récoltait une erreur 400 (« Maximum 3 fichiers par analyse », « Un fichier dépasse la limite de
  5 Mo »). Le libellé est aligné sur les limites réellement appliquées, que le README documentait
  déjà correctement. Un test de cohérence (`test/interface.test.js`) compare désormais les deux
  valeurs annoncées à celles du serveur, pour que l'écart ne puisse pas réapparaître.

## [1.3.0] - 2026-08-08

### Ajouté

- **Suite de tests** (`npm test`), fondée sur le lanceur intégré de Node (`node:test`), sans aucune
  dépendance supplémentaire : 51 tests couvrant la classification du domaine, la sélection des
  modèles et sa liste blanche, la concurrence bornée, le parsing JSON tolérant, l'extraction et la
  classification des sources, l'agrégation du tableau de bord et les noms de fichiers exportés.
  `npm run check` enchaîne désormais la vérification de syntaxe puis les tests.
- **Tests de cohérence entre l'interface et le serveur** (`test/interface.test.js`) : tout
  identifiant interrogé par `public/app.js` doit exister dans le DOM, tout modèle proposé par le
  formulaire doit figurer dans la liste blanche, tout format d'export proposé doit être géré par la
  route d'export, et les extensions du sélecteur de fichiers doivent correspondre à celles
  acceptées par le serveur. Cette famille de bugs ne produit aucune erreur visible : la 1.1.7
  corrigeait un sélecteur `#firecrawl` inexistant qui rendait `isChecked()` toujours faux et
  désactivait Firecrawl en silence. Rejoué sur la révision fautive, le test le signale.

### Modifié

- **La logique sans effet de bord est extraite dans `lib/`** (`task.js`, `models.js`, `utils.js`,
  `sources.js`, `dashboard.js`), `server.js` conservant le câblage HTTP, la boucle d'analyse et les
  accès réseau. Cette séparation est ce qui rend les tests possibles : `server.js` démarre un
  serveur au chargement du module et ne peut donc pas être importé par une suite de tests. Aucun
  comportement n'est modifié — les fonctions sont déplacées à l'identique.
- La résolution des modèles d'une analyse est isolée dans `resolveModels()`, afin que la régression
  corrigée en 1.2.0 (les modèles du formulaire écrasant la sélection automatique) soit couverte par
  un test plutôt que par une lecture attentive.

## [1.2.0] - 2026-08-08

### Corrigé

- **La sélection automatique des modèles n'a jamais été appliquée.** L'interface transmettait
  systématiquement la valeur de ses trois sélecteurs de modèles — masqués en mode automatique mais
  toujours renseignés — et le serveur les prenait en compte inconditionnellement. Le tableau
  `MODEL_DEFAULTS` (Opus pour les domaines techniques, financiers et juridiques ; Sonnet pour
  l'actualité et l'analyse générale) était donc inopérant : la « sélection automatique » se
  contentait en réalité des valeurs par défaut du formulaire, et une demande classée `technical`
  était rédigée par Sonnet là où la documentation annonce Opus. Le serveur ignore désormais les
  modèles transmis lorsque le mode automatique est actif ; l'interface, symétriquement, ne les
  envoie plus dans ce cas.
- **Une analyse terminée était intégralement perdue lorsque son enregistrement en base échouait.**
  `saveRun()` était attendu avant la publication du résultat : une erreur PostgreSQL (connexion
  coupée, délai dépassé) remontait au gestionnaire d'erreur du job et l'utilisateur perdait un
  document produit au prix de plusieurs cycles de modèles, alors même que l'application est conçue
  pour fonctionner sans base. L'échec de persistance est désormais capturé, journalisé et signalé
  dans le fil de suivi, mais le résultat est publié dans tous les cas. Le champ `persisted` du
  résultat indique si l'exécution a bien été écrite en base.
- **Le type de tâche était déduit du contenu des documents joints.** La classification portait sur
  la demande *concaténée au texte intégral des pièces jointes* : un PDF mentionnant « github » ou
  « budget » suffisait à basculer le domaine détecté, et donc le choix des modèles, indépendamment
  de la demande réelle. C'était également une surface d'injection indirecte — une pièce jointe ne
  doit pas choisir le modèle qui la traitera. La classification porte désormais sur la seule
  demande saisie par l'utilisateur.

### Sécurité

- **Restriction des modèles acceptés en sélection manuelle à une liste blanche.** `validateModel()`
  ne contrôlait que le *format* de l'identifiant OpenRouter. Comme `OPENROUTER_API_KEY` (clé du
  déploiement) prime sur la clé fournie par l'utilisateur, tout compte authentifié pouvait faire
  facturer au déploiement le modèle de son choix, aussi coûteux soit-il, en appelant directement
  `POST /api/jobs`. Le `<select>` de l'interface ne constituait pas une protection. La liste
  autorisée est dérivée de `MODEL_LABELS`, qui reflète déjà les options proposées par l'interface.

### Modifié

- **Les sources vérifiées par Firecrawl sont mémorisées pour toute la durée de l'analyse.**
  `verifySources()` étant rappelée à chaque cycle, les URL déjà contrôlées étaient intégralement
  re-extraites : sur une analyse de trois cycles citant les mêmes sources, jusqu'à trois fois plus
  d'appels Firecrawl payants pour un résultat identique, et une latence proportionnelle. Mesuré sur
  un scénario de trois cycles avec deux sources stables et une nouvelle source par version : neuf
  extractions auparavant, cinq désormais. Deux conséquences volontaires :
  - le budget `MAX_SOURCES_PER_RUN` (10) s'applique maintenant à l'analyse entière, conformément à
    son nom, et non plus à chaque cycle pris isolément ;
  - `result.sources` cumule toutes les sources contrôlées au fil des cycles au lieu d'être écrasé
    par le seul lot du dernier cycle — le même scénario conserve cinq sources dans le rapport final
    contre trois auparavant.
- **Le tableau de bord ne rapatrie plus les documents complets depuis la base.** `dashboardRows()`
  sélectionnait la colonne `result` entière sur 90 jours d'exécutions — document final, toutes ses
  versions intermédiaires et le contenu intégral de chaque réponse de modèle — pour n'en exploiter
  que la consommation par appel. La requête projette désormais `result->'calls'`, laissant le tri à
  PostgreSQL.

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
