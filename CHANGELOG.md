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

**Chaque pull request incrémente la version** et publie son entrée ici, plutôt que de s'accumuler
en « Non publié ». Le déploiement affiche donc toujours un numéro qui désigne exactement ce qui
tourne : sans cette règle, deux états différents du service portent le même numéro, et une
observation faite sur l'instance déployée devient impossible à rattacher à un état du code — cas
rencontré avec les 1.8.0 successives.

## [Non publié]

## [1.11.0] - 2026-08-09

### Corrigé

- **Une approbation de l'arbitre écrite `APPROUVÉ` était enregistrée comme un rejet.** La comparaison
  était stricte — `arbitration.decision === "APPROUVE"` — alors que `CLAUDE.md` pose la règle
  inverse : les valeurs produites par un modèle se comparent sans accents et sans casse, jamais par
  égalité. Le contrat JSON demande `APPROUVE` sans accent, mais « approuvé » s'écrit avec, et un
  arbitre qui rédige en français répond naturellement `APPROUVÉ` : son approbation tombait alors dans
  la branche par défaut. Même classe d'erreur que `isSevere` avant la 1.5.0, sur la décision la plus
  lourde du dispositif.

  La dérivation passe désormais par `arbitrationStatus` (`lib/audit.js`), qui normalise aussi les
  séparateurs : « Approuvé avec réserves » avec des espaces vaut `APPROUVE_AVEC_RESERVES`. Une
  décision absente ou inintelligible reste un rejet — un modèle qui omet le champ ne doit pas faire
  valider un document — mais `decisionIntelligible` permet désormais de le dire dans le fil de suivi
  au lieu de laisser une faute de forme passer pour un rejet motivé.

  **Ce bug n'explique pas les rejets observés sur l'instance déployée** : les journaux montrent un
  `arbitrage=REJETE` explicite sur les deux analyses achevées du 8 août. Il était latent.

- **L'historique affichait indéfiniment des analyses que le serveur n'a jamais enregistrées.**
  `loadHistory` fusionnait les lignes du cache local que la réponse serveur ne contenait plus, ce qui
  les rendait définitives : colonnes vides, statut jamais enregistré, et rien pour les distinguer
  d'une vraie ligne. Le cache sert à peindre le tableau avant la réponse réseau et à ne pas laisser
  la page vide si le serveur est injoignable ; il ne fait pas autorité, et la réponse le remplace
  désormais entièrement.

  `rememberRun` est retirée : définie et jamais appelée depuis son introduction, elle laissait croire
  que le client alimentait ce cache avec les analyses qu'il voyait finir.

### Ajouté

- **Points de reprise : une analyse tuée en vol laisse désormais une trace.** La boucle dure dix à
  vingt minutes et ne gardait son état qu'en mémoire jusqu'à l'écriture finale. Sur le plan gratuit
  l'instance est recyclée bien avant : le 8 août, **18 analyses ont été lancées et 2 ont atteint leur
  ligne de fin**. Les 16 autres n'ont laissé aucune trace — ni document, ni cycles, ni le coût déjà
  engagé, qui se compte en dollars par analyse. Le gestionnaire d'erreur ne les rattrapait pas : il
  ne se déclenche que si la promesse est rejetée, jamais si le processus est tué.

  `saveCheckpoint` enregistre l'état courant dès la première version rédigée, puis à la fin de chaque
  cycle d'audit — les deux moments après lesquels il serait le plus coûteux de tout reperdre. Le
  document déjà produit est promu depuis la dernière version, sans quoi le point de reprise aurait
  gardé le coût et les cycles mais pas le texte, soit précisément ce qu'on veut récupérer.

  Le statut écrit est `interrupted`, pas `running` : une ligne lue en base décrit ce qui a survécu, et
  ce qui survit d'une analyse inachevée est une interruption. L'écriture finale la remplace par le
  statut réel, si bien qu'une ligne restée `interrupted` l'a vraiment été — là où un `running` jamais
  mis à jour resterait lisible comme une analyse en cours. Aucune modification du schéma : `saveRun`
  était déjà rejouable (`ON CONFLICT DO UPDATE`, puis suppression des lignes filles avant
  réinsertion). Un échec de point de reprise est journalisé et n'interrompt jamais l'analyse.

- **Compteur « Interrompues »** dans les données historisées. Ces analyses n'étant ni validées, ni
  rejetées, ni en échec déclaré, elles gonflaient le total sans apparaître nulle part, et le coût
  qu'elles avaient engagé passait pour celui d'analyses abouties.

### Vérifié

  Sur une base PostgreSQL réelle (`initdb` + `pg_ctl` local, utilisateur dédié) et un faux OpenRouter
  local rejouant la boucle complète, sans dépense :

  - une analyse dont l'arbitre répond `APPROUVÉ` est enregistrée `validated`, `arbiter_decision`
    conservant l'orthographe rendue ;
  - le processus tué par `SIGKILL` en plein cycle laisse une ligne `interrupted` portant ses 2 cycles,
    son coût et son document ;
  - **la même exécution, points de reprise retirés, ne laisse aucune ligne** — c'est la mutation qui
    établit que le correctif porte bien sur le symptôme observé.

  181 tests (177 auparavant).

## [1.10.1] - 2026-08-09

### Corrigé

- **Le bouton radio « Automatique » flottait à l'écart de son libellé** dans le choix du second avis
  indépendant. La règle globale `small { display: block }` s'appliquait aussi au complément qui suit
  le libellé — « Automatique <small>juridique et financier</small> » — qui passait donc à la ligne.
  Le label étant un conteneur flex en `align-items: center`, le bouton se centrait alors sur les deux
  lignes et se retrouvait à mi-hauteur, visuellement détaché du texte auquel il se rapporte.

  `.radio-row small` remet `display: inline` et annule la marge haute : le complément est une incise,
  pas un bloc. Mesuré au navigateur réel avant/après, à 412 px comme à 1280 px : hauteur du label de
  40 px à 19 px, écart vertical entre le bouton et son complément de 12 px à 0. Validé par mutation —
  retirer `display: inline` restaure les 40 px et l'écart de 12 px.

  Même cause que le correctif de largeur de la 1.8.0 (`input { width: 100% }` qui repoussait le
  libellé) : une règle globale du formulaire qui atteint un élément conçu pour une autre disposition.

## [1.10.0] - 2026-08-09

### Ajouté

- **Date et heure de production de la version, à côté de son numéro dans l'en-tête.** Le numéro dit
  *quoi* tourne, pas *depuis quand* : après une fusion, vérifier que l'instance déployée sert bien le
  nouveau code demandait d'aller lire l'historique des déploiements chez l'hébergeur.

  Le projet n'a pas d'étape de construction où graver cette date. `lib/release.js` la résout donc au
  chargement du module par une cascade de trois sources, de la plus fidèle à la plus approximative :

  1. la date du dernier commit (`git log -1 --format=%cI`) — littéralement le moment où la version a
     été produite, et elle ne bouge pas quand le service redémarre ;
  2. la date de modification de `package.json` — celle de la récupération du dépôt par l'hébergeur,
     utile quand le dépôt Git n'accompagne pas le déploiement ;
  3. le démarrage du processus — toujours disponible, mais la seule qui *mente* : le plan gratuit
     endort l'instance plusieurs fois par jour, et elle affichait alors l'heure du dernier réveil
     comme si une version venait d'être produite.

  La source retenue accompagne la date (`releaseDateSource`, `releaseDatePrecision` dans
  `GET /api/health`) et l'interface la reprend en infobulle, précisément pour que le troisième cas
  se lise comme tel au lieu de passer pour le premier. Les deux premières sources sont lues sur le
  disque et leur échec est normal selon l'endroit où le service tourne : il est traité comme une
  absence, jamais comme une erreur. Si aucune n'est exploitable, le badge est masqué — un champ
  absent vaut mieux qu'une date inventée.

  Date formatée en `fr-FR` explicitement, pas dans la locale du navigateur : la page est
  intégralement en français, et un navigateur en anglais affichait « Aug 9, 2026 » au milieu du
  reste (constaté au navigateur réel, comme le reste de cette vérification — badge présent, sans
  débordement horizontal et sans erreur console à 412 px comme en 1280 px, thèmes clair et sombre,
  et effectivement masqué quand `/api/health` ne porte pas de date).

- **Contrôle de cohérence sur `/api/health`** (`test/interface.test.js`) : tout champ lu par
  `public/app.js` sous la forme `health.<champ>` doit exister dans la réponse construite par
  `server.js`. C'est la classe de bug la plus coûteuse ici — un champ absent vaut `undefined`, le
  badge se masque, et rien ne signale l'écart. Validé par mutation : retirer `releaseDate` de la
  route fait bien échouer le test.

  177 tests (171 auparavant).

## [1.9.0] - 2026-08-09

### Ajouté

- **Trois modèles de plus au choix** : Gemini Flash (`~google/gemini-flash-latest`), DeepSeek V4
  Flash (`~deepseek/deepseek-v4-flash-latest`) et Claude Haiku (`~anthropic/claude-haiku-latest`).
  Kimi était déjà proposé. Ils rejoignent `MODEL_LABELS`, donc la liste blanche `ALLOWED_MODELS`,
  et les trois sélecteurs du formulaire.

  Aucun changement des valeurs par défaut : ces modèles sont disponibles en sélection manuelle,
  ils ne sont choisis automatiquement pour aucun domaine. Les listes de repli du second avis et de
  la réfutation restent inchangées.

  **Modèles constatés au catalogue, identifiants déduits.** L'environnement qui a produit ce
  changement n'a pas accès au réseau vers `openrouter.ai` ; la présence des quatre modèles a donc été
  vérifiée sur une capture du sélecteur de modèles, qui les liste sous ces noms exacts — « DeepSeek V4
  Flash Latest », « Google Gemini Flash Latest », « Anthropic Claude Haiku Latest », « MoonshotAI
  Kimi Latest ». Les identifiants, eux, restent déduits de la convention du dépôt pour les alias
  suivant la dernière version (`~éditeur/modèle-latest`), celle de `~anthropic/claude-opus-latest` et
  `~moonshotai/kimi-latest` : le nom affiché ne donne pas la casse ni la découpe du slug. Un
  identifiant erroné ne casse rien au démarrage — il échoue à l'appel, avec le message d'erreur
  d'OpenRouter, et seulement si un utilisateur choisit ce modèle. Confirmation complète par
  `curl -s https://openrouter.ai/api/v1/models` depuis un poste qui joint le domaine.

## [1.8.4] - 2026-08-09

### Corrigé

- **Le déploiement Render était décrit comme « la production ».** Il n'en est pas une : c'est une
  instance de développement, et le seul déploiement existant à ce jour. Le mot s'était glissé dans
  cinq passages écrits ces derniers jours, dont trois normatifs — la règle d'incrément de version au
  changelog, dans le README et dans `CLAUDE.md` — qui seront relus bien plus souvent que le reste.
  Remplacé par « l'instance déployée », qui reste vrai quel que soit l'usage du service.

  `CLAUDE.md` précise désormais la nature de l'instance à l'endroit où elle est décrite, pour que la
  confusion ne se reforme pas.

  Les occurrences légitimes sont conservées : `NODE_ENV=production`, le garde-fou `DEV_BYPASS_AUTH`,
  les cookies `secure`, l'image Docker. Ce sont des noms techniques, exacts quel que soit l'usage.
  Les entrées de journal antérieures à la 1.8.0 ne sont pas retouchées : ce sont des constats
  historiques, pas des règles.

## [1.8.3] - 2026-08-09

### Ajouté

- **`CLAUDE.md`** : notes de travail pour un agent intervenant sur ce dépôt. Consigne ce qui n'est
  pas déductible du code seul — pourquoi la logique testable vit dans `lib/` (`server.js` appelle
  `app.listen()` au chargement et n'est donc pas importable par un test), les conventions du projet
  (français partout, commentaires expliquant le *pourquoi*, aucune dépendance de développement,
  une version par pull request), et les pratiques de vérification qui ont réellement attrapé des
  bugs ici : validation par mutation, tests de cohérence interface/serveur, base PostgreSQL réelle
  pour le SQL, navigateur réel pour le SSE, APIs simulées pour rejouer un run sans dépenser.

  Documente aussi les pièges propres au dépôt : l'octet NUL qui fait passer `server.js` pour
  binaire aux yeux de `grep`, l'accent grave interdit dans les commentaires SQL des littéraux de
  gabarit, le paramètre par défaut qui ne couvre pas `null`, et la nécessité de comparer les
  valeurs produites par les modèles sans accents ni casse.

  Le fichier ne cite aucun décompte de tests ou de modules : ces chiffres se périment à chaque
  version, et un guide qui ment est pire que pas de guide. Chaque affirmation vérifiable a été
  contrôlée par script avant publication.

## [1.8.2] - 2026-08-09

### Ajouté

- **`ONBOARDING.md`** : guide d'accueil pour un coéquipier découvrant Claude Code sur ce dépôt —
  dépôts à cloner, serveurs MCP à activer (GitHub, Render) et ce à quoi ils servent ici. Le fichier
  se colle tel quel dans Claude Code, qui déroule alors l'installation pas à pas.

  Aucun changement applicatif : la version est incrémentée parce que la règle le veut pour chaque
  pull request, et parce qu'un numéro qui ne bouge pas sur un dépôt qui change est exactement le
  problème que cette règle corrige.

## [1.8.1] - 2026-08-08

Trois corrections issues d'observations sur l'application déployée, et la mise à jour des textes
d'accueil. Aucun changement de contrat ni de méthodologie.

### Corrigé

- **Une étape pouvait rester silencieuse jusqu'à seize minutes.** Quand un modèle renvoie une
  réponse vide, `callOpenRouter` enchaînait jusqu'à quatre tentatives — modèle avec recherche,
  modèle sans recherche, repli avec recherche, repli sans recherche — chacune pouvant atteindre le
  délai d'expiration de quatre minutes. Aucun événement n'était émis entre-temps : le fil de suivi
  restait figé sur la même étape, indiscernable d'un blocage. Constaté sur l'instance déployée, six
  minutes d'attente sur « Second avis indépendant ».

  Deux corrections. Toute reprise émet désormais une ligne dans le fil (catégorie `retry`), qui dit
  ce qui s'est passé et ce qui est tenté. Et les étapes **facultatives** — cadrage, second avis,
  comparaison, réfutation — sont bornées à une seule tentative : leur échec est déjà prévu et sans
  conséquence sur l'analyse, il n'y a aucune raison de payer une chaîne de replis pour un
  supplément. Les étapes indispensables conservent la chaîne complète.

- **L'échec du second avis laissait son entrée en attente indéfiniment.** Le message d'échec était
  émis sous la catégorie `divergence` alors que l'étape affichée était `challenger` : l'entrée
  « Second avis indépendant » restait donc marquée en cours jusqu'à la fin de l'analyse.

- **Le choix du second avis était illisible sur mobile.** Deux défauts invisibles à la largeur de
  bureau où le contrôle avait été vérifié. Le `<legend>` d'un `<fieldset>` se place sur la bordure :
  sa description faisant quatre lignes sur un écran étroit, le bloc sortait de la carte en
  chevauchant le trait — remplacé par un conteneur portant `role="radiogroup"` et `aria-labelledby`,
  même sémantique sans ce comportement de mise en page. Et `input { width: 100% }`, appliqué à tout
  le formulaire, faisait occuper au bouton radio toute la largeur de la ligne en repoussant son
  libellé à plus de 300 px : la remise à zéro existait pour les interrupteurs, elle manquait pour
  les boutons radio.

### Modifié

- **Les textes d'accueil décrivaient encore la boucle de la 1.1** : trois rôles, des corrections
  successives jusqu'au score cible, un document sourcé en sortie. L'accroche cite désormais les cinq
  modèles et surtout ce qui est réellement contrôlé — une source ouverte, une citation retrouvée
  dans la page, une affirmation reliée à ce qui l'établit ; l'étape 2 mentionne le cadrage, la
  réfutation adversariale et l'arbitre qui ne réécrit pas ; l'étape 3 annonce un dossier plutôt
  qu'un texte. Ajout d'une métadonnée `description`, que la page n'avait pas : partager le lien
  n'affichait aucun résumé. Mêmes corrections dans la description npm et l'introduction du README.

## [1.8.0] - 2026-08-08

Robustesse des preuves. Après une analyse externe du dépôt en 1.7.0, six corrections retenues sur
les seize proposées — les autres relèvent des versions suivantes ou ont été écartées, voir la fin
d'entrée. Le fil conducteur : **passer de « le modèle affirme que la source prouve X » à « le
système peut montrer pourquoi cette source soutient X »**.

### Ajouté

- **Validation opposable des preuves** (`lib/evidence.js`). Une source qui répond n'établissait
  jusqu'ici rien de plus que son existence, et une contradiction devenait « confirmée » parce que
  son URL répondait — accessible n'a jamais valu probant.

  Le contrôle qui tranche est déterministe et ne coûte aucun appel : le modèle cite un extrait, et
  cet extrait doit se retrouver dans la page réellement extraite. Correspondance littérale, ou
  recouvrement lexical d'au moins 60 % sur les mots significatifs pour accepter une reformulation
  fidèle sans laisser passer une citation fabriquée. Une citation de moins de trois mots
  significatifs n'est jamais accordée : « le support » figure dans toute page traitant du sujet.

  Chaque échec porte sa raison, distincte : `SOURCE_ABSENTE`, `SOURCE_INJOIGNABLE`,
  `CITATION_ABSENTE`, `CITATION_INTROUVABLE`. Seule une contradiction grave **et** confirmée peut
  désormais dégrader le statut final.

- **Rétrogradation déterministe des affirmations.** Le statut `VERIFIE` est décidé par l'auditeur,
  un modèle. Trois règles le lui retirent sans aucun jugement : aucune source rattachée, aucune
  source connue du dossier contrôlé, aucune source joignable. Le code peut retirer un statut que
  rien n'étaye ; il ne s'autorise jamais à en accorder un.

- **Contrôle du second avis dans l'interface** : automatique (juridique et financier), toujours,
  jamais. Le serveur savait distinguer les trois cas depuis la 1.7.0, l'interface ne les proposait
  pas.

- **Les exports emportent le dossier de preuves** (`lib/report.js`). Markdown complet — document,
  raison d'arrêt, cadrage, affirmations, sources et leur état, désaccords, réfutation, arbitrage.
  Quatre onglets Excel supplémentaires (Affirmations, Sources, Divergences, Réfutation). Annexe
  compacte en PDF et Word. Un document exporté qui perdait ses preuves redevenait un texte parmi
  d'autres.

### Corrigé

- **Le falsificateur n'est plus l'arbitre.** La recherche adversariale était confiée au modèle
  d'arbitrage : il cherchait les contradictions, puis jugeait ses propres trouvailles — sur
  l'élément de preuve le plus lourd du dispositif, celui qui peut dégrader un `APPROUVE`. Cinquième
  rôle `falsifier` (Kimi par défaut), résolu vers un modèle distinct du rédacteur et de l'arbitre,
  y compris en sélection manuelle.

- **`detectTask()` cherchait ses mots-clés en sous-chaîne.** « trois » contient « roi » (donc
  financier), « rapide » contient « api » (donc technique). Anodin tant que le domaine ne pilotait
  que le choix des modèles ; coûteux depuis la 1.7.0, où `financial` et `legal` déclenchent
  automatiquement un second avis — soit deux appels de modèle de plus sur une classification
  absurde. Les mots-clés sont désormais cherchés sur des mots entiers, avec une frontière qui ne
  coupe pas sur les accents (`\b` couperait « coût » au « û »), et une priorité explicite entre
  domaines remplace l'ordre des conditions dans le fichier : une « architecture financière » est
  traitée comme financière.

- **Un booléen optionnel envoyé en multipart était toujours lu comme faux.** `body.diversify === true`
  ne peut jamais être vrai pour la chaîne `"true"` : le choix « toujours » de l'utilisateur se
  serait traduit par « jamais ». `parseOptionalBoolean()` distingue les trois états, `undefined`
  restant « laisse le serveur décider ».

- **Les extraits de pages Web n'étaient pas marqués comme non fiables.** Les documents joints
  l'étaient depuis la 1.3.0 ; les contenus rapportés par Firecrawl, injectés dans les prompts
  d'audit et de réfutation, ne l'étaient pas — même vecteur d'injection indirecte, sans la garde.
  Consigne partagée `EXTERNAL_CONTENT_WARNING`, appliquée à tous les rôles qui manipulent du
  contenu externe.

- **La stagnation ignorait les affirmations.** Régression introduite en 1.7.0 : depuis que les
  affirmations déterminantes non établies bloquent la validation, un cycle qui en résout trois sans
  faire bouger le score faisait le travail utile — et l'arrêt sur stagnation le jetait. La détection
  suit désormais trois dimensions : score, anomalies sévères, affirmations déterminantes non
  établies.

### Écarté ou différé

- **Recherche ciblée sur les désaccords** : les questions issues du second avis alimentent la
  correction et l'arbitrage, mais aucune étape ne garantit qu'elles reçoivent une réponse. C'est la
  suite logique, elle coûte un appel de plus et une notion de statut de divergence — hors périmètre
  de cette version.
- **Notion de risque et bascule vers un pipeline pré-recherche** : changements d'architecture, pas
  de corrections.
- **Table `run_claim_sources` et entailment sémantique par modèle** : la relation claim → source est
  aujourd'hui portée par `run_claims.sources` et validée de façon déterministe. Une table dédiée et
  un appel d'entailment n'apporteraient de valeur qu'une fois la recherche ciblée en place.

### Vérifié

- Suite `npm test` portée à 171 tests (149 auparavant), dont deux nouveaux fichiers pour la
  validation des preuves et les exports. Un test a d'ailleurs révélé un défaut réel de la première
  implémentation : le raccourci de correspondance littérale contournait le seuil de longueur, si
  bien que deux mots suffisaient à valider une citation.
- Simulation de bout en bout du pipeline complet — 20 vérifications, dont l'écart entre une
  contradiction dont la citation existe et une citation fabriquée (`CITATION_INTROUVABLE`), et la
  distinction du falsificateur et de l'arbitre.
- Rendu navigateur en clair/sombre et desktop/mobile : contrôle du second avis, état confirmé ou
  écarté de chaque contradiction, motif de rétrogradation d'une affirmation. Aucune erreur console.

## [1.7.0] - 2026-08-08

Les quatre évolutions restantes du chemin de convergence ([`docs/ANALYSE_METHODOLOGIE.md`](docs/ANALYSE_METHODOLOGIE.md)).
Là où la 1.6.0 recâblait des décisions autour d'informations déjà produites, celles-ci produisent
l'information qui manquait — elles coûtent donc des appels de modèle, et sont conditionnelles là où
elles coûtent cher.

### Ajouté

- **Cadrage préalable de la demande** (`lib/explore.js`, +1 appel court sans recherche web). Un appel
  produit les dimensions à couvrir, les questions de recherche associées, les angles morts et le
  périmètre que la demande ne tranche pas ; le tout est préfixé à la demande transmise au rédacteur.

  Sans cette étape, le périmètre de l'analyse était celui que le premier brouillon retenait en
  silence, et les cycles suivants ne pouvaient que le perfectionner : une question mal cadrée le
  restait. Le cadrage est confié à un autre modèle que le rédacteur, qui reçoit ainsi un périmètre
  qu'il n'a pas choisi. L'échec de l'étape n'interrompt jamais l'analyse.

- **Inventaire des affirmations** (`lib/claims.js`, table `run_claims`, **aucun appel
  supplémentaire**). L'auditeur restitue désormais la liste des affirmations du document — type,
  statut (`VERIFIE`, `NON_VERIFIE`, `CONTREDIT`), sources qui la portent, et si la conclusion en
  dépend. C'est le travail qu'il faisait déjà pour les auditer, rendu explicite : il ne renvoyait
  que les problèmes, jamais l'inventaire.

  Trois conséquences. Une **porte de validation** supplémentaire : aucune affirmation déterminante
  ne peut rester non vérifiée. Une **traçabilité** au niveau de l'affirmation, requêtable, là où
  elle s'arrêtait au document et à la source. Et la **détection des régressions** : la correction
  réécrit le document intégralement, rien ne garantissait qu'un fait établi au cycle 1 survive au
  cycle 2 — les versions étaient conservées, jamais comparées. Le rapprochement se faisant sur
  l'énoncé, ce dernier signal est informatif et non bloquant : une reformulation ne doit pas
  suffire à enfermer la boucle.

  Un statut absent ou inintelligible vaut `NON_VERIFIE`, jamais `VERIFIE` : un modèle qui omet le
  champ ne doit pas obtenir gratuitement le bénéfice du doute.

- **Réfutation adversariale** (`lib/falsify.js`, +0 à 1 appel **avec** recherche web). Une étape dont
  la mission n'est pas d'auditer le document mais de le démentir : sources contradictoires, données
  plus récentes, exceptions, hypothèses implicites.

  Elle comble la limite la plus nette de l'application : l'auditeur travaillant hors ligne, celle-ci
  pouvait établir qu'une affirmation n'était **pas étayée**, jamais qu'une source la
  **contredisait**. Elle constatait des absences, pas des réfutations.

  Toute objection sans URL est écartée par le code, et les sources produites passent le même
  contrôle d'accessibilité que les autres. Une contradiction grave, sourcée et dont la page répond
  dégrade le statut final **même sur un `APPROUVE`** : la décision de l'arbitre reste affichée telle
  qu'il l'a rendue, la mesure ne disparaît pas pour autant.

  Déclenchement déterministe : anomalie sévère subsistante, affirmation déterminante non établie,
  boucle arrêtée sans converger, ou score au seuil sans aucune source primaire joignable — un
  document convaincant que rien n'atteste.

- **Second avis indépendant** (`lib/diverge.js`, +2 appels, conditionnel). Un second rédacteur, servi
  par un autre modèle, traite la même demande **sans voir** la première analyse. Un troisième modèle
  compare les deux : il ne désigne pas de gagnant, il identifie la *cause* de chaque divergence
  (hypothèse, source, périmètre, horizon, calcul, critère) et la question qui permettrait de la
  trancher. Ces questions rejoignent la correction du cycle 1 et l'arbitrage — le désaccord devient
  un moteur de recherche, pas un vote.

  Les accords non étayés sont comptés séparément : deux modèles d'accord sans source, c'est le
  consensus le plus dangereux, parce qu'il inspire confiance. Automatique sur les domaines juridique
  et financier, activable ou désactivable explicitement ailleurs.

- Deux onglets dans les résultats : **Affirmations** (inventaire du dernier cycle, déterminantes non
  établies en tête, régressions) et **Contradiction** (cadrage, second avis et désaccords,
  réfutation). Mêmes rendus dans le détail d'une analyse historisée.

- Colonnes résumées `runs.claims_total` et `runs.claims_critical_unverified` : de quoi retrouver les
  analyses parties à l'arbitrage avec un trou dans leur démonstration.

### Modifié

- Le modèle du second avis est toujours résolu vers un modèle différent du rédacteur **et** de
  l'arbitre, y compris en sélection manuelle.
- Barre de progression réétalonnée pour les étapes ajoutées ; les étapes facultatives non
  déclenchées font simplement sauter la barre, sans jamais la faire reculer.

### Vérifié

- Suite `npm test` portée à 149 tests (117 auparavant), dont deux nouveaux fichiers couvrant les
  quatre étapes : bornage des sorties, refus des objections sans URL, déclencheurs de la réfutation,
  rapprochement des affirmations entre cycles, et refus d'un second avis rendu par le rédacteur.
- Simulation de bout en bout du pipeline complet sur le serveur réel, OpenRouter et Firecrawl
  bouchonnés : 17 vérifications, dont l'ordre des étapes, le blocage d'un audit `VALIDER` à 95/100
  par une affirmation déterminante non établie, le contrôle Firecrawl de la source contradictoire,
  la dégradation d'un `APPROUVE` en approbation avec réserves, et l'enveloppe de 9 appels de modèle
  sur une analyse à second avis et réfutation.
- Rendu navigateur des deux nouveaux onglets en clair/sombre et desktop/mobile : aucune erreur
  console, aucun débordement horizontal.

## [1.6.0] - 2026-08-08

Quatre évolutions de la méthodologie de validation, issues de l'analyse comparée entre la
méthodologie cible et la boucle réellement implémentée ([`docs/ANALYSE_METHODOLOGIE.md`](docs/ANALYSE_METHODOLOGIE.md)).
Aucune n'ajoute d'appel de modèle : le coût par analyse est inchangé, et l'arrêt sur stagnation le
réduit sur les analyses qui plafonnent.

### Ajouté

- **La vérité terrain Firecrawl entre dans la condition d'arrêt.** La porte de validation ne lisait
  que `sources_non_verifiees`, une liste **écrite par l'auditeur**, alors que l'application dispose
  d'une mesure réelle : le résultat d'extraction de chaque URL. Un auditeur omettant le champ — ou
  concluant `VALIDER` avec 95/100 — laissait donc valider un document truffé de liens morts.
  Désormais, une URL **encore citée par le document** et mesurée injoignable bloque la validation,
  quel que soit le verdict du modèle.

  Le filtre sur les liens encore cités conditionne la convergence : le cache des sources n'oublie
  jamais une URL contrôlée, si bien qu'un lien mort supprimé par une correction bloquerait sinon la
  boucle indéfiniment. Retirer ou remplacer le lien lève le blocage — c'est exactement la correction
  attendue. Une source non contrôlée (`accessible: null`) ne bloque pas : on ne peut pas reprocher
  au document une vérification qui n'a pas eu lieu.

- **Arrêt sur stagnation.** Deux audits consécutifs sans progrès ni sur le score, ni sur le nombre
  d'anomalies sévères, interrompent les cycles restants : le document part à l'arbitrage en l'état,
  avec une raison d'arrêt explicite. Auparavant une boucle qui plafonnait consommait `maxCycles`
  intégralement — jusqu'à deux rédactions et deux audits payés pour un score identique. Progresser
  sur une seule des deux dimensions suffit à justifier un cycle de plus.

- **Deux confiances distinctes dans l'arbitrage** (`confiance_preuves`, `confiance_conclusion`), en
  plus de la confiance globale et sans appel supplémentaire. Une base factuelle solide peut porter
  une recommandation fragile : la confiance unique rendait ce cas inexprimable. La confiance globale
  est normalisée côté serveur — bornée à `[0,100]`, déduite des deux dimensions si le modèle l'omet,
  et plafonnée par la plus faible d'entre elles. Lorsqu'un plafonnement s'applique, la valeur
  annoncée reste visible dans `confiance_annoncee` : un ajustement silencieux serait un mensonge de
  plus, pas une correction.

  Nouvelles colonnes résumées `runs.arbiter_evidence_confidence` et `runs.arbiter_conclusion_confidence`
  (ajoutées par `ALTER TABLE … IF NOT EXISTS`, sans migration ni rupture sur les analyses existantes).

- **La raison d'arrêt est affichée.** Elle était calculée, enregistrée et historisée depuis la 1.4.0,
  mais n'apparaissait nulle part : rien ne distinguait à l'écran une boucle arrêtée parce que
  l'audit validait, une boucle interrompue faute de cycles, et une boucle abandonnée pour stagnation.

- **L'arbitrage est rendu lisible.** Le panneau affichait un vidage JSON brut. Il présente désormais
  le verdict, les trois confiances avec leur jauge, les motifs, réserves et actions requises — le
  JSON complet restant accessible dans un bloc dépliable. Même rendu dans le détail d'une analyse
  historisée.

### Modifié

- **Budget de vérification des sources : quota par cycle plutôt que plafond global saturable.**
  Jusqu'à 10 URL *nouvelles* par cycle, dans la limite de 20 par analyse (auparavant 10 pour
  l'analyse entière). Le rédacteur initial citant l'essentiel des liens, le plafond global était
  atteint dès le premier cycle : les sources ajoutées par une correction n'étaient plus jamais
  vérifiées — et, `result.sources` valant le contenu du cache, elles ne figuraient même pas dans le
  rapport, l'historique ni le dossier soumis à l'auditeur. Elles y apparaissent désormais comme non
  contrôlées, avec leur motif, et restent candidates au cycle suivant.

- Le fil de suivi et la barre de progression citent le modèle arbitre réellement utilisé, au lieu de
  « Grok » en dur — trompeur dès que l'arbitre est choisi manuellement.

### Vérifié

- Suite `npm test` portée à 117 tests (103 auparavant), dont la porte d'arrêt face à la mesure de
  source, la convergence après retrait d'un lien mort, la détection de stagnation sur ses deux
  dimensions et la normalisation des confiances.
- Simulation de bout en bout sur le serveur réel, OpenRouter et Firecrawl bouchonnés : un audit
  `VALIDER` à 95/100 ne suffit pas à valider tant qu'une source citée est morte ; l'URL ajoutée par
  la correction du cycle 1 est bien contrôlée au cycle 2 ; la boucle s'arrête au cycle 2 sur
  stagnation au lieu d'en consommer 3 ; la confiance globale annoncée à 95 est ramenée à 40 par la
  confiance dans les preuves, valeur annoncée conservée.

## [1.5.2] - 2026-08-08

### Corrigé

- **L'interface restait bloquée indéfiniment sur « Reconnexion au traitement… 1 % ».** L'identifiant
  de la dernière analyse est conservé dans le stockage local du navigateur, et au chargement de la
  page l'interface tente de reprendre son suivi. Or les tâches vivent dans la mémoire du processus :
  tout redémarrage du serveur les efface — un déploiement, mais surtout la mise en veille du plan
  d'hébergement, qui survient plusieurs fois par jour. `/api/jobs/:id/events` répond alors `404`,
  cas dans lequel un `EventSource` échoue **sans données et sans nouvelle tentative**. Le
  gestionnaire d'erreur se contentait de fermer le flux : la barre restait figée à 1 %, sans
  message, sans résultat, et sans autre issue que de vider le stockage local du navigateur.

  Trois corrections :
  - une erreur native de l'`EventSource` n'est traitée comme définitive que si `readyState` vaut
    `CLOSED`. Tant qu'il vaut `CONNECTING`, le navigateur retente de lui-même (veille mobile,
    changement de réseau) et le flux n'est plus fermé — l'ancien `close()` inconditionnel
    supprimait cette reconnexion automatique ;
  - lorsque le suivi est définitivement perdu, l'analyse est d'abord recherchée via
    `GET /api/runs/:id` : si elle s'est terminée avant le redémarrage, son résultat complet
    s'affiche au lieu d'être perdu ;
  - si elle reste introuvable, l'identifiant périmé est oublié, le panneau de suivi masqué et la
    situation expliquée à l'utilisateur.

  Vérifié dans un navigateur réel, avant et après. Avant : `progressText="Reconnexion au
  traitement…"`, `percent="1 %"`, aucun message, identifiant toujours présent en stockage local.
  Après, analyse introuvable : panneau masqué, identifiant oublié, message affiché. Après, analyse
  terminée avant le redémarrage : résultat retrouvé et affiché à 100 %.

## [1.5.1] - 2026-08-08

### Documentation

- Mise à jour du README après la 1.5.0, dont plusieurs sections décrivaient encore l'application
  d'avant l'historisation : le déroulé de la boucle s'arrêtait à « enregistre le résultat en base »
  sans mentionner ni les lignes normalisées, ni le caractère non fatal d'un échec d'écriture, ni le
  journal de fin ; la section « Historique et exports » énumérait ce qu'une exécution « peut
  conserver » sans dire que les échecs le sont aussi, ni que les données sont désormais
  consultables ; l'inventaire de l'interface ignorait l'historique cliquable et le panneau de
  données historisées.
- `GET /api/dashboard` est signalé comme conservé pour compatibilité mais supplanté par
  `GET /api/analytics`, seul utilisé par l'interface — l'ancienne entrée laissait croire à deux
  fonctionnalités distinctes.
- Nouvelle section **Journaux** : tableau des préfixes émis (`[job] création`, `[openrouter]`,
  `[firecrawl]`, `[json]`, `[db]`, `[job] fin`, `[job] échec`) et de ce qu'ils signalent. Les
  journaux sont le principal outil de diagnostic en production et n'étaient documentés nulle part.

## [1.5.0] - 2026-08-08

### Ajouté

- **Journal de fin d'analyse.** Rien n'était journalisé à l'issue d'une exécution : la seule façon
  de savoir qu'une analyse s'était bien terminée était de constater l'absence d'erreur, ce qui ne
  distingue pas un succès d'un processus interrompu. Chaque exécution émet désormais une ligne
  `[job] fin <id> statut=… tâche=… cycles=… score=… arbitrage=… sources=4/4 appels=5 tokens=…
  coût=$… document=…c durée=…s historisé=oui`, et chaque échec une ligne `[job] échec <id> durée=…
  raison=…`.

- **Historisation complète de toutes les analyses.** Le détail vivait déjà dans la colonne `result`
  (jsonb), mais sous une forme opaque : impossible d'interroger les sources, les scores ou la
  consommation sans désérialiser chaque exécution. Trois tables normalisées s'y ajoutent —
  `run_sources` (URL, domaine, accessibilité, catégorie, code HTTP, volume extrait, motif d'échec),
  `run_audits` (cycle, score global, scores détaillés, verdict, nombre d'anomalies dont sévères) et
  `run_calls` (rôle, modèle, tokens, coût, `finish_reason`, modèle d'origine en cas de bascule) —
  ainsi que des colonnes résumées sur `runs` (`cycles`, `final_score`, `arbiter_decision`,
  `arbiter_confidence`, `sources_total`, `sources_accessible`, `document_chars`, `duration_ms`,
  `firecrawl_enabled`, `error`). L'écriture se fait en une transaction : une exécution
  partiellement historisée fausserait silencieusement les statistiques.

- **Les analyses en échec sont enregistrées elles aussi.** Seules les analyses abouties étaient
  conservées : un échec ne laissait aucune trace exploitable, ni le document déjà rédigé, ni les
  cycles déjà payés. La dernière version rédigée est désormais promue en document final, et
  l'exécution est enregistrée avec `status='error'` et le motif.

- **`GET /api/runs/:id`** — consultation d'une exécution passée. Seul l'export existait :
  l'historique ne permettait pas de relire un document, ses audits ou ses sources depuis
  l'interface.

- **`GET /api/analytics`** — agrégats sur l'ensemble des exécutions : totaux (validées, rejetées,
  en échec, score moyen, cycles moyens, durée moyenne, coût), répartition par type de tâche, par
  modèle et par rôle, ventilation des sources par état et par catégorie, domaines les plus cités
  avec leur taux d'accessibilité réel, progression des scores par cycle et critères d'audit les
  plus faibles.

- **Interface de consultation.** Les lignes de l'historique deviennent cliquables et ouvrent le
  détail complet de l'analyse (document, arbitrage, scores par cycle, sources contrôlées,
  consommation, liens d'export) ; le tableau de bord est remplacé par un panneau « Données
  historisées » à quatre onglets (vue d'ensemble, sources, audits, consommation).

### Modifié

- L'agrégation est écrite **une seule fois**, sur la forme canonique des lignes historisées
  (`lib/analytics.js`). Le chemin PostgreSQL lit ces lignes telles quelles ; `normalizeRun()` y
  ramène un job encore en mémoire lorsque aucune base n'est configurée. Vérifié : à données
  identiques, les deux chemins renvoient exactement la même réponse. Aucune colonne volumineuse
  n'est rapatriée pour les statistiques — ni le document, ni le contenu des réponses de modèle.

### Corrigé

- `sourceRows()`, `auditRows()` et `callRows()` levaient une exception sur une collection `null`
  (un paramètre par défaut ne couvre que `undefined`). Défaut trouvé par les tests ajoutés ici.

## [1.4.2] - 2026-08-08

### Modifié

- **Intégration de la 1.1.8 dans la lignée 1.2.0 → 1.4.1.** Ces deux séries ont été développées en
  parallèle à partir de la 1.1.7 : la 1.1.8 corrigeait l'échec systématique de Firecrawl (HTTP 403,
  `zeroDataRetention` envoyé sans que l'option soit activée sur le compte), tandis que la lignée
  1.2.x–1.4.x traitait la sélection des modèles, la persistance, le coût, la condition d'arrêt et
  la suite de tests. **Les versions 1.2.0 à 1.4.1 ne contenaient donc pas le correctif Firecrawl**
  — il n'est effectif qu'à partir de cette version.

  Les deux historiques sont conservés à leur place respective dans ce fichier, chacun selon son
  numéro. La fusion n'a demandé aucun arbitrage de code : les modifications portaient sur des
  parties disjointes de `server.js` (constantes et corps de requête Firecrawl d'un côté, boucle
  d'analyse et persistance de l'autre). Seuls le numéro de version, l'en-tête du README et l'ordre
  des entrées de ce changelog ont dû être tranchés.

  Le README ne réaffiche plus de numéro de version en dur : la 1.1.8 l'avait remis à jour à la
  main, dans la phrase même expliquant que `package.json` est l'unique source de vérité.

## [1.4.1] - 2026-08-08

### Corrigé

- **L'image Docker ne démarrait plus depuis la 1.3.0.** Le `Dockerfile` ne copiait que `server.js`
  et `public/` ; l'extraction de la logique dans `lib/` a donc produit un conteneur qui s'arrêtait
  immédiatement sur `Cannot find module /app/lib/task.js`. Le défaut est passé inaperçu pendant
  quatre versions parce que Render déploie depuis le dépôt via `render.yaml` et non depuis le
  `Dockerfile` : seule l'image était touchée. `COPY lib ./lib` est ajouté.
- Un test de packaging (`test/packaging.test.js`) vérifie désormais que tout ce que `server.js`
  importe est effectivement copié dans l'image, et que le point d'entrée du conteneur correspond à
  celui déclaré par `package.json`.

### Documentation

- Le README annonçait « Version actuelle : 1.1.7 » en dur, dans la phrase même qui explique que
  `package.json` est l'unique source de vérité. Le numéro figé est retiré au profit d'un renvoi au
  changelog.
- La description de la sélection des modèles mentionnait encore une validation « par une expression
  régulière stricte », remplacée par une liste blanche en 1.2.0.
- L'arborescence décrit `lib/` et `test/`, absents depuis leur création.

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
## [1.1.8] - 2026-08-08

### Corrigé

- **Toutes les vérifications Firecrawl échouaient avec HTTP 403** : `scrapeFirecrawl()` envoyait
  systématiquement `zeroDataRetention: true`, une fonctionnalité à activer explicitement sur le
  compte Firecrawl (message renvoyé : *"Zero Data Retention (ZDR) is not enabled for your team"*).
  Chaque source ressortait donc « inaccessible » alors que la clé API était valide et le reste du
  pipeline fonctionnel — confirmé une fois le vrai correctif de la case Firecrawl (1.1.7) en place
  et le premier appel réel observé. Option désormais contrôlée par la variable d'environnement
  `FIRECRAWL_ZERO_DATA_RETENTION` (`false` par défaut), à activer uniquement si le compte Firecrawl
  dispose réellement de cette fonctionnalité.

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
