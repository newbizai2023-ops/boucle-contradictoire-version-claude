# Boucle Contradictoire

Application web Node.js qui orchestre une analyse multi-modèles avec recherche Web, contrôle des sources, corrections successives, arbitrage indépendant, historique PostgreSQL, exports et tableau de bord de consommation.

**Version actuelle : 1.0.0**

> 📄 [`docs/BUILD_PROMPT.md`](docs/BUILD_PROMPT.md) contient un prompt maître autonome permettant de recréer cette application (spécification complète, prompts système, contrats JSON, méthodologie de construction en boucles).

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
server.js            Backend complet : auth, prompts, boucle contradictoire, routes API, exports, SSE
public/
  index.html          Structure HTML de l'interface
  app.js               Logique frontend : connexion, formulaire, suivi SSE, historique, dashboard
  styles.css           Styles (thèmes clair/sombre, mise en page responsive)
docs/
  BUILD_PROMPT.md       Prompt maître autonome permettant de reconstruire l'application
render.yaml            Déploiement Render (service web + base PostgreSQL)
Dockerfile              Image de production (node:20-alpine)
.dockerignore
.env.example            Variables d'environnement attendues
package.json / package-lock.json
```

### Modèle de données (PostgreSQL)

Deux tables, créées automatiquement au démarrage si `DATABASE_URL` est défini (`initDb`) :

- **`users`** : `id` (uuid), `google_id` (unique), `email`, `name`, `picture`, `created_at`, `updated_at`.
- **`runs`** : `id` (uuid), `user_id` (référence `users`), `request`, `task_type`, `status`, `stop_reason`, `writer_model`, `auditor_model`, `arbiter_model`, `final_document`, `result` (jsonb — objet complet de l'analyse : versions, audits, sources, appels, arbitrage), `total_cost`, `prompt_tokens`, `completion_tokens`, `created_at`, `updated_at`. Index sur `(user_id, created_at desc)`.

Sans base configurée, aucune table n'est créée : l'authentification Google reste possible (session en mémoire), mais l'historique et le tableau de bord ne reflètent que les jobs encore présents dans la mémoire du processus (voir « Jobs et persistance »).

### Authentification

- **Mode normal** : OAuth Google. Cookie de session `httpOnly`, `secure` en production, `sameSite=lax`, durée de vie 7 jours.
- **Mode développeur** (`DEV_BYPASS_AUTH=true`) : fournit un utilisateur factice (`dev@local`) sans passer par Google, pour tester en local. Le serveur refuse de démarrer si cette variable vaut `true` alors que `NODE_ENV=production` (`server.js`, garde-fou explicite).
- Toutes les routes `/api/*` hormis `/api/me` et `/api/health` exigent une session authentifiée (`requireAuth`).

### Routes API

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/me` | Utilisateur courant et disponibilité de l'authentification Google |
| GET | `/api/health` | État de santé : version, base de données, clés API configurées |
| GET | `/auth/google` | Démarre le flux OAuth Google |
| GET | `/auth/google/callback` | Retour du flux OAuth |
| POST | `/auth/logout` | Déconnexion et destruction de session |
| POST | `/api/jobs` | Crée une analyse (multipart, jusqu'à 3 documents joints) et démarre la boucle en tâche de fond |
| GET | `/api/jobs/:id/events` | Flux Server-Sent Events de progression d'une analyse |
| GET | `/api/history` | Historique des analyses de l'utilisateur connecté |
| GET | `/api/dashboard` | Agrégats de consommation (coût, tokens, répartition par modèle) sur 90 jours |
| GET | `/api/runs/:id/export/:format` | Export d'une analyse (`md`, `pdf`, `docx`, `xlsx`) |

### Boucle d'analyse (`executeJob`)

1. Vérifie la présence d'une clé OpenRouter (variable serveur ou saisie temporaire) et la validité de la demande (20 caractères minimum ou au moins une pièce jointe).
2. Extrait le texte des documents joints (30 000 caractères maximum par fichier) et l'injecte dans la demande, précédé d'une consigne explicite empêchant le modèle d'exécuter des instructions qui s'y trouveraient (protection contre l'injection de prompt via document).
3. Classe automatiquement la tâche (`detectTask`) sauf si la sélection des modèles est manuelle.
4. Sélectionne les modèles rédacteur/auditeur/arbitre selon le type de tâche, ou retient ceux fournis par l'utilisateur (validés par une expression régulière stricte).
5. Produit une rédaction initiale avec recherche web OpenRouter.
6. Enchaîne jusqu'à `maxCycles` cycles (1 à 5) : vérification des sources citées via Firecrawl (concurrence bornée à 4, 10 sources maximum par analyse), audit JSON structuré, puis arrêt si le score atteint le seuil cible sans anomalie critique/élevée ni source essentielle non vérifiée, sinon correction complète du document et nouveau cycle.
7. Fait arbitrer la version finale par un modèle indépendant, qui ne réécrit jamais le document.
8. Enregistre le résultat en base (si configurée) et diffuse l'événement `complete`.

À chaque étape, un événement est diffusé en SSE pour alimenter le fil de suivi de l'interface.

### Diffusion temps réel (SSE)

`GET /api/jobs/:id/events` rejoue d'abord tous les événements déjà émis pour ce job, puis reste ouvert (un ping toutes les 20 secondes maintient la connexion). Types d'événements émis : `models`, `insight`, `progress`, `source`, `audit`, `complete`, `error`. Les événements `progress` et `insight` portent un champ `cycle` explicite, ce qui permet au frontend de n'afficher qu'une seule entrée par étape (d'abord « en cours », puis enrichie de son constat détaillé) plutôt que deux fils redondants.

### Jobs et persistance en mémoire

Les jobs actifs et leurs événements SSE vivent dans une `Map` en mémoire du processus (nécessaire pour le flux SSE), indépendamment de PostgreSQL. `sweepJobs()` s'exécute toutes les 10 minutes et supprime les jobs terminés depuis plus de 2 heures sans client connecté, avec une borne dure à 500 jobs conservés quel que soit leur âge. Conséquences pratiques :

- sans `DATABASE_URL`, l'historique et le dashboard ne montrent que les jobs encore présents dans cette mémoire (perdus au redémarrage) ;
- avec plusieurs instances de l'application derrière un répartiteur de charge, le client SSE doit atteindre la même instance que celle qui a créé le job (pas de file d'attente partagée).

## Sécurité et fiabilité

- **Code source direct** : `server.js` et `public/*` sont le code réellement exécuté par l'application, sans étape de génération ni de réécriture au démarrage.
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

Les clés réelles ne doivent jamais être ajoutées au dépôt.

## Fonctionnement

```text
Utilisateur authentifié
        ↓
Classification de la tâche
        ↓
Sélection des modèles
        ↓
Rédaction avec recherche Web OpenRouter
        ↓
Extraction et contrôle des URL avec Firecrawl
        ↓
Audit contradictoire structuré
        ↓
Correction complète du document
        ↓
Nouveaux cycles de contrôle
        ↓
Arbitrage final indépendant
        ↓
Historique, dashboard et exports
```

La progression est diffusée en temps réel par Server-Sent Events et affichée sous forme de fil chronologique.

## Modèles par défaut

| Type de tâche | Rédacteur | Auditeur | Arbitre |
|---|---|---|---|
| Technique | Claude Opus latest | GPT-5.6 Sol | Grok latest |
| Financier / FinOps | Claude Opus latest | GPT-5.6 Sol | Grok latest |
| Juridique / conformité | Claude Opus latest | GPT-5.6 Sol | Grok latest |
| Recherche actuelle | Claude Sonnet latest | GPT-5.6 Sol | Grok latest |
| Analyse générale | Claude Sonnet latest | GPT latest | Grok latest |

Les modèles peuvent être sélectionnés manuellement dans l’interface.

## Détection du type de tâche

- `technical` : code, bug, API, architecture, développement, script, GitHub ;
- `financial` : prix, coût, budget, FinOps, ROI, économie, facturation ;
- `legal` : contrat, droit, loi, règlement, conformité ;
- `current_research` : actualité, annonce, veille, information récente ;
- `general_analysis` : cas général.

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

Formats acceptés :

```text
fc-...
fc_...
```

La validation effectuée dans l’interface contrôle le format, pas l’authenticité de la clé. L’authenticité est vérifiée lors de l’appel API.

## Prompts utilisés

Les prompts effectifs sont définis directement dans `server.js` (`writerSystem`, `auditorSystem`, `arbiterSystem`, `taskGuidance`).

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
Tu es l'arbitre final indépendant. Tu ne réécris pas le document. Tu évalues la version finale, les audits successifs et l'état réel des sources. Réponds uniquement en JSON valide avec decision, confiance, motifs, reserves et actions_requises.

RÈGLES DE DÉCISION
- APPROUVE uniquement si toutes les affirmations déterminantes sont étayées, les calculs reproductibles et aucune anomalie critique ou élevée ne subsiste.
- APPROUVE_AVEC_RESERVES uniquement pour des limites explicitement circonscrites qui ne changent pas la conclusion principale.
- REJETE si une source essentielle est inaccessible ou contradictoire sans traitement, si un calcul déterminant est faux ou non reproductible, si le document dépasse les preuves, ou si le périmètre demandé n'est pas couvert.
- La confiance est un entier de 0 à 100 et doit refléter la qualité et l'indépendance des preuves, pas le style du document.
- Les motifs doivent citer les constats précis des audits ou des sources. Les actions requises doivent être concrètes et vérifiables.
```

### Format JSON de l’arbitrage

```json
{
  "decision": "APPROUVE|APPROUVE_AVEC_RESERVES|REJETE",
  "confiance": 0,
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

## Règles de validation

Un document ne peut être validé automatiquement que si :

- le score global atteint le seuil défini ;
- aucune anomalie critique ou élevée ne subsiste ;
- aucune source essentielle n’est non vérifiée ;
- aucun nouveau cycle n’est demandé ;
- l’arbitre rend une décision d’approbation.

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
- fil d’information chronologique avec défilement automatique ;
- sélection manuelle ou automatique des modèles.

## Historique et exports

Chaque exécution peut conserver :

- la demande ;
- le type de tâche ;
- les modèles ;
- les versions successives ;
- les audits ;
- les sources ;
- l’arbitrage ;
- les coûts et tokens ;
- le document final.

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
npm run check
```

Cette commande vérifie la syntaxe de `server.js` et de l’interface (`public/app.js`). Aucune génération de code n'a lieu au démarrage.

## Limites connues

- La classification des sources reste heuristique.
- Firecrawl ne garantit pas l’accès aux pages protégées, payantes ou bloquées.
- Les scores produits par les modèles ne constituent pas une certification.
- Les sujets sensibles doivent être revus par un professionnel qualifié.
- Les tâches SSE actives sont conservées en mémoire, avec une éviction automatique après 2 heures ou au-delà de 500 jobs conservés ; une coupure du processus interrompt une analyse en cours.
- Aucun test automatisé au-delà de la vérification de syntaxe (`npm run check`) ne couvre la logique métier (sélection des modèles, classification, tableau de bord, exports).
