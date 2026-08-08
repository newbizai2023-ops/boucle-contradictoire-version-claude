# Analyse comparée — méthodologie cible vs méthodologie implémentée

Ce document confronte la méthodologie décrite dans *Boucle Contradictoire — Méthodologie simplifiée*
(ci-après « la note ») à la méthodologie réellement mise en œuvre par l'application (`server.js`,
`lib/`). Il en dégage les forces, les faiblesses et un chemin de convergence classé par rapport
coût/bénéfice.

> **État de l'analyse.** Les sections 1 à 5 décrivent l'application **telle qu'elle était en 1.5.2**,
> au moment du diagnostic, et sont conservées en l'état : c'est ce qui rend les corrections
> lisibles. Les quatre premières actions du §6 ont été livrées en **1.6.0** — les faiblesses §4.3
> (partiellement), §4.5, §4.7 et §4.9 ne se présentent donc plus comme décrit. Voir « État au
> 1.6.0 » en fin de §6.

Les références de code renvoient au dépôt à l'état de la branche courante.

---

## 1. Thèse centrale

Les deux méthodologies poursuivent le même objectif et partagent la même intuition fondatrice : *la
preuve prime sur l'éloquence, et aucun LLM ne doit être juge final de son propre travail*. Elles
divergent sur **l'endroit où la discipline est inscrite**.

> **L'application encode la méthodologie dans ses prompts. La note veut l'encoder dans son état.**

La règle « distingue faits vérifiés, hypothèses, estimations, interprétations et recommandations »
existe déjà dans l'application — c'est la règle 1 du `writerSystem` (`server.js:336`). Mais elle y
existe sous forme de **phrase adressée à un modèle**. Dans la note, ces mêmes catégories sont des
**types d'objets** (`FACT`, `HYPOTHESIS`, `ESTIMATE`, `CALCULATION`, `INTERPRETATION`,
`RECOMMENDATION`, §3) portés par des enregistrements identifiés (`CLAIM-001`), dotés d'un statut
(`VERIFIED`) et d'une force de preuve (`E0`–`E5`).

La différence n'est pas cosmétique. Une règle inscrite dans un prompt ne peut être ni comptée, ni
vérifiée, ni utilisée comme condition d'arrêt : on ne peut qu'espérer qu'elle a été suivie. Une
règle inscrite dans l'état est mesurable et opposable. C'est exactement le saut que l'application a
déjà fait *une seule fois*, pour la condition d'arrêt (`lib/audit.js`), et que la note généralise à
toute la chaîne de preuve.

Corollaire : la note n'est pas un remplacement de l'application, c'est sa **normalisation**. La
majorité de ses exigences sont déjà présentes dans l'application, mais sous forme textuelle et donc
invérifiable.

---

## 2. Les deux pipelines côte à côte

### 2.1 Méthodologie de la note

```
EXPLORE → EVIDENCE → DIVERSIFY → DISAGREE → FALSIFY → DECIDE → EXPLAIN
```

Structure : **horizontale**. Un dossier de preuves est constitué *avant* toute rédaction, puis
plusieurs modèles l'interprètent **en parallèle et indépendamment**. Le désaccord entre eux est le
signal principal ; il déclenche une recherche ciblée. Une étape de falsification tente ensuite
d'invalider la conclusion. Une porte déterministe tranche, un arbitre statue sans réécrire.

### 2.2 Méthodologie de l'application (`executeJob`, `server.js:716`)

```
classification (regex)
   → sélection des modèles
   → rédaction initiale (web:true)
   → boucle 1..maxCycles :
        vérification des sources (Firecrawl, ≤10/analyse, concurrence 4)
        audit JSON strict (web:false)
        porte d'arrêt déterministe (shouldStopAfterAudit)
        correction intégrale du document (web:true)
   → arbitrage final (web:false)
   → statut, persistance, exports
```

Structure : **verticale**. Un rédacteur unique produit un document, qu'un auditeur unique attaque,
qu'un arbitre unique valide. La contradiction est **séquentielle et intra-document** : elle oppose
des *rôles* (rédacteur ≠ auditeur ≠ arbitre, servis par trois fournisseurs différents), non des
*interprétations concurrentes du même dossier*.

### 2.3 Correspondance étape par étape

| Étape de la note | État dans l'application | Écart |
|---|---|---|
| **EXPLORE** | Absent. Seule `detectTask()` (`lib/task.js:20`) classe la demande par regex et préfixe un `taskGuidance` de 2 lignes. | Total. Le cadrage est imposé par le premier brouillon ; toute la suite est corrective. |
| **EVIDENCE** | Partiel et **inversé**. Les URL sont extraites *du document déjà rédigé* (annotations OpenRouter + regex, `lib/sources.js`), puis contrôlées par Firecrawl. | Le dossier de preuves est un sous-produit de la prose, pas son intrant. Aucun objet claim, aucun identifiant, aucune échelle E0–E5. |
| **DIVERSIFY** | **Absent.** Un seul rédacteur. | Écart structurel le plus important. Aucune interprétation indépendante du même dossier. |
| **DISAGREE** | Forme différente : le désaccord rédacteur↔auditeur s'exprime en `anomalies` graduées (`critique\|elevee\|moyenne\|faible`). Le champ `divergences_sources` porte sur les divergences *entre sources*, pas entre modèles. | Pas de matrice de divergence, pas d'analyse de cause. La recherche ciblée existe partiellement : la correction repasse en `web:true`. |
| **FALSIFY** | Dilué dans le prompt d'auditeur (sources circulaires, faux croisements, recalcul, contradictions internes — `server.js:356-367`). | Pas d'étape dédiée, pas de déclenchement conditionnel, **et surtout auditeur en `web:false`** (voir §4.4). |
| **DECIDE** | **Implémenté, et c'est le point fort.** `shouldStopAfterAudit()` (`lib/audit.js:50`) est du code déterministe, testé, robuste aux variations d'accent et de casse. L'arbitre décide sans réécrire (`arbiterSystem`, `server.js:369`). Statuts `validated` / `validated_with_reservations` / `rejected_by_arbiter`. | Quasi nul. L'application applique déjà littéralement la règle « l'arbitre décide mais ne réécrit pas » (note §7). |
| **EXPLAIN** | Partiel. Rapport final + liste des sources contrôlées + audits par cycle + analytics + exports (md/pdf/docx/xlsx) + tables normalisées `run_sources` / `run_audits` / `run_calls` (`lib/persistence.js`). | Traçabilité au niveau **document et source**, jamais au niveau **affirmation**. Ni claim lineage, ni matrice de divergence. |
| **Pipeline adaptatif** (§10-11) | Réglages manuels : `maxCycles` ∈ [1,5], `minScore` ∈ [50,100], bascule Firecrawl. Sortie anticipée si l'audit valide. | Aucune sélection automatique de mode, aucun déclenchement conditionnel d'étapes coûteuses, **aucune détection de stagnation**. |
| **Consensus ≠ preuve** (§12) | Sans objet : il n'y a pas de consensus à mesurer (un seul rédacteur). | Le risque symétrique existe : il n'y a pas non plus de réplication indépendante. |
| **Incertitude à deux dimensions** (§13) | Une seule : `confiance` de l'arbitre (0–100), plus 6 scores d'audit. | Confiance dans les preuves et confiance dans la conclusion ne sont pas séparées. |
| **Claim lineage** (§14) | Absent. | Impossible de répondre à « quelle source soutient le paragraphe 12 ? ». |
| **Métriques** (§17) | **Largement en avance sur la note.** `buildAnalytics()` (`lib/analytics.js`) produit déjà coût, tokens, appels, durée, cycles moyens, score moyen, scores par critère, accessibilité par domaine et par classe de source. | L'application mesure déjà la moitié des métriques réclamées ; la note ne dit pas comment obtenir l'autre moitié (voir §5.6). |

---

## 3. Forces de l'application par rapport à la note

### 3.1 La vérification externe est réelle, pas déclarative

`scrapeFirecrawl()` (`server.js:454`) va **chercher la page**. Une source y est `accessible: true`,
`false` avec un motif, ou `null` si le contrôle est désactivé. C'est un contrôle déterministe au
sens strict de la note (§16.2 : « privilégier les contrôles déterministes »), et la plupart des
« evidence engines » n'en font pas autant : ils demandent à un LLM si la source est bonne.

### 3.2 La porte d'arrêt est déjà du code, pas un prompt

`shouldStopAfterAudit()` est extraite dans `lib/`, couverte par `test/audit.test.js`, et renvoie
**les motifs** de non-validation, pas un booléen. Cette décision de conception — rendre lisible
« pourquoi un cycle de plus » — est exactement l'esprit de la section EXPLAIN de la note, appliqué à
un endroit que la note elle-même n'avait pas prévu.

Détail révélateur : la normalisation NFD des gravités (`lib/audit.js:11`) existe parce que les
modèles écrivent « élevée » là où le contrat JSON demande `elevee`. C'est le genre de fragilité que
la note ne peut pas anticiper depuis le papier, et qui constitue l'essentiel du coût réel d'un
« evidence engine ».

### 3.3 L'hétérogénéité des fournisseurs traite déjà le faux consensus

Rédacteur Anthropic, auditeur OpenAI, arbitre xAI (`lib/models.js:9-15`). La note identifie le faux
consensus comme risque majeur (§16.5) sans prescrire de contre-mesure ; l'application en applique
une, par construction.

### 3.4 Le coût est maîtrisé par construction

3 appels de modèle au minimum, ~7 au maximum. Le principe directeur de la note (§18 : « le minimum
d'agents nécessaire ») est **mieux respecté par l'application que par le mode critique de la note
elle-même**, qui empile council 3-4 modèles, recherche ciblée, audits spécialisés, red team et
arbitrage.

### 3.5 Sécurité — absente de la note

L'application isole les documents joints contre l'injection de prompt (`server.js:730`), classe la
demande **sans** le texte des pièces jointes pour qu'un PDF ne puisse pas choisir le modèle qui le
traitera (`server.js:733-739`), et impose une liste blanche de modèles côté serveur parce que
`OPENROUTER_API_KEY` du déploiement prime sur celle de l'utilisateur (`lib/models.js:34-40`).

La note ne mentionne la sécurité nulle part — et sa conception **augmente** l'exposition : plus de
scraping, plus d'extraits de pages injectés dans les prompts de raisonnement. Voir §5.5.

### 3.6 Elle existe

La note est une spécification. L'application tourne, persiste, exporte, diffuse en SSE et facture.
L'écart de maturité est à porter au crédit de l'application dans toute décision d'évolution : il
s'agit d'enrichir un système en production, pas de le réécrire.

---

## 4. Faiblesses de l'application au regard de la note

Classées par gravité décroissante.

### 4.1 La preuve est en aval de la prose (biais de confirmation structurel)

Le rédacteur écrit d'abord ; les URL sont ensuite **extraites de ce qu'il a écrit**
(`verifySources()`, `server.js:498`). Le dossier de preuves ne peut donc, par construction, que
confirmer le périmètre déjà choisi par le rédacteur. Une source qui aurait contredit le cadrage
initial n'a aucune chance d'entrer dans le dossier : personne ne la cherche.

C'est l'inversion exacte de la note, où `EVIDENCE` précède toute interprétation.

Conséquence annexe : **accessible ≠ probant**. Firecrawl établit qu'une page répond, pas qu'elle
soutient l'affirmation. Le seul contrôle du lien affirmation↔preuve est l'auditeur LLM lisant un
extrait tronqué à 2 400 caractères (`server.js:526`) d'un contenu lui-même tronqué à 12 000
(`FIRECRAWL_EXCERPT_CHARS`). Une affirmation étayée au milieu d'une page longue est indiscernable
d'une affirmation inventée.

### 4.2 Aucune interprétation indépendante (DIVERSIFY absent)

Toutes les versions successives descendent d'un unique premier brouillon. La boucle corrige les
défauts *de cette interprétation-là* ; elle ne peut pas révéler qu'une autre lecture du même dossier
était possible. Le biais d'ancrage que la note traite en §15.4 n'est traité nulle part dans
l'application.

C'est l'écart structurel majeur, et le seul qui exige des appels de modèle supplémentaires.

### 4.3 Une porte déterministe alimentée par des nombres probabilistes

`score_global >= minScore` (défaut 90) est une comparaison rigoureuse — sur un entier **inventé par
un LLM**. La forme est déterministe, l'intrant ne l'est pas. C'est la faiblesse §16.2 de la note
poussée à son maximum : le score, et non la preuve, pilote la boucle.

Aggravation concrète : la condition d'arrêt lit `audit.sources_non_verifiees`, une liste **produite
par le modèle**, alors que l'application dispose de la mesure réelle —
`result.sources.filter(s => s.accessible === false)`. La vérité terrain Firecrawl n'entre jamais
dans `shouldStopAfterAudit()`, qui ne reçoit que l'objet d'audit (`lib/audit.js:50`). L'application
mesure la bonne chose et ne s'en sert pas pour décider.

### 4.4 L'auditeur ne peut pas trouver de source contradictoire

L'audit s'exécute en `web:false` (`server.js:801`), choix délibéré et défendable (coût, ancrage). Il
a une conséquence méthodologique lourde : **l'application peut constater une absence de preuve, mais
jamais l'existence d'une preuve contraire.** Le `FALSIFY` de la note exige explicitement la
recherche de sources contradictoires ; l'application ne dispose d'aucun chemin pour cela. La
contradiction y est intra-document, pas confrontée au monde.

C'est le point où la note apporte le plus de valeur ajoutée réelle.

### 4.5 Budget de sources saturé dès le premier cycle

`pending = fresh.slice(0, Math.max(0, MAX_SOURCES_PER_RUN - cache.size))` (`server.js:504`), avec
`MAX_SOURCES_PER_RUN = 10` pour l'**analyse entière**. Le cache étant partagé entre cycles, dès que
10 URL ont été contrôlées au cycle 1, les URL **nouvellement citées par une correction** ne sont ni
vérifiées, ni même remontées dans `result.sources` (qui vaut `[...cache.values()]`, `server.js:522`).

Le document final peut donc citer des sources que personne n'a contrôlées et qui n'apparaissent pas
dans le dossier présenté à l'auditeur ni à l'arbitre. Le commentaire de code assume le budget par
analyse ; l'effet de bord sur les sources *ajoutées en cours de route* ne semble pas intentionnel.

### 4.6 La correction réécrit tout, sans contrôle de régression

`Corrige intégralement le document` (`server.js:826`), en `web:true`. Rien ne garantit qu'un passage
déjà vérifié survit intact au cycle suivant. Les versions sont conservées (`result.versions`) mais
jamais comparées, et sans identifiants d'affirmation il n'existe aucun moyen de détecter qu'un fait
`VERIFIED` du cycle 1 a été altéré au cycle 2. La note traite ce risque par le claim lineage (§14) ;
l'application n'a aucune contre-mesure.

### 4.7 Pas de détection de stagnation

La note prescrit `SI aucune amélioration entre deux cycles → STOP : STAGNATION` (§11). L'application
consomme `maxCycles` intégralement, même si le score plafonne à 72 aux trois cycles. Coût dépensé
sans gain de preuve — exactement ce que le principe directeur §18 interdit.

### 4.8 Traçabilité au niveau document, pas au niveau affirmation

Les tables `run_sources`, `run_audits`, `run_calls` rendent requêtable *l'exécution*. Aucune ne rend
requêtable *une affirmation*. Ni analyse d'impact, ni réponse à « sur quoi repose cette
recommandation ».

### 4.9 Une seule dimension d'incertitude

L'arbitre rend une `confiance` unique. Le cas que la note isole justement — base factuelle solide
(`Evidence confidence : HIGH`) mais recommandation dépendante d'hypothèses métier
(`Recommendation confidence : MEDIUM`, §13) — est inexprimable dans le format de sortie actuel.

### 4.10 Cadrage par regex

`detectTask()` teste 25 mots-clés. Une demande mêlant coût et conformité tombe dans `financial` et
perd le cadrage juridique. Le `taskGuidance` correspondant est un texte de deux lignes : c'est tout
ce qui tient lieu d'`EXPLORE`.

---

## 5. Faiblesses de la note elle-même

La note s'auto-critique en §16 (complexité, evidence engine probabiliste, coût, latence, faux
consensus). Ces points sont justes. Les suivants ne sont pas couverts et pèsent sur toute tentative
d'implémentation.

### 5.1 L'échelle E0–E5 n'a pas de procédure d'attribution

`E4 — plusieurs sources indépendantes convergentes` suppose de savoir décider de l'indépendance de
deux sources. C'est précisément le jugement que la note identifie ailleurs comme peu fiable (sources
circulaires, reprise d'une même dépêche). Sans test déterministe — propriétaire du domaine, DOI,
détection de syndication — `E4` est une opinion de LLM habillée en nombre, et l'échelle donne à la
chaîne une apparence de rigueur qu'elle n'a pas.

L'application est ici plus honnête : sa `sourceClass()` (`lib/sources.js:34`) est une heuristique
d'URL grossière, mais elle est **déterministe et assumée comme telle** dans les limites connues du
README.

### 5.2 L'extraction des claims est elle-même probabiliste — et échoue en silence

« Le LLM aide à trouver, structurer et interpréter les preuves. Il ne constitue jamais lui-même la
preuve » (§3). Mais c'est bien un LLM qui **décide de ce qui devient un claim**. Une affirmation
importante non extraite n'est jamais vérifiée, n'apparaît dans aucun lineage, et ne déclenche aucune
alerte : elle est invisible pour toutes les portes de contrôle en aval. C'est un mode de défaillance
silencieux, plus dangereux qu'un claim mal noté, et absent du §16.

### 5.3 Le pack de preuves partagé corrèle les erreurs

La règle « les candidats doivent recevoir le même Evidence Pack initial » (§4) isole bien la
divergence de raisonnement de la divergence de recherche. Mais elle fait aussi **partager à tous les
candidats les angles morts du pack**. Trois modèles nourris du même dossier incomplet convergeront —
et cette convergence sera comptée comme consensus. Le §12 met en garde contre le faux consensus
pendant que le §4 en maximise mécaniquement la probabilité. La tension n'est pas résolue.

### 5.4 Les seuils de déclenchement ne sont pas chiffrés

`SI divergence forte → recherche ciblée` : forte à partir de quoi ? Sans seuils, le pipeline
adaptatif (§10-11) n'est pas implémentable tel quel, et le mode critique — facilement 20 à 40 appels
de modèle — entre en contradiction directe avec le principe directeur §18. La note ne fournit aucune
estimation de coût ou de latence par mode, alors que ces deux grandeurs sont le dénominateur de sa
propre métrique finale.

### 5.5 Aucune considération de sécurité

Le moteur de preuves ingère du contenu de pages scrapées dans les prompts de raisonnement. C'est un
vecteur d'injection indirecte de bout en bout, et la note l'amplifie par rapport à l'application
(double sourcing, extraits plus nombreux, recherche ciblée récursive). L'application traite ce
risque pour les pièces jointes ; il faudra le traiter pour les sources externes, et la note n'en dit
rien.

### 5.6 Des métriques non mesurables sans corpus de référence

`nombre de faux consensus`, `critical_errors_before / after`, `coverage_before / after` (§17)
supposent une vérité terrain — un jeu de questions annoté. Sans ce corpus, ces indicateurs ne sont
pas calculables, et la métrique directrice du §18 (« amélioration de la preuve / coût + latence +
complexité ») n'a pas de numérateur.

### 5.7 Pas de péremption du dossier de preuves

La note insiste lourdement sur les dates (publication, événement, entrée en vigueur) mais ne dit rien
de la durée de validité d'un claim `VERIFIED`, ni de la revalidation d'un Evidence Pack réutilisé.

---

## 6. Chemin de convergence recommandé

Classé par rapport bénéfice/coût. Les étapes 1 à 4 ne coûtent **aucun appel de modèle
supplémentaire** — elles sont **livrées en 1.6.0**.

| # | Action | Coût | Bénéfice | Traite | État |
|---|---|---|---|---|---|
| 1 | Faire entrer la vérité terrain Firecrawl dans la porte d'arrêt : passer `result.sources` à `shouldStopAfterAudit()` et bloquer sur `accessible === false` pour les sources citées, au lieu de se fier au seul champ `sources_non_verifiees` produit par le modèle. | Nul (code) | Élevé | §4.3 | ✅ 1.6.0 |
| 2 | Arrêt sur stagnation : comparer `score_global` et le nombre d'anomalies sévères entre cycles ; sortir avec `stopReason = "STAGNATION"` si aucun des deux ne progresse. | Nul (code, économise des appels) | Élevé | §4.7 | ✅ 1.6.0 |
| 3 | Réserver un quota de vérification par cycle plutôt qu'un budget global saturable, pour que les sources ajoutées par une correction soient contrôlées et remontées. | Nul (code) | Moyen-élevé | §4.5 | ✅ 1.6.0 |
| 4 | Deux confiances distinctes dans le JSON d'arbitrage : `confiance_preuves` et `confiance_conclusion`. | Nul (un champ de plus dans un appel existant) | Moyen | §4.9 | ✅ 1.6.0 |
| 5 | Étape `EXPLORE` : un appel court avant la rédaction produisant perspectives et questions de recherche, préfixé au `writerPrompt`. | +1 appel court | Élevé | §4.1, §4.10 | à faire |
| 6 | Passe d'extraction de claims après le brouillon : table `run_claims` (id, type, statut, sources liées) sur le modèle de `lib/persistence.js`, et porte « aucun claim critique non vérifié ». | +1 appel, + schéma | Élevé | §4.1, §4.8, §4.6 | à faire |
| 7 | `FALSIFY` conditionnel : un appel adversarial en `web:true` cherchant explicitement des sources contradictoires, déclenché si anomalies sévères persistantes ou score élevé avec peu de sources primaires accessibles. | +0 à 1 appel | Élevé | §4.4 | à faire |
| 8 | `DIVERSIFY` conditionnel : second rédacteur sur le même dossier, puis matrice de divergence, réservé aux domaines à risque (`legal`, `financial`) ou aux analyses dont le cycle 1 est faible. | +1 à 2 appels | Élevé mais coûteux | §4.2 | à faire |

Enveloppe résultante : mode standard inchangé à ~5 appels, mode critique à ~10. À comparer aux 20-40
appels du mode critique de la note — et le principe §18 reste respecté.

Deux exigences de la note sont à écarter en l'état, faute de procédure fiable : l'échelle E0–E5
telle que définie (§5.1) et les métriques d'amélioration sans corpus de référence (§5.6).

### État au 1.6.0

Les actions 1 à 4 sont implémentées. Les faiblesses §4.3 (porte déterministe alimentée par des
nombres probabilistes), §4.5 (budget de sources saturé), §4.7 (pas de détection de stagnation) et
§4.9 (une seule dimension d'incertitude) sont traitées ; elles restent décrites ci-dessus telles
qu'elles se présentaient avant correction, parce que c'est ce qui rend la correction lisible.

§4.3 n'est traitée qu'à moitié, et volontairement : le score reste un nombre inventé par un modèle.
Ce qui change, c'est que la porte ne s'en remet plus **uniquement** à lui — une mesure opposable
(l'accessibilité réelle d'une source citée) peut désormais refuser une validation que le score
accordait. Les faiblesses structurelles §4.1, §4.2, §4.4, §4.6 et §4.8 demeurent entières : elles
exigent les actions 5 à 8.

---

## 7. Synthèse

**Force de la note :** elle sort la discipline méthodologique du prompt pour la mettre dans l'état du
système. C'est la seule voie vers une chaîne réellement auditable, et elle identifie trois manques
structurels réels de l'application — pas de cadrage amont, pas d'interprétation indépendante, pas de
recherche de réfutation.

**Faiblesse de la note :** elle décrit la structure sans les procédures qui la rendent fiable
(attribution des forces de preuve, seuils de déclenchement, sécurité, mesure), et son mode critique
contredit son propre principe d'économie.

**Force de l'application :** elle est en production, sa porte de décision est déjà déterministe et
testée, sa vérification de sources est réelle et non déclarative, son hétérogénéité de fournisseurs
traite le faux consensus, et sa discipline de sécurité dépasse celle de la note.

**Faiblesse de l'application :** son dossier de preuves est un sous-produit du texte qu'il est censé
valider, sa contradiction est séquentielle plutôt qu'indépendante, sa porte déterministe consomme des
scores inventés alors qu'elle dispose de mesures réelles inutilisées, et sa traçabilité s'arrête au
document.

Les quatre premières actions du §6 corrigent des défauts réels **sans un seul appel de modèle
supplémentaire**. C'est par là qu'il faut commencer.
