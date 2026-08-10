# Boucle Contradictoire

Application web Node.js qui orchestre une analyse multi-modèles fondée sur les preuves : cadrage préalable, rédaction avec recherche Web, second avis indépendant, audit contradictoire avec inventaire des affirmations, réfutation adversariale et arbitrage. Les sources citées sont réellement ouvertes, les citations vérifiées dans la page, et chaque affirmation reliée à ce qui l'établit. Historisation PostgreSQL requêtable, exports et consultation des données de toutes les analyses.

**Version courante** : voir [`CHANGELOG.md`](CHANGELOG.md) pour l'historique des versions et la politique de versionnage ([SemVer](https://semver.org/lang/fr/)). Le numéro affiché par l'application (`GET /api/health`, pied de page) est lu directement depuis `package.json` : c'est l'unique source de vérité, il n'existe pas de second numéro à synchroniser manuellement.

L'en-tête affiche à côté du numéro la **date de production de cette version** (`lib/release.js`). Le projet n'ayant pas d'étape de construction où graver cette date, elle est résolue au démarrage par une cascade de trois sources, de la plus fidèle à la plus approximative : la date du commit, la date de récupération de `package.json` par l'hébergeur, puis le démarrage du processus. La source retenue est renvoyée avec la date et affichée en infobulle, parce que la dernière *ment* sur une instance qui s'endort — le plan gratuit redémarre plusieurs fois par jour sans qu'aucune version nouvelle soit produite, et une date d'affichage muette laisserait croire le contraire.

**Chaque pull request incrémente la version** et publie son entrée dans le journal. Sans cette règle, deux états différents du service portent le même numéro, et une observation faite sur l'instance déployée ne peut plus être rattachée à un état du code.

> 📄 [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md) contient un prompt maître autonome permettant de recréer cette application (spécification complète, prompts système, contrats JSON, méthodologie de construction en boucles).

## Méthodologie

### Principe

Un document produit par un modèle de langage est fluide par construction et fiable par accident. La
méthode appliquée ici consiste donc à ne jamais faire reposer la validation sur la qualité apparente
du texte, mais sur trois choses vérifiables : **l'état réel des sources citées, la reproductibilité
des calculs, et le désaccord organisé entre des modèles qui n'ont pas le même auteur.**

> **Le modèle aide à trouver, structurer et interpréter les preuves. Il ne constitue jamais lui-même
> la preuve.**

### Trois rôles, trois fournisseurs

La contradiction est répartie entre trois rôles servis par défaut par trois éditeurs différents —
rédacteur Anthropic, auditeur OpenAI, arbitre xAI. L'hétérogénéité est délibérée : deux modèles
issus de la même famille partagent leurs angles morts, et leur accord ne prouve alors rien d'autre
que leur parenté.

| Rôle | Recherche web | Mission |
|---|---|---|
| **Rédacteur** | oui | Produit le document, puis le corrige intégralement à chaque cycle |
| **Second avis** | oui | Traite la même demande **sans voir** la première analyse. Conditionnel |
| **Auditeur** | non | Attaque le document sur pièces : demande, texte, dossier de sources contrôlées. Inventorie aussi les affirmations |
| **Réfutation** | oui | Cherche à démentir le document plutôt qu'à l'auditer. Conditionnel. Distinct de l'arbitre : chercher les contradictions et les juger sont deux rôles |
| **Arbitre** | non | Tranche sur la version finale. **Ne réécrit jamais.** |

L'auditeur travaille sans recherche web pour deux raisons : le coût, et l'ancrage — un auditeur qui
recherche lui-même finit par auditer sa propre recherche plutôt que le document. La conséquence est
qu'il peut établir qu'une affirmation n'est **pas étayée**, jamais qu'une source la **contredit** :
c'est précisément le trou que comble l'étape de réfutation, qui dispose de la recherche.

### Ce qui est déterministe, ce qui ne l'est pas

C'est la distinction structurante de l'application, et la seule protection réelle contre un modèle
complaisant. Un score est une opinion ; un code HTTP est un fait.

| Mesuré par du code (opposable) | Produit par un modèle (indicatif) |
|---|---|
| Accessibilité réelle de chaque URL citée (Firecrawl) | Score global et scores par critère sur 100 |
| Présence effective d'une citation dans la page extraite | Relation sémantique entre une source et une affirmation |
| Rétrogradation d'une affirmation sans source contrôlable | Statut initial d'une affirmation (`VERIFIE`, `CONTREDIT`) |
| Classification d'une source par son domaine (`sourceClass`) | Gravité des anomalies, verdict `VALIDER`/`CORRIGER` |
| Comparaison des cycles entre eux (progrès, stagnation) | Liste `sources_non_verifiees` |
| Plafonnement de la confiance globale par ses dimensions | Confiances de l'arbitre, décision finale |
| Quotas de vérification, budget, coût, tokens | Résumés et motifs rédigés |

La condition d'arrêt (`lib/audit.js`) est du code, pas un prompt : elle est testée, elle renvoie ses
motifs, et elle **oppose la mesure au verdict**. Un auditeur peut conclure `VALIDER` avec 95/100 —
si une URL encore citée par le document a été mesurée injoignable, la boucle repart quand même.

### Les sept étapes

```text
CADRAGE → RÉDACTION → SECOND AVIS → PREUVES → AUDIT → RÉFUTATION → ARBITRAGE
            ↑                                    │
            └────────── correction ──────────────┘
```

**Cadrage** — un appel court, avant toute rédaction, qui produit des *questions* et non des
réponses : dimensions à couvrir, angles morts, périmètre que la demande ne tranche pas. Sans lui, le
périmètre de l'analyse est celui que le premier brouillon retient en silence, et les cycles suivants
ne peuvent que le perfectionner. Le cadrage est confié à un autre modèle que le rédacteur, qui
reçoit ainsi un périmètre qu'il n'a pas choisi.

**Second avis** — un second rédacteur, servi par un autre éditeur, traite la même demande sans voir
la première analyse. Leurs positions sont ensuite comparées par un troisième modèle qui ne désigne
pas de gagnant : il identifie la **cause** de chaque divergence (hypothèse, source, périmètre,
horizon, calcul, critère) et la question qui permettrait de la trancher. Ces questions rejoignent la
correction et l'arbitrage — le désaccord devient un moteur de recherche, pas un vote. Automatique
sur les domaines juridique et financier, activable ailleurs.

**Audit et inventaire** — l'auditeur restitue désormais la liste des affirmations du document :
type, statut (`VERIFIE`, `NON_VERIFIE`, `CONTREDIT`), sources qui la portent, et si la conclusion en
dépend. Cet inventaire ne coûte aucun appel supplémentaire — c'est le travail que l'auditeur faisait
déjà, rendu explicite — et devient une table requêtable, une condition d'arrêt, et le moyen de
détecter ce qu'une réécriture a fait perdre.

**Réfutation** — une recherche adversariale dont la mission n'est pas d'auditer le document mais de
le démentir. Toute objection sans URL est écartée par le code, et les sources qu'elle produit
passent le même contrôle d'accessibilité que les autres.

### Preuve opposable : la citation doit exister

Une source qui répond n'établit rien. Une page peut parler d'un autre produit, d'une autre version,
d'une autre région, ou ne mentionner le sujet que de loin. Se contenter de l'accessibilité revenait
donc à passer de « le modèle affirme que cette source contredit le document » à « la contradiction
est confirmée » parce que l'URL existait.

Le contrôle qui tranche est déterministe et ne coûte aucun appel : **le modèle cite un extrait, et
cet extrait doit se retrouver dans la page réellement extraite par Firecrawl.** Une citation
littérale suffit ; à défaut, un recouvrement lexical d'au moins 60 % sur les mots significatifs
accepte une reformulation fidèle sans laisser passer une citation fabriquée. Une objection qui ne
tient pas ce contrôle est écartée et n'affecte plus le verdict.

Le même principe s'applique aux affirmations. Le statut `VERIFIE` est décidé par l'auditeur ; trois
règles le lui retirent sans jugement lorsqu'il ne s'appuie sur rien de contrôlable : aucune source
rattachée, aucune source connue du dossier, aucune source joignable. Le code peut retirer un statut
que rien n'étaye — il ne s'autorise jamais à en accorder un.

### Cycles : quand la boucle repart, quand elle s'arrête

Un cycle enchaîne vérification des sources → audit → correction intégrale. Il en faut au moins un et
au plus cinq (trois par défaut). La boucle s'arrête dans trois cas seulement :

1. **Validation** — tous les critères de la section « Règles de validation » sont satisfaits.
2. **Stagnation** — deux audits consécutifs sans progrès sur aucune des trois dimensions suivies :
   score, anomalies sévères, affirmations déterminantes non établies. Un cycle qui résout trois
   affirmations sans faire bouger le score d'un point fait le travail utile ; l'arrêter là
   gaspillerait précisément ce qu'on cherchait à obtenir. Un cycle de plus ne ferait que payer une rédaction et un audit pour le même
   résultat ; le document part à l'arbitrage en l'état, avec la raison d'arrêt affichée.
3. **Épuisement** — le nombre maximal de cycles est atteint, motifs de blocage à l'appui.

Dans les trois cas, l'arbitrage a lieu : une analyse qui s'arrête sans avoir convergé produit quand
même un verdict, des réserves et des actions requises.

### Deux confiances, pas une

L'arbitre rend deux nombres indépendants, parce qu'ils répondent à deux questions différentes :

- **Confiance dans les preuves** — solidité, indépendance, accessibilité et fraîcheur des sources.
- **Confiance dans la conclusion** — degré auquel la recommandation découle de ces preuves, compte
  tenu des hypothèses métier et du périmètre retenu.

Une base factuelle solide peut porter une recommandation fragile : c'est le cas courant en conseil,
et une confiance unique le rendait inexprimable. La confiance globale est ensuite **plafonnée en
code** par la plus faible des deux — on ne peut pas être plus sûr de sa conclusion que de ce qui la
soutient — et la valeur initialement annoncée reste affichée lorsqu'un plafonnement s'applique.

### Coût : les étapes chères sont conditionnelles

Le principe directeur est le **minimum d'agents nécessaire pour atteindre un niveau de preuve
suffisant**, pas le maximum d'agents possible. Le nombre d'appels n'est pas un indicateur de
qualité.

| Situation | Appels de modèle |
|---|---|
| Demande simple, validée au premier cycle | 4 (cadrage, rédaction, audit, arbitrage) |
| Analyse standard, deux cycles | 6 |
| Domaine à enjeu avec second avis et réfutation | 9 à 11 |

La réfutation n'est payée que si la validation repose sur quelque chose d'invérifié : anomalie
sévère subsistante, affirmation déterminante non établie, boucle qui a renoncé, ou — le cas le plus
traître — un excellent score adossé à aucune source primaire joignable, c'est-à-dire un document
convaincant que rien n'atteste. Le second avis n'est automatique que là où une erreur se paie cher.

### Ce que la méthode ne fait pas

Ces limites sont assumées et documentées, pas ignorées :

- **La citation est vérifiée, l'implication ne l'est pas.** Le code établit qu'un extrait figure
  bien dans la page ; que cette page *implique* l'affirmation reste l'appréciation d'un modèle. Ce
  qui a changé : cette appréciation doit désormais s'appuyer sur une citation dont l'existence est
  prouvée.
- **L'inventaire des affirmations est produit par un modèle.** Une affirmation qu'il n'extrait pas
  n'est jamais vérifiée et n'apparaît dans aucune porte de contrôle : c'est un mode de défaillance
  silencieux, que la table rend visible pour ce qu'elle contient, pas pour ce qu'elle omet.
- **La détection de régression est approximative.** Les identifiants ne survivent pas d'un cycle à
  l'autre, le rapprochement se fait sur l'énoncé : une reformulation compte comme une disparition.
  Le signal est donc informatif, jamais bloquant.
- **L'indépendance des rôles est celle du modèle, pas toujours celle de l'éditeur.** Faute d'un
  quatrième fournisseur dans la liste blanche, certains rôles partagent leur éditeur.
- **Aucun désaccord n'est refermé automatiquement.** Les questions issues du second avis alimentent
  la correction et l'arbitrage, mais rien ne garantit qu'une recherche y réponde : une étape de
  recherche ciblée reste à construire.
- **Un score reste un nombre inventé par un modèle.** Ce qui a changé, c'est que la porte de
  validation ne s'en remet plus uniquement à lui.

> 📄 [`docs/ANALYSE_METHODOLOGIE.md`](docs/ANALYSE_METHODOLOGIE.md) confronte cette méthodologie à sa
> cible (`EXPLORE → EVIDENCE → DIVERSIFY → DISAGREE → FALSIFY → DECIDE → EXPLAIN`), détaille forces
> et faiblesses de chaque côté et classe les évolutions restantes par rapport bénéfice/coût.

## Architecture

### Stack technique

- **Runtime** : Node.js 20+, module ES natif (`"type": "module"`), aucun bundler ni framework frontend.
- **Serveur HTTP** : Express 5.
- **Authentification** : Passport.js avec stratégie Google OAuth 2.0 (`passport-google-oauth20`) ; sessions stockées en PostgreSQL via `connect-pg-simple` (ou en mémoire si aucune base n'est configurée).
- **Base de données** : PostgreSQL, utilisée pour les utilisateurs, les sessions et l'historique des analyses. L'application démarre et fonctionne aussi sans `DATABASE_URL` (voir « Jobs et persistance » ci-dessous).
- **Appels aux modèles** : API OpenRouter (`chat/completions`), avec l'outil intégré `openrouter:web_search`.
- **Vérification de sources** : API Firecrawl (`/v2/scrape`), en concurrence bornée.
- **Documents joints** : `multer` (upload en mémoire), `mammoth` (extraction `.docx`), `pdf-parse` (extraction `.pdf`), `exceljs` (lecture `.xlsx`).
- **Exports de résultats** : `pdfkit` (PDF), `docx` (Word), `exceljs` (Excel), Markdown généré directement.
- **Frontend** : HTML/CSS/JavaScript vanilla dans `public/`, servi tel quel par `express.static` — pas de framework, pas d'étape de build.
- **Sécurité applicative** : `helmet` (en-têtes, CSP), `express-rate-limit` (limitation globale et sur `POST /api/jobs`), cookies de session `httpOnly`/`secure` (en production)/`sameSite=lax`.
- **Temps réel** : Server-Sent Events natifs (pas de WebSocket, pas de dépendance supplémentaire).

### Arborescence

```text
server.js            Câblage HTTP : auth, prompts, boucle contradictoire, routes API, exports, SSE
lib/                 Logique sans effet de bord, importable par les tests
  task.js             Classification du domaine et cadrage du rédacteur
  models.js           Modèles par défaut, liste blanche, résolution auto/manuelle
  release.js          Date de production de la version : cascade de sources, la plus fidèle d'abord
  audit.js            Verdict d'audit, condition d'arrêt, stagnation, confiances de l'arbitrage
  explore.js          Cadrage préalable : dimensions, questions de recherche, angles morts
  claims.js           Inventaire des affirmations, porte de validation, détection de régression
  evidence.js         Validation opposable : citation présente dans la page, sources contrôlables
  report.js           Mise en forme des exports : dossier de preuves, pas seulement la prose
  falsify.js          Réfutation adversariale : déclencheurs, contrat, contradictions confirmées
  diverge.js          Second avis indépendant et matrice des divergences
  persistence.js      Mise en forme des lignes historisées et journaux de fin d'analyse
  analytics.js        Agrégats sur l'ensemble des exécutions
  progress.js         Position des étapes sur la barre de progression
  sources.js          Extraction, dédoublonnage, classification et budget de vérification des sources
  dashboard.js        Agrégation des coûts et tokens par modèle
  utils.js            Concurrence bornée, parsing JSON tolérant, noms d'export
test/                Suite node:test (npm test)
public/
  index.html          Structure HTML de l'interface
  app.js               Logique frontend : connexion, formulaire, suivi SSE, historique, consultation
  styles.css           Styles (thèmes clair/sombre, mise en page responsive)
docs/
  BUILD_PROMPT.md       Prompt maître autonome permettant de reconstruire l'application
CHANGELOG.md            Historique des versions (Keep a Changelog + SemVer)
render.yaml            Déploiement Render (service web + base PostgreSQL)
Dockerfile              Image de production (node:20-alpine)
.dockerignore
.env.example            Variables d'environnement attendues
package.json / package-lock.json
```

### Modèle de données (PostgreSQL)

Créées automatiquement au démarrage si `DATABASE_URL` est défini (`initDb`) :

- **`users`** : `id` (uuid), `google_id` (unique), `email`, `name`, `picture`, `created_at`, `updated_at`.
- **`runs`** : `id` (uuid), `user_id` (référence `users`), `request`, `task_type`, `status`, `stop_reason`, `writer_model`, `auditor_model`, `arbiter_model`, `final_document`, `result` (jsonb — objet complet de l'analyse), `total_cost`, `prompt_tokens`, `completion_tokens`, `created_at`, `updated_at`, plus des colonnes résumées calculées à l'écriture : `cycles`, `final_score`, `arbiter_decision`, `arbiter_confidence`, `arbiter_evidence_confidence`, `arbiter_conclusion_confidence`, `claims_total`, `claims_critical_unverified`, `sources_total`, `sources_accessible`, `document_chars`, `duration_ms`, `firecrawl_enabled`, `error`. Index sur `(user_id, created_at desc)`.
- **`run_claims`** : une ligne par affirmation inventoriée, à chaque cycle — `claim_id`, `type`, `affirmation`, `statut`, `critique`, `sources` (jsonb). C'est le niveau de traçabilité qui manquait entre le document et la source : il permet de répondre à « sur quoi repose cette recommandation ? » et « si cette source tombe, qu'est-ce qui devient faux ? ».
- **`run_sources`**, **`run_audits`**, **`run_calls`** : le détail d'une exécution sous forme requêtable — une ligne par source contrôlée, par cycle d'audit et par appel de modèle. Le jsonb `result` reste la source de vérité pour la relecture intégrale ; ces tables existent pour pouvoir filtrer et agréger sans le désérialiser. Écrites dans la même transaction que la ligne parente, supprimées en cascade avec elle.

Les analyses en échec sont enregistrées comme les autres (`status='error'`, colonne `error` renseignée), avec le document déjà rédigé et les cycles déjà consommés.

Sans base configurée, aucune table n'est créée : l'authentification Google reste possible (session en mémoire), mais l'historique et le tableau de bord ne reflètent que les jobs encore présents dans la mémoire du processus (voir « Jobs et persistance »).

### Authentification

- **Mode normal** : OAuth Google. Cookie de session `httpOnly`, `secure` en production, `sameSite=lax`, durée de vie 7 jours.
- **Mode développeur** (`DEV_BYPASS_AUTH=true`) : fournit un utilisateur factice (`dev@local`) sans passer par Google, pour tester en local. Le serveur refuse de démarrer si cette variable vaut `true` alors que `NODE_ENV=production` (`server.js`, garde-fou explicite).
- Toutes les routes `/api/*` hormis `/api/me` et `/api/health` exigent une session authentifiée (`requireAuth`).

### Routes API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/me` | Utilisateur courant et disponibilité de l'authentification Google |
| GET | `/api/health` | État de santé : version, date de production de la version, base de données, clés API configurées |
| GET | `/auth/google` | Démarre le flux OAuth Google |
| GET | `/auth/google/callback` | Retour du flux OAuth |
| POST | `/auth/logout` | Déconnexion et destruction de session |
| POST | `/api/jobs` | Crée une analyse (multipart, jusqu'à 3 documents joints) et démarre la boucle en tâche de fond |
| GET | `/api/jobs/:id/events` | Flux Server-Sent Events de progression d'une analyse |
| GET | `/api/history` | Historique des analyses de l'utilisateur connecté |
| GET | `/api/dashboard` | Agrégats de consommation sur 90 jours — conservé pour compatibilité, supplanté par `/api/analytics` que l'interface utilise |
| GET | `/api/runs/:id` | Détail complet d'une exécution passée (document, audits, sources, appels) |
| GET | `/api/analytics` | Agrégats sur toutes les exécutions (sources, audits, consommation) |
| GET | `/api/runs/:id/export/:format` | Export d'une analyse (`md`, `pdf`, `docx`, `xlsx`), dossier de preuves compris |

### Boucle d'analyse (`executeJob`)

1. Vérifie la présence d'une clé OpenRouter (variable serveur ou saisie temporaire) et la validité de la demande (20 caractères minimum ou au moins une pièce jointe).
2. Extrait le texte des documents joints (30 000 caractères maximum par fichier) et l'injecte dans la demande, précédé d'une consigne explicite empêchant le modèle d'exécuter des instructions qui s'y trouveraient (protection contre l'injection de prompt via document).
3. Classe automatiquement la tâche (`detectTask`) sauf si la sélection des modèles est manuelle.
4. Sélectionne les modèles rédacteur/auditeur/arbitre selon le type de tâche. En sélection manuelle uniquement, retient ceux fournis par l'utilisateur, contrôlés contre une liste blanche côté serveur (`ALLOWED_MODELS`) — le sélecteur de l'interface n'est pas une protection.
5. Cadre la demande (`explorerSystem`, sans recherche web) : dimensions à couvrir, questions de recherche, angles morts et périmètre non tranché. Le résultat est préfixé à la demande transmise au rédacteur. Une erreur à cette étape n'interrompt jamais l'analyse — le rédacteur travaille alors sur la demande seule.
6. Produit une rédaction initiale avec recherche web OpenRouter.
7. Si le second avis est déclenché (domaine juridique ou financier, ou demande explicite) : fait traiter la même demande par un second rédacteur qui ne voit pas la première analyse, puis compare les deux (`divergenceSystem`). Les désaccords et les accords non étayés rejoignent la correction du cycle 1 et l'arbitrage.
8. Enchaîne jusqu'à `maxCycles` cycles (1 à 5) : vérification des sources citées via Firecrawl (concurrence bornée à 4, quota de 10 nouvelles sources par cycle et plafond de 20 par analyse), audit JSON structuré **avec inventaire des affirmations**, puis arrêt si le score atteint le seuil cible, sans anomalie critique/élevée, sans source essentielle non vérifiée, **sans source citée mesurée injoignable**, **sans affirmation déterminante non vérifiée**, sans demande explicite de nouveau cycle et sans verdict `CORRIGER` de l'auditeur ; sinon correction complète du document et nouveau cycle. Les motifs de poursuite sont affichés dans le fil de suivi.
9. Compare l'inventaire au cycle précédent et signale les affirmations établies qui ne le sont plus après réécriture (signal informatif, non bloquant).
10. Abandonne les cycles restants si deux audits consécutifs ne progressent ni sur le score ni sur le nombre d'anomalies sévères (arrêt sur stagnation) : le document part malgré tout à l'arbitrage.
11. Déclenche la réfutation adversariale (`falsifierSystem`, **avec** recherche web) si la validation repose sur quelque chose d'invérifié. Les URL qu'elle produit sont contrôlées comme les autres ; les objections sans URL sont écartées par le code.
12. Fait arbitrer la version finale par un modèle indépendant, qui ne réécrit jamais le document et rend deux confiances distinctes (preuves, conclusion). Une contradiction grave, sourcée et dont la page répond dégrade le statut même sur un `APPROUVE`, sans réécrire la décision rendue.
13. Historise l'exécution si une base est configurée — ligne de synthèse, détail jsonb et lignes normalisées, en une transaction — puis diffuse l'événement `complete`. Un échec d'écriture est signalé mais ne fait pas échouer l'analyse : le résultat est publié dans tous les cas, et le champ `persisted` indique s'il a bien été enregistré.
14. Journalise une ligne de fin (`[job] fin …`) résumant statut, cycles, score, arbitrage, sources, appels, tokens, coût, taille du document, durée et historisation. Une analyse interrompue produit une ligne `[job] échec …` et est historisée avec `status='error'`, son document déjà rédigé et ses cycles déjà consommés.

L'analyse est aussi **enregistrée en cours de route**, à deux moments : dès la première version rédigée, puis à la fin de chaque cycle d'audit. Ces points de reprise portent `status='interrupted'` et sont remplacés par le statut réel à l'écriture finale — une ligne restée `interrupted` désigne donc une analyse dont le processus a disparu avant la fin. C'est le seul filet contre la disparition du processus lui-même : le gestionnaire d'erreur ne se déclenche que si la promesse est rejetée, jamais si l'instance est recyclée, et la boucle dure de dix à vingt minutes. Sans ces points de reprise, une analyse tuée en vol ne laissait aucune trace — ni document, ni cycles, ni le coût déjà engagé.

À chaque étape, un événement est diffusé en SSE pour alimenter le fil de suivi de l'interface.

### Diffusion temps réel (SSE)

`GET /api/jobs/:id/events` rejoue d'abord tous les événements déjà émis pour ce job, puis reste ouvert (un ping toutes les 20 secondes maintient la connexion). Types d'événements émis : `models`, `insight`, `progress`, `source`, `audit`, `complete`, `error`. Les catégories d'`insight` couvrent `strategy`, `documents`, `explore`, `draft`, `challenger`, `divergence`, `sources`, `audit`, `falsify`, `arbitration`, `persistence` et `error` ; les étapes de `progress` sont `explore`, `draft`, `challenger`, `divergence`, `sources`, `audit`, `correction`, `falsify` et `arbiter`. Les événements `progress` et `insight` portent un champ `cycle` explicite, ce qui permet au frontend de n'afficher qu'une seule entrée par étape (d'abord « en cours », puis enrichie de son constat détaillé) plutôt que deux fils redondants.

### Jobs et persistance en mémoire

Les jobs actifs et leurs événements SSE vivent dans une `Map` en mémoire du processus (nécessaire pour le flux SSE), indépendamment de PostgreSQL. `sweepJobs()` s'exécute toutes les 10 minutes et supprime les jobs terminés depuis plus de 2 heures sans client connecté, avec une borne dure à 500 jobs conservés quel que soit leur âge. Conséquences pratiques :

- sans `DATABASE_URL`, l'historique et le dashboard ne montrent que les jobs encore présents dans cette mémoire (perdus au redémarrage) ;
- avec plusieurs instances de l'application derrière un répartiteur de charge, le client SSE doit atteindre la même instance que celle qui a créé le job (pas de file d'attente partagée) ;
- un échec d'écriture en base ne fait pas échouer une analyse aboutie : le résultat est publié malgré tout, l'incident est signalé dans le fil de suivi et le champ `persisted` du résultat indique si l'exécution a bien été enregistrée.

## Sécurité et fiabilité

- **Code source direct** : `server.js`, `lib/*` et `public/*` sont le code réellement exécuté par l'application, sans étape de génération ni de réécriture au démarrage.
- **Éviction périodique des tâches en mémoire** (`sweepJobs`) : borne la durée de rétention (2 heures) et le nombre maximal de jobs conservés (500), pour empêcher toute croissance mémoire illimitée du processus.
- **Vérification TLS Postgres activée par défaut** en production, avec une option `DATABASE_CA_CERT` pour une autorité privée.
- **Garde-fou `DEV_BYPASS_AUTH`** : le serveur refuse de démarrer si ce contournement d'authentification est combiné à `NODE_ENV=production`.
- **Vérification des sources parallélisée**, avec une concurrence bornée, pour réduire la latence perçue lors des cycles d'audit.
- **En-têtes de sécurité (`helmet`) et limitation de débit (`express-rate-limit`)**, notamment sur la création d'analyses (`POST /api/jobs`), pour limiter les abus et l'emballement des coûts.
- **Builds reproductibles** : `package-lock.json` commité, installation via `npm ci` au build du conteneur (pas au démarrage).

## Interface

- Contraste du bouton principal « Lancer la boucle » conforme au seuil WCAG AA.
- Badge « Non configurée » d'OpenRouter distingué de celui de Firecrawl (rouge/bloquant vs ambre/optionnel) : sans clé OpenRouter aucune analyse n'est possible, alors que Firecrawl n'est qu'une amélioration.
- Bloc « Comment ça marche » visible avant connexion.
- Sélecteurs de modèles (Rédacteur/Auditeur/Arbitre) masqués entièrement en mode automatique, au lieu d'être grisés tout en occupant de l'espace.
- **Fil de suivi unique** (« Suivi de l'analyse ») : chaque étape (rédaction, sources, audit, arbitrage) apparaît une seule fois, d'abord comme « en cours » puis enrichie en place avec son constat détaillé (dépliable), au lieu de produire deux entrées séparées et redondantes dans deux panneaux différents. Le serveur transmet un `cycle` explicite sur les événements `progress`/`insight` pour permettre cet appariement fiable côté client.
- Règle CSS globale `[hidden]{display:none!important}` : garantit que l'attribut `hidden` prime toujours sur les classes de mise en page (`.empty`, `.grid`), pour tous les éléments concernés, présents ou futurs.
- Textes d'aide sous « Cycles maximum » / « Score cible » et indication de durée typique près du bouton d'envoi.
- Point de bascule responsive unique (au lieu de media queries dupliquées).
- Libellés de modèles raccourcis pour éviter la troncature dans les listes déroulantes sur mobile.
- Indice visuel de défilement sur la barre d'onglets quand elle déborde (mobile).
- Focus clavier harmonisé sur les boutons et onglets (même anneau que les champs de formulaire).
- Thème clair activé automatiquement selon la préférence système (`prefers-color-scheme`), sans bascule manuelle.
- Lien rapide « Historique ↓ » dans l'en-tête pour un accès direct sans défiler toute la page.
- Date de production de la version à côté de son numéro, en retrait visuel, avec en infobulle la source dont elle est tirée. Masquée plutôt qu'approximée si aucune source n'est exploitable.
- Chaque panneau porte en haut à gauche un intitulé court en capitales et en vert (`.eyebrow`) qui le nomme : « ÉTAT DES SERVICES », « NOUVELLE ANALYSE », « TRAITEMENT EN COURS », « HISTORIQUE », « DONNÉES HISTORISÉES ».
- Sur ordinateur, le formulaire occupe toute la largeur tant qu'aucune analyse n'est affichée — donc la même que le bandeau d'état au-dessus — et repasse en colonne dès que le panneau de résultats apparaît à sa droite.
- Lignes d'historique activables au clavier (`Entrée`/`Espace`) autant qu'à la souris, ouvrant le détail de l'analyse sous le tableau.

## Déploiement

- Dépôt : `newbizai2023-ops/boucle-contradictoire-version-claude`
- Branche : `main`
- Runtime : Node.js 20+
- Base : PostgreSQL

Adapter `render.yaml` (nom de service, région) à l'environnement cible avant tout déploiement.

Variables Render attendues :

```text
OPENROUTER_API_KEY=
FIRECRAWL_API_KEY=
DATABASE_URL=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SESSION_SECRET=
APP_URL=https://boucle-contradictoire.onrender.com
NODE_ENV=production
DEV_BYPASS_AUTH=false
```

Variables facultatives :

```text
FIRECRAWL_ZERO_DATA_RETENTION=false   # ne passer à true que si l'option est activée sur le compte
DATABASE_SSL_REJECT_UNAUTHORIZED=true # vérification du certificat Postgres (défaut : activée)
DATABASE_CA_CERT=                     # certificat PEM d'une autorité privée
```

`PORT` est fourni automatiquement par Render ; en local, il vaut 3000 par défaut.

Les clés réelles ne doivent jamais être ajoutées au dépôt.

## Fonctionnement

```text
Utilisateur authentifié
        ↓
Classification de la tâche
        ↓
Sélection des modèles
        ↓
Cadrage préalable : dimensions, questions, angles morts
        ↓
Rédaction avec recherche Web OpenRouter
        ↓
Second avis indépendant et matrice des divergences (conditionnel)
        ↓
Extraction et contrôle des URL avec Firecrawl
        ↓
Audit contradictoire structuré
        ↓
Porte d'arrêt déterministe (score, anomalies, sources mesurées)
        ↓
Correction complète du document
        ↓
Nouveaux cycles, jusqu'à validation, stagnation ou épuisement
        ↓
Réfutation adversariale avec recherche (conditionnelle)
        ↓
Arbitrage final indépendant (deux confiances)
        ↓
Historisation, consultation et exports
```

La progression est diffusée en temps réel par Server-Sent Events et affichée sous forme de fil chronologique.

## Modèles par défaut

| Type de tâche | Rédacteur | Auditeur | Arbitre | Second avis |
|---|---|---|---|---|
| Technique | Claude Opus latest | GPT-5.6 Sol | Grok latest | GPT |
| Financier / FinOps | Claude Opus latest | GPT-5.6 Sol | Grok latest | GPT |
| Juridique / conformité | Claude Opus latest | GPT-5.6 Sol | Grok latest | GPT |
| Recherche actuelle | Claude Sonnet latest | GPT-5.6 Sol | Grok latest | GPT |
| Analyse générale | Claude Sonnet latest | GPT latest | Grok latest | GPT-5.6 Terra |

Un cinquième rôle, **réfutation**, mène la recherche adversariale : Kimi par défaut sur tous les domaines. Il était confié à l'arbitre jusqu'en 1.7.0, ce qui revenait à lui faire chercher les contradictions puis juger ses propres trouvailles — sur l'élément de preuve le plus lourd du dispositif, celui qui peut dégrader un `APPROUVE`.

Modèles proposés en sélection manuelle, pour chacun des trois rôles réglables : Claude Opus, Claude Sonnet, Claude Haiku, GPT-5.6 Sol, GPT-5.6 Terra, Kimi, Grok, Gemini Flash et DeepSeek V4 Flash. La liste blanche `ALLOWED_MODELS` (dérivée de `MODEL_LABELS`) fait foi côté serveur : le `<select>` de l’interface n’est pas une protection, puisque la clé du déploiement prime sur celle de l’utilisateur.

Les modèles peuvent être sélectionnés manuellement dans l’interface. Le modèle du second avis n’est sollicité que lorsque cette étape est déclenchée ; il est toujours résolu vers un modèle différent du rédacteur **et** de l’arbitre, y compris en sélection manuelle — un second avis rendu par le rédacteur n’en serait pas un, et un arbitre qui a co-rédigé ne peut plus juger.

## Détection du type de tâche

Les mots-clés sont cherchés sur des **mots entiers**. La recherche par sous-chaîne produisait des faux positifs absurdes et silencieux — « trois » contient « roi » (financier), « rapide » contient « api » (technique) — anodins tant que le domaine ne pilotait que le choix des modèles, coûteux depuis qu'il déclenche un second avis. La frontière ne peut pas être `\b`, qui coupe sur les caractères accentués : elle porte sur tout ce qui n'est ni lettre ni chiffre, de sorte que « coût » et « coûts » restent reconnus.

Lorsqu'une demande relève de plusieurs domaines, une priorité explicite s'applique — juridique, puis financier, puis technique, puis actualité — au lieu de l'ordre des conditions dans le fichier. Une « architecture financière » est ainsi traitée comme financière.


- `technical` : code, bug, API, architecture, développement, script, GitHub ;
- `financial` : prix, coût, budget, FinOps, ROI, économie, facturation ;
- `legal` : contrat, juridique, loi, règlement, conformité ;
- `current_research` : actualité, récent, dernier, aujourd('hui), annonce, veille ;
- `general_analysis` : cas général.

La classification porte sur la **demande saisie seule**, jamais sur le texte des documents joints : une pièce jointe ne doit pas déterminer le modèle qui la traitera.

Les motifs sont recherchés en sous-chaîne, sans limite de mot : « trois » contient « roi » et « rapide » contient « api », ce qui produit des classements inattendus. Limite connue, figée par un test (`test/task.test.js`).

## Politique de sources

Les prompts renforcés imposent désormais les règles suivantes :

1. Toute affirmation factuelle importante doit être associée à une source identifiable et directement exploitable.
2. La hiérarchie de préférence est :
   - source officielle ou texte normatif ;
   - documentation ou publication primaire ;
   - article scientifique évalué par les pairs ;
   - données institutionnelles ;
   - média reconnu ;
   - source secondaire.
3. Les affirmations critiques doivent être croisées avec au moins deux sources indépendantes lorsque cela est raisonnablement possible.
4. Deux pages reprenant la même dépêche, la même étude ou le même communiqué ne constituent pas deux sources indépendantes.
5. Les divergences entre sources doivent être présentées explicitement.
6. La date de publication doit être distinguée de la date réelle de l’événement et, le cas échéant, de la date d’entrée en vigueur.
7. Une source inaccessible ou une citation qui ne soutient pas l’affirmation est considérée comme non vérifiée.
8. Une source inventée ou un calcul déterminant faux constitue une anomalie critique.
9. Toute information impossible à confirmer doit être accompagnée de la formulation :

```text
Je ne peux pas confirmer cette information
```

## Recherche Web OpenRouter

Les appels utilisent l’outil :

```json
{
  "type": "openrouter:web_search",
  "engine": "auto",
  "search_context_size": "high",
  "max_total_results": 10
}
```

La recherche Web OpenRouter reste disponible indépendamment de Firecrawl.

## Firecrawl

Firecrawl est utilisé pour ouvrir et extraire le contenu des URL citées. La case « Vérification approfondie des sources via Firecrawl » ne peut être activée que lorsqu’une clé Firecrawl valide est disponible côté Render ou saisie temporairement dans l’interface.

**Quotas.** Chaque cycle peut faire contrôler jusqu'à 10 URL *nouvelles*, dans la limite de 20 par analyse. Le quota par cycle existe parce qu'un plafond uniquement global se saturait au premier cycle : le rédacteur initial cite l'essentiel des liens, et les sources qu'une correction ajoutait ensuite n'étaient plus jamais vérifiées — le document livré pouvait donc citer des pages que personne n'avait ouvertes. Les URL qui dépassent le quota d'un cycle ne sont pas perdues : elles restent candidates au cycle suivant et apparaissent dans le rapport comme non contrôlées, avec leur motif.

Formats acceptés :

```text
fc-...
fc_...
```

La validation effectuée dans l’interface contrôle le format, pas l’authenticité de la clé. L’authenticité est vérifiée lors de l’appel API.

**Rétention nulle (ZDR)** : `FIRECRAWL_ZERO_DATA_RETENTION` vaut `false` par défaut et ne doit être passée à `true` que si l’option « Zero Data Retention » est réellement activée sur le compte Firecrawl (à demander à leur support). L’envoyer sans que le compte en dispose fait échouer **toutes** les requêtes avec une erreur HTTP 403, chaque source ressortant « inaccessible » alors que la clé est valide — constaté en production avant la 1.1.8.

## Prompts utilisés

Les prompts effectifs sont définis dans `server.js` (`writerSystem`, `auditorSystem`, `arbiterSystem`, `taskGuidance`) et dans `lib/` pour les étapes ajoutées en 1.7.0 : `explorerSystem` (`lib/explore.js`), `falsifierSystem` (`lib/falsify.js`) et `divergenceSystem` (`lib/diverge.js`). Ces trois-là sont volontairement co-localisés avec la logique qui exploite leur sortie — un contrat JSON et le code qui le normalise se relisent ensemble.

### Prompt système du rédacteur

```text
Tu es le rédacteur principal d'une boucle contradictoire. Produis en français un document professionnel, structuré et directement exploitable.

RÈGLES DE FIABILITÉ
1. Distingue explicitement : faits vérifiés, hypothèses, estimations, interprétations et recommandations.
2. Toute affirmation factuelle importante doit comporter une citation immédiatement exploitable avec le titre ou l'organisme, la date pertinente et une URL complète.
3. Privilégie dans cet ordre : source officielle ou texte normatif, documentation ou publication primaire, article scientifique évalué par les pairs, données institutionnelles, média reconnu, puis source secondaire. Explique toute dérogation.
4. Pour les informations susceptibles d'avoir changé, recherche la version la plus récente et indique la date de consultation ou de mise à jour. Distingue la date de publication de la date réelle de l'événement.
5. Croise les affirmations critiques avec au moins deux sources indépendantes lorsque cela est raisonnablement possible. Ne considère pas comme indépendantes des pages qui reprennent la même dépêche ou la même étude.
6. Signale clairement les divergences entre sources, sans les fusionner artificiellement.
7. N'invente jamais de source, de citation, de chiffre ou de résultat. Si une information ne peut pas être confirmée, écris exactement : « Je ne peux pas confirmer cette information ».
8. Pour chaque calcul : indique les données d'entrée, unités, formule, étapes, résultat et règle d'arrondi.
9. Pour les sujets médicaux, juridiques et financiers : précise les limites, le territoire ou la population concernés, la date d'applicabilité et la nécessité éventuelle d'une validation professionnelle.
10. N'affiche pas de chaîne de pensée privée. Fournis uniquement les éléments de preuve, méthodes, calculs et justifications utiles à la vérification.

STRUCTURE MINIMALE
- Résumé exécutif
- Périmètre, date de référence et méthode
- Faits vérifiés
- Analyse et calculs reproductibles
- Incertitudes, divergences et limites
- Recommandations
- Sources numérotées avec URL complètes
```

### Instructions spécifiques selon le domaine

#### Technique

```text
Vérifie les versions, prérequis, compatibilités, limites, sécurité, exemples reproductibles et documentation officielle. Sépare comportement documenté, comportement observé et hypothèse.
```

#### Financier / FinOps

```text
Indique devise, région, période, taxes, remises, hypothèses d'usage, coûts unitaires, formules, scénarios et sensibilité. Ne compare que des périmètres économiquement équivalents.
```

#### Juridique / conformité

```text
Privilégie les textes officiels et versions consolidées. Indique juridiction, date d'entrée en vigueur, champ d'application, exceptions et niveau d'incertitude. Ne présente pas l'analyse comme un avis juridique.
```

#### Actualité

```text
Distingue date de publication et date de l'événement, vérifie les mises à jour, privilégie les déclarations et documents de première main, et signale les faits encore évolutifs.
```

### Prompt système de l’auditeur

```text
Tu es un auditeur contradictoire indépendant et sceptique. Vérifie le document contre la demande initiale, les exigences du domaine, les sources structurées OpenRouter et le contenu réellement extrait par Firecrawl. Réponds uniquement en JSON valide.

AUDIT OBLIGATOIRE
- Vérifie chaque affirmation matérielle et associe-la à une preuve précise.
- Sanctionne les URL absentes, les pages inaccessibles, les citations qui ne soutiennent pas l'affirmation et les sources secondaires utilisées alors qu'une source primaire est disponible.
- Détecte les sources circulaires, les reprises d'une même dépêche ou publication et les faux croisements.
- Compare date de publication, date de l'événement, date d'entrée en vigueur et date de consultation.
- Recalcule les résultats à partir des données, unités et formules ; signale tout calcul non reproductible.
- Identifie les contradictions internes et les divergences entre sources.
- Pour les sujets médicaux, juridiques ou financiers, contrôle le périmètre, la population ou juridiction, les limites et les avertissements nécessaires.
- Une affirmation importante non prouvée est une anomalie au minimum élevée ; une source inventée ou un calcul déterminant faux est critique.
- N'accorde jamais VALIDATION si une anomalie critique ou élevée subsiste, si une source essentielle est inaccessible, ou si un résultat déterminant n'est pas reproductible.
```

### Format JSON de l’audit

```json
{
  "score_global": 0,
  "scores": {
    "exactitude_factuelle": 0,
    "qualite_sources": 0,
    "calculs": 0,
    "couverture": 0,
    "coherence": 0,
    "actualite": 0
  },
  "decision": "CORRIGER|VALIDER",
  "resume": "",
  "anomalies": [
    {
      "categorie": "fait|source|date|calcul|couverture|coherence|limite",
      "gravite": "critique|elevee|moyenne|faible",
      "affirmation_concernee": "",
      "probleme": "",
      "preuve": "URL ou extrait précis",
      "correction_attendue": ""
    }
  ],
  "sources_non_verifiees": [],
  "sources_circulaires_ou_non_independantes": [],
  "divergences_sources": [],
  "calculs_reproduits": [
    {
      "objet": "",
      "entrees": [],
      "formule": "",
      "resultat": "",
      "conforme": true
    }
  ],
  "nouveau_cycle_requis": true
}
```

### Prompt de correction

```text
Corrige intégralement le document selon l'audit. Traite chaque anomalie critique et élevée. Supprime ou reformule toute affirmation non étayée. Préserve les éléments vérifiés. Rends tous les calculs reproductibles. Signale explicitement les divergences qui ne peuvent pas être tranchées. Maintiens la structure minimale imposée par le prompt système.
```

Le correcteur reçoit également la demande initiale, le document actuel, l’audit JSON et la liste des sources vérifiées.

### Prompt système de l’arbitre

```text
Tu es l'arbitre final indépendant. Tu ne réécris pas le document. Tu évalues la version finale, les audits successifs et l'état réel des sources. Réponds uniquement en JSON valide avec decision, confiance, confiance_preuves, confiance_conclusion, motifs, reserves et actions_requises.

RÈGLES DE DÉCISION
- APPROUVE uniquement si toutes les affirmations déterminantes sont étayées, les calculs reproductibles et aucune anomalie critique ou élevée ne subsiste.
- APPROUVE_AVEC_RESERVES uniquement pour des limites circonscrites qui ne changent pas la conclusion principale.
- REJETE si une source essentielle est inaccessible ou contradictoire sans traitement, si un calcul déterminant est faux ou non reproductible, si le document dépasse les preuves, ou si le périmètre demandé n'est pas couvert.
- Les confiances sont des entiers de 0 à 100 fondés sur la qualité et l'indépendance des preuves, jamais sur le style.
- Évalue séparément deux dimensions indépendantes. confiance_preuves : solidité, indépendance, accessibilité et fraîcheur des sources qui soutiennent le document. confiance_conclusion : degré auquel la conclusion découle de ces preuves, compte tenu des hypothèses métier, du périmètre retenu et des scénarios non testés. Une base factuelle solide peut porter une recommandation fragile : dans ce cas, confiance_preuves est élevée et confiance_conclusion basse. Justifie tout écart supérieur à 20 points dans les motifs.
- confiance est la confiance globale ; elle ne peut pas dépasser la plus faible des deux dimensions.
- Les motifs citent des constats précis des audits ou des sources. Les actions requises sont concrètes et vérifiables.
```

### Format JSON de l’arbitrage

```json
{
  "decision": "APPROUVE|APPROUVE_AVEC_RESERVES|REJETE",
  "confiance": 0,
  "confiance_preuves": 0,
  "confiance_conclusion": 0,
  "motifs": [
    {
      "constat": "",
      "preuve": ""
    }
  ],
  "reserves": [],
  "actions_requises": []
}
```

`confiance` est normalisée côté serveur : bornée à `[0,100]`, déduite des deux dimensions si le modèle l'omet, et plafonnée par la plus faible d'entre elles. Lorsqu'un plafonnement s'applique, la valeur annoncée par l'arbitre est conservée dans `confiance_annoncee` et affichée telle quelle — un ajustement silencieux serait un mensonge de plus, pas une correction.

## Règles de validation

Un document ne peut être validé automatiquement que si :

- le score global atteint le seuil défini ;
- aucune anomalie critique ou élevée ne subsiste ;
- aucune source essentielle n’est non vérifiée ;
- **aucune URL encore citée par le document n’a été mesurée injoignable** ;
- **aucune affirmation déterminante ne reste non vérifiée ou contredite** — une affirmation déclarée vérifiée par l'auditeur est d'abord rétrogradée si aucune de ses sources ne figure au dossier ou n'a pu être extraite ;
- aucun nouveau cycle n’est demandé ;
- l’auditeur ne conclut pas à `CORRIGER` ;
- l’arbitre rend une décision d’approbation.

Le quatrième critère est le seul qui ne dépende d’aucun modèle : il oppose la mesure Firecrawl au verdict de l’auditeur. Il ne porte que sur les liens **encore présents dans le document** — retirer ou remplacer une source morte lève le blocage, ce qui est exactement la correction attendue. Une source non contrôlée (`accessible: null` : Firecrawl désactivé, ou budget de l’analyse épuisé) ne bloque pas : on ne peut pas reprocher au document une vérification qui n’a pas eu lieu.

Lorsqu’un cycle supplémentaire est engagé, les motifs qui l’imposent sont affichés dans le fil de suivi et conservés dans la raison d’arrêt de l’analyse. Celle-ci est désormais affichée sous les métriques du résultat et dans le détail d’une analyse historisée.

## Scores détaillés

| Score | Objet |
|---|---|
| `exactitude_factuelle` | conformité des affirmations aux preuves |
| `qualite_sources` | autorité, indépendance, accessibilité et pertinence |
| `calculs` | formules, unités, hypothèses et reproductibilité |
| `couverture` | réponse complète à la demande |
| `coherence` | absence de contradictions internes |
| `actualite` | fraîcheur des informations et cohérence des dates |

## Fichiers et interface

- ajout de plusieurs documents ;
- suppression individuelle d’un document avant analyse ;
- validation du format des clés API ;
- activation conditionnelle de Firecrawl ;
- choix du second avis indépendant : automatique, toujours, jamais ;
- fil d’information chronologique avec défilement automatique ;
- sélection manuelle ou automatique des modèles ;
- historique cliquable ouvrant le détail d’une analyse passée ;
- panneau de données historisées agrégeant toutes les analyses ;
- onglet « Affirmations » : inventaire du dernier cycle, déterminantes non établies en tête, et ce que la réécriture a fait perdre ;
- onglet « Contradiction » : cadrage préalable, second avis et désaccords, réfutation adversariale.

## État des services

La page d'accueil affiche, avant même la connexion, l'état des 4 services externes dont dépend
l'application (source : `GET /api/health`, public) :

| Service | Signifie | Sévérité si absent |
|---|---|---|
| OpenRouter | clé API configurée côté serveur | critique — aucune analyse n'est possible |
| Firecrawl | clé API configurée côté serveur | non bloquant — recherche web OpenRouter toujours disponible |
| Authentification Google | `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` configurés | critique — aucune connexion possible (hors `DEV_BYPASS_AUTH`) |
| Base de données | connexion PostgreSQL active (`SELECT 1`) | non bloquant — historique et dashboard limités à la mémoire du process |

## Exports

Les exports emportent le dossier, pas seulement la prose : un document exporté qui perdrait ses preuves redeviendrait un texte parmi d'autres.

| Format | Contenu |
|---|---|
| Markdown | Document, raison d'arrêt, cadrage, affirmations, sources et leur état, désaccords, réfutation, arbitrage |
| Excel | Onglets Synthèse, Scores, Affirmations, Sources, Divergences, Réfutation, Consommation |
| PDF et Word | Document, puis une annexe compacte reprenant affirmations, sources, désaccords, réfutation et arbitrage |

## Historique et consultation

Lorsqu’une base est configurée, **toute** exécution est historisée — y compris celles qui échouent.
Sont conservés : la demande, le type de tâche, les modèles, les versions successives, les audits,
les sources, l’arbitrage, les coûts et tokens, le document final, la durée et, le cas échéant, le
motif d’échec.

Le détail complet reste dans la colonne `result` (jsonb) pour la relecture intégrale. En parallèle,
les sources, les audits et les appels de modèle sont écrits en lignes normalisées, ce qui permet de
les filtrer et de les agréger sans désérialiser chaque exécution — c’est ce qui alimente
`GET /api/analytics`.

Dans l’interface :

- **Analyses passées** : chaque ligne indique statut, score final, cycles, sources contrôlées et
  coût ; la sélectionner ouvre le détail complet (document, arbitrage, scores par cycle, sources,
  consommation, liens d’export). La liste est celle du serveur, et rien d’autre : un cache local
  sert à peindre le tableau avant que le réseau réponde, mais il ne complète jamais la réponse
  reçue. Il l’a fait jusqu’à la 1.11.0, et les analyses jamais historisées restaient alors affichées
  indéfiniment, avec un statut que le serveur n’avait jamais enregistré.
- **Données historisées** : agrégats sur l’ensemble des analyses, en quatre onglets — vue
  d’ensemble (validées, rejetées, en échec, score et cycles moyens, durée, coût), sources
  (répartition par état et par catégorie, domaines les plus cités avec leur taux d’accessibilité
  réel), audits (progression des scores par cycle, critères les plus faibles) et consommation
  (par modèle et par rôle).

Formats d’export : Markdown, PDF, Word et Excel.

## Installation locale

```bash
npm install
cp .env.example .env
npm start
```

Pour tester sans OAuth :

```text
DEV_BYPASS_AUTH=true
```

## Vérification du code

```bash
npm run check   # syntaxe (server.js, public/app.js) puis suite de tests
npm test        # suite de tests seule
```

Aucune génération de code n'a lieu au démarrage.

### Tests

La suite s'appuie sur le lanceur intégré de Node (`node:test`), sans aucune dépendance
supplémentaire. Elle couvre la logique sans effet de bord, extraite dans `lib/` précisément pour
être importable : `server.js` démarre un serveur HTTP au chargement et ne peut donc pas être
importé par un test.

| Fichier | Couvre |
| --- | --- |
| `test/task.test.js` | Classification du domaine (`detectTask`) et cadrage du rédacteur |
| `test/models.test.js` | Valeurs par défaut par domaine, liste blanche, résolution automatique/manuelle |
| `test/utils.test.js` | Concurrence bornée, lecture des réponses OpenRouter, parsing JSON tolérant, noms d'export |
| `test/sources.test.js` | Extraction, dédoublonnage et classification des sources |
| `test/dashboard.test.js` | Agrégation des coûts et tokens par modèle |
| `test/packaging.test.js` | Cohérence entre les imports de `server.js` et le contenu de l image Docker |
| `test/audit.test.js` | Lecture du verdict d'audit et condition d'arrêt de la boucle |
| `test/persistence.test.js` | Lignes historisées (sources, audits, appels) et journaux de fin |
| `test/analytics.test.js` | Agrégats inter-exécutions et forme canonique partagée |
| `test/progress.test.js` | Monotonie et bornes de la barre de progression |
| `test/interface.test.js` | Cohérence entre `public/` et le serveur (sélecteurs, modèles, formats d'export, extensions, limites d'upload) |

`test/interface.test.js` mérite une mention : il compare le vocabulaire du formulaire à celui du
serveur. C'est la classe de bugs la plus coûteuse du projet, parce qu'elle ne produit aucune erreur
— la 1.1.7 corrigeait un sélecteur `#firecrawl` inexistant qui rendait `isChecked()` toujours faux
et désactivait Firecrawl en silence. Rejoué sur la révision fautive, ce test le signale.

Deux tests figent des comportements **constatés mais non souhaitables**, signalés comme tels en
commentaire : les faux positifs de `detectTask` (« trois » contient « roi », « rapide » contient
« api ») et l'usurpation de `sourceClass` par sous-domaine (`bbc.exemple.com`). Ils sont là pour
qu'une correction future soit un changement délibéré et visible, pas une surprise.

## Journaux

Toutes les étapes notables émettent une ligne préfixée, pour pouvoir suivre une analyse depuis les
journaux du service sans instrumentation supplémentaire :

| Préfixe | Émis à |
| --- | --- |
| `[job] création` | création d'une analyse (identifiant, utilisateur, clés disponibles) |
| `[openrouter]` | chaque appel de modèle, ainsi que les réponses vides et les bascules de repli |
| `[firecrawl]` | décompte des sources candidates, puis chaque extraction et son issue |
| `[json]` | échec de parsing d'un audit ou d'un arbitrage, avec le contenu brut tronqué |
| `[db]` | échec d'initialisation ou d'historisation |
| `[job] fin` | fin d'analyse : statut, cycles, score, arbitrage, sources, appels, tokens, coût, durée |
| `[job] échec` | analyse interrompue, avec sa raison |

## Limites connues

- La classification des sources reste heuristique.
- Firecrawl ne garantit pas l’accès aux pages protégées, payantes ou bloquées. Une page joignable n’est pas pour autant probante : le lien entre une affirmation et la source qui la porte n’est apprécié que par l’auditeur, sur un extrait tronqué.
- Les scores produits par les modèles ne constituent pas une certification.
- L’inventaire des affirmations est produit par un modèle : une affirmation qu’il n’extrait pas n’est jamais vérifiée et n’apparaît dans aucune porte de contrôle.
- La vérification d’une citation établit sa présence dans la page, pas que la page implique l’affirmation : l’entailment sémantique reste une appréciation de modèle.
- Le recouvrement lexical de 60 % est un compromis : une reformulation très libre mais fidèle peut être écartée, une paraphrase thématique très proche peut passer.
- La détection de régression rapproche les affirmations sur leur énoncé, les identifiants ne survivant pas d’un cycle à l’autre : une reformulation compte comme une disparition. Le signal est informatif, jamais bloquant.
- Le second avis est rendu par un modèle distinct du rédacteur, mais du même éditeur que l’auditeur : l’indépendance obtenue est celle du modèle, pas encore celle de l’éditeur.
- La réfutation adversariale ne prouve rien lorsqu’elle ne trouve rien : un verdict `CONFIRME` signifie que la recherche adverse a échoué, pas que le document est exact.
- Les sujets sensibles doivent être revus par un professionnel qualifié.
- Les tâches SSE actives sont conservées en mémoire, avec une éviction automatique après 2 heures ou au-delà de 500 jobs conservés ; une coupure du processus interrompt une analyse en cours.
- La suite de tests (`npm test`) couvre la logique sans effet de bord extraite dans `lib/`, ainsi que la cohérence entre l'interface et le serveur. La boucle d'analyse elle-même (`executeJob`), les appels réseau (OpenRouter, Firecrawl), les routes Express et les exports restent non couverts.
