# Boucle Contradictoire (version corrigée)

Application web Node.js qui orchestre une analyse multi-modèles avec recherche Web, contrôle des sources, corrections successives, arbitrage indépendant, historique PostgreSQL, exports et tableau de bord de consommation.

**Version actuelle : 3.0.0**

## À propos de cette version

Ce dépôt est un fork corrigé de [`newbizai2023-ops/Boucle-Contradictoire`](https://github.com/newbizai2023-ops/Boucle-Contradictoire), à la suite d'une revue de code. Le fonctionnement applicatif est inchangé ; les corrections suivantes ont été appliquées :

1. **Suppression de la chaîne de 15 scripts de correctifs.** L'ancien dépôt reconstruisait `server.js` et `public/*` à chaque démarrage (`npm run prepare:runtime`) via 15 scripts appliquant des remplacements de texte successifs sur les fichiers commités. Le code livré ici est directement le code source réel — plus de génération au démarrage, plus de working tree modifié par un simple `npm start`.
2. **Correction de la fuite mémoire des jobs.** Le `Map` des tâches en mémoire n'était jamais purgé ; une éviction périodique (`sweepJobs`) borne désormais la durée de rétention et le nombre maximal de jobs conservés.
3. **Vérification TLS Postgres activée par défaut** en production (au lieu de `rejectUnauthorized:false`), avec une option `DATABASE_CA_CERT` pour une autorité privée.
4. **Garde-fou `DEV_BYPASS_AUTH`** : le serveur refuse de démarrer si ce contournement d'authentification est combiné à `NODE_ENV=production`.
5. **Vérification des sources parallélisée** (au lieu d'un traitement séquentiel), avec une concurrence bornée, pour réduire la latence perçue lors des cycles d'audit.
6. **En-têtes de sécurité (`helmet`) et limitation de débit (`express-rate-limit`)** ajoutés, notamment sur la création d'analyses (`POST /api/jobs`), pour limiter les abus et l'emballement des coûts.
7. **Dockerfile corrigé** : la préparation du code s'effectue au build (elle n'existe plus, le code étant déjà final), plus au démarrage du conteneur ; ajout d'un `.dockerignore` et d'un `package-lock.json` commité pour des builds reproductibles (`npm ci`).
8. **Modèles par défaut réalignés sur la documentation** : le rédacteur utilise à nouveau Claude Opus pour les domaines technique/financier/juridique, comme indiqué dans le tableau ci-dessous (un script de test avait silencieusement basculé ces domaines vers Sonnet dans le dépôt d'origine).

### Corrections d'ergonomie (interface)

À la suite d'une revue ergonomique de l'interface (`public/*`) :

- Contraste du bouton principal « Lancer la boucle » remonté au-dessus du seuil WCAG AA (le dégradé d'origine tombait à ~3.7:1 avec le texte blanc).
- Badge « Non configurée » d'OpenRouter distingué de celui de Firecrawl (rouge/bloquant vs ambre/optionnel) : sans clé OpenRouter aucune analyse n'est possible, alors que Firecrawl n'est qu'une amélioration.
- Ajout d'un bloc « Comment ça marche » visible avant connexion, et réduction de la hauteur excessive du panneau de résultats vide.
- Les sélecteurs de modèles (Rédacteur/Auditeur/Arbitre) sont masqués entièrement en mode automatique, au lieu d'être grisés tout en occupant de l'espace.
- Distinction claire entre le fil « Étapes » (progression courte) et les « Constats détaillés » (explications complètes), pour réduire la sensation de doublon.
- Ajout de textes d'aide sous « Cycles maximum » / « Score cible » et d'une indication de durée typique près du bouton d'envoi.
- Fusion des media queries dupliquées (950px/1200px) en un seul point de bascule responsive.
- Libellés de modèles raccourcis pour éviter la troncature dans les listes déroulantes sur mobile.
- Indice visuel de défilement sur la barre d'onglets quand elle déborde (mobile).
- Focus clavier harmonisé sur les boutons et onglets (même anneau que les champs de formulaire).
- Thème clair ajouté, activé automatiquement selon la préférence système (`prefers-color-scheme`), sans bascule manuelle.
- Lien rapide « Historique ↓ » dans l'en-tête pour un accès direct sans défiler toute la page.

## Déploiement

- Dépôt : `newbizai2023-ops/boucle-contradictoire-version-claude`
- Branche : `main`
- Runtime : Node.js 20+
- Base : PostgreSQL

Ce fork n'est pas déployé sur une instance Render dédiée ; adapter `render.yaml` (nom de service, région) avant tout déploiement séparé de l'application d'origine.

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
