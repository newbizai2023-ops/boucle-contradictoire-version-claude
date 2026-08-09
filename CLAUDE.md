# Notes pour Claude Code

Application Node.js sans framework ni étape de build : `server.js` (câblage HTTP, boucle
d'analyse), `lib/` (logique pure), `public/` (interface vanilla).

- [`README.md`](README.md) — architecture, routes, prompts, journaux, déploiement.
- [`CHANGELOG.md`](CHANGELOG.md) — **à lire avant de retoucher une zone déjà corrigée** : chaque
  entrée explique le symptôme observé et pourquoi la correction a la forme qu'elle a. Beaucoup de
  choix qui semblent arbitraires y sont justifiés.
- [`ONBOARDING.md`](ONBOARDING.md) — accueil d'un humain sur le dépôt (dépôts, serveurs MCP).
- [`docs/ANALYSE_METHODOLOGIE.md`](docs/ANALYSE_METHODOLOGIE.md) — méthodologie cible et écarts
  d'implémentation.

## Commandes

```bash
npm run check   # syntaxe (server.js, public/app.js) puis toute la suite — à passer avant tout commit
npm test        # les tests seuls
npm run dev     # serveur en rechargement automatique
```

Node 20 à 22 (`engines: >=20 <23`). **Aucune dépendance de développement** : les tests utilisent le
lanceur intégré `node:test`. Ne pas en ajouter sans nécessité démontrée — c'est un choix du projet.

Localement, sans compte Google : `DEV_BYPASS_AUTH=true PORT=3000 node server.js`.

## Où va le code

`server.js` appelle `app.listen()` au chargement du module : il **n'est pas importable** par un
test. Toute logique qu'on veut couvrir doit donc vivre dans `lib/`, en fonctions pures, et être
importée par `server.js`. C'est la raison d'être du découpage, pas une préférence esthétique.

`lib/` réunit la classification du domaine et le cadrage, la résolution des modèles, le verdict
d'audit et la condition d'arrêt, les affirmations, la validation des preuves, la réfutation, les
divergences, les sources, la progression, la persistance, les agrégats et les rapports. Un module
par responsabilité ; chacun est couvert soit par son propre fichier de test, soit par
`test/pipeline.test.js` pour les étapes de la boucle (cadrage, réfutation, divergences).

## Conventions

- **Tout en français** : code, commentaires, messages d'erreur, journaux, interface.
- **Les commentaires expliquent le *pourquoi*, pas le *quoi*.** Quand un correctif est subtil, dire
  le symptôme observé et ce qui échouait — c'est ce qui rend ce dépôt relisable.
- **Chaque pull request incrémente la version** et publie son entrée au changelog, sans passer par
  « Non publié ». La règle existe parce que deux états différents du service portant le même numéro
  rendent toute observation faite sur l'instance déployée irrattachable à un état du code. Elle vaut aussi pour un
  changement purement documentaire.
- Le numéro affiché par l'application est lu depuis `package.json`, jamais dupliqué ailleurs.
- Relire le **README** à chaque changement de comportement — sa prose, pas seulement ses listes.
  Les tableaux et inventaires sautent aux yeux quand ils sont incomplets ; les phrases qui décrivent
  un comportement restent syntaxiquement valides tout en devenant fausses.

## Vérifier, pas supposer

Ce dépôt a une histoire de bugs qui ne produisaient aucune erreur : un sélecteur DOM inexistant, une
sélection de modèles silencieusement ignorée, une image Docker qui ne démarrait plus, une interface
figée sur une reconnexion impossible. Les tests unitaires seuls ne les auraient pas attrapés.

- **Validation par mutation** : réintroduire le bug, vérifier que le test attendu échoue, restaurer.
  Un test qui n'a jamais échoué ne prouve rien.
- **Tests de cohérence** (`test/interface.test.js`, `test/packaging.test.js`) : ils comparent le
  vocabulaire de l'interface à celui du serveur, et les imports au contenu de l'image Docker. C'est
  la classe de bugs la plus coûteuse ici.
- **Base réelle** pour toute modification SQL : `initdb` puis `pg_ctl` en local, jamais un
  raisonnement sur le schéma. Postgres refuse de tourner en root — créer un utilisateur dédié.
- **Navigateur réel** pour toute modification de `public/app.js` touchant à l'état ou au SSE.
  Chromium est présent : passer `executablePath: "/opt/pw-browsers/chromium-<version>/chrome-linux/chrome"`
  à Playwright plutôt que de télécharger un binaire.
- **APIs simulées** pour la boucle : un petit serveur HTTP local remplaçant OpenRouter et Firecrawl
  permet de rejouer un run complet, échecs compris, sans dépenser un centime.

Après un `git checkout` de restauration, revérifier que le correctif en cours n'a pas été emporté :
les fichiers non encore indexés ne sont pas restaurés, ceux déjà indexés et non commités le sont.

## Déploiement (Render)

Service `srv-d9rfl55bedkc73blgrrg` — **instance de développement, et le seul déploiement à ce jour** :
il n'existe pas d'environnement de production. Déployé depuis `main` via `render.yaml` — **pas** via le
`Dockerfile`, qui ne sert qu'à une image locale. `autoDeploy` est activé mais ne se déclenche pas en
pratique : déclencher le déploiement explicitement après un push, puis vérifier la version dans les
journaux (`Boucle Contradictoire vX.Y.Z disponible`).

- **Ne jamais modifier une variable d'environnement sans demande explicite de l'utilisateur.**
- Pour refermer l'accès : supprimer `DEV_BYPASS_AUTH` **puis** poser `NODE_ENV=production`. Dans
  l'ordre inverse, le serveur refuse de démarrer (garde-fou volontaire).
- Le plan gratuit met le service en veille après inactivité : la mémoire des tâches est vidée
  plusieurs fois par jour. Tout ce qui doit survivre passe par PostgreSQL.
- L'accès sortant de l'environnement d'exécution peut bloquer le domaine de l'application ;
  l'observation passe alors par les journaux Render, pas par des requêtes HTTP directes.

## Pièges du dépôt

- `server.js` contient un **octet NUL littéral** (`text.replace(/\0/g, "")`) qui le fait passer pour
  binaire aux yeux de `grep`. Utiliser `grep -a`.
- Les requêtes SQL vivent dans des littéraux de gabarit : **aucun accent grave** dans les
  commentaires SQL, il refermerait le littéral.
- Un paramètre par défaut (`= []`) ne couvre pas `null`, seulement `undefined`. Préférer `?? []`
  pour des données venant d'un modèle ou de la base.
- Les modèles écrivent en français libre : comparer les valeurs qu'ils produisent (`gravite`,
  `decision`, statuts) **sans accents et sans casse**, jamais par égalité stricte.
- Les motifs de classification doivent être **ancrés sur des limites de mots** : cherchés en
  sous-chaîne, « trois » contient « roi » et « rapide » contient « api ».

## Limite connue, figée par un test

`sourceClass` n'ancre pas ses motifs média et documentation sur le domaine enregistrable :
`bbc.exemple-malveillant.com` passe pour un média reconnu. Le test le constate sans l'approuver,
pour qu'une correction future soit un changement délibéré et visible.
