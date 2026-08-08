// DIVERSIFY — faire interpréter le même sujet par un second rédacteur indépendant.
//
// La contradiction de l'application oppose des *rôles* — rédacteur, auditeur, arbitre — jamais des
// *lectures concurrentes*. Toutes les versions d'un document descendent d'un unique premier
// brouillon : la boucle corrige les défauts de cette lecture-là, elle ne peut structurellement pas
// révéler qu'une autre lecture des mêmes faits menait ailleurs. L'auditeur ne le voit pas non plus,
// puisqu'il ne juge que le document qu'on lui présente.
//
// Un second rédacteur, servi par un autre éditeur, traite la même demande sans voir le premier
// document. Leurs désaccords ne sont pas départagés par un vote : ils deviennent des questions à
// trancher, transmises à la correction et à l'arbitrage. C'est le désaccord comme moteur de
// recherche, pas comme problème de majorité.
//
// L'étape est coûteuse — un document complet avec recherche, plus son analyse. Elle est donc
// conditionnelle : automatique là où une erreur se paie cher, activable à la demande ailleurs.

/** Domaines où un second avis est automatique : une erreur juridique ou financière ne se rattrape
 *  pas au même prix qu'une imprécision rédactionnelle. */
export const DIVERGENCE_AUTO_TASKS = new Set(["legal", "financial"]);

/** Le choix de l'utilisateur prime toujours sur le déclenchement automatique, dans les deux sens :
 *  on peut réclamer un second avis sur une analyse générale, comme y renoncer sur un sujet
 *  juridique dont on connaît déjà la réponse. */
export function shouldDiversify({ task, requested } = {}) {
  if (requested === true) return { run: true, motif: "second avis demandé explicitement" };
  if (requested === false) return { run: false, motif: "second avis désactivé par l'utilisateur" };
  if (DIVERGENCE_AUTO_TASKS.has(task)) return { run: true, motif: `domaine à enjeu (${task}) : second avis automatique` };
  return { run: false, motif: "domaine sans déclenchement automatique" };
}

export const divergenceSystem = `Tu compares deux analyses indépendantes d'une même demande, produites par deux modèles différents qui ne se sont pas vus. Tu ne choisis pas un gagnant. Réponds uniquement en JSON valide.

MISSION
- Établis ce sur quoi les deux analyses s'accordent, et ce sur quoi elles divergent.
- Pour chaque désaccord, identifie sa CAUSE réelle. Deux analyses divergent rarement au hasard : elles ne retiennent pas les mêmes hypothèses, les mêmes sources, le même périmètre, le même horizon temporel, les mêmes critères de décision, ou l'une commet une erreur de calcul.
- Formule pour chaque désaccord la question qui permettrait de le trancher par une recherche ou un calcul, pas par un avis.

RÈGLES
- Un accord entre deux modèles n'est pas une preuve : deux analyses peuvent converger en reproduisant la même erreur ou la même source. Signale explicitement les accords qui ne reposent sur aucune source vérifiable — ce sont les plus dangereux, parce qu'ils inspirent confiance.
- Ne fusionne pas artificiellement deux positions incompatibles en une synthèse tiède.
- Ignore les différences de style, de plan et de longueur : seules comptent les divergences de fond.`;

export function divergencePrompt(request, documentA, documentB) {
  return `DEMANDE INITIALE :
${request}

ANALYSE A :
${documentA}

ANALYSE B :
${documentB}

Retourne ce JSON strict : {"accords":[{"sujet":"","etaye":true}],"desaccords":[{"sujet":"","position_a":"","position_b":"","cause":"hypothese|source|perimetre|horizon|calcul|critere|autre","question_a_trancher":""}],"incertitudes":[""]}. Huit désaccords au maximum, les plus déterminants pour la conclusion.`;
}

const CAUSES = ["hypothese", "source", "perimetre", "horizon", "calcul", "critere", "autre"];
const texte = value => String(value ?? "").trim();

export function normalizeDivergence(divergence) {
  if (!divergence || typeof divergence !== "object") return null;
  const tableau = value => (Array.isArray(value) ? value : []);

  const accords = tableau(divergence.accords)
    .slice(0, 12)
    .map(accord => ({ sujet: texte(accord?.sujet), etaye: accord?.etaye === true }))
    .filter(accord => accord.sujet);

  const desaccords = tableau(divergence.desaccords)
    .slice(0, 8)
    .map(desaccord => ({
      sujet: texte(desaccord?.sujet),
      position_a: texte(desaccord?.position_a),
      position_b: texte(desaccord?.position_b),
      cause: CAUSES.includes(texte(desaccord?.cause).toLowerCase()) ? texte(desaccord.cause).toLowerCase() : "autre",
      question_a_trancher: texte(desaccord?.question_a_trancher)
    }))
    .filter(desaccord => desaccord.sujet);

  const incertitudes = tableau(divergence.incertitudes).map(texte).filter(Boolean).slice(0, 8);
  if (!accords.length && !desaccords.length) return null;

  return {
    accords,
    desaccords,
    incertitudes,
    // Un accord sans étayage est un consensus non étayé : deux modèles d'accord et aucune source.
    // Le décompte est calculé ici plutôt que demandé au modèle — c'est une propriété de sa réponse,
    // pas une appréciation.
    accordsNonEtayes: accords.filter(accord => !accord.etaye).length
  };
}

/** Bloc transmis au rédacteur lors de la correction, puis à l'arbitre : les désaccords y sont
 *  présentés comme des questions ouvertes à instruire, jamais comme un verdict. */
export function divergenceBrief(divergence) {
  if (!divergence) return "";
  const sections = [];

  if (divergence.desaccords.length) {
    const lignes = divergence.desaccords
      .map(desaccord =>
        `  • ${desaccord.sujet} [cause : ${desaccord.cause}]\n` +
        `    A : ${desaccord.position_a}\n` +
        `    B : ${desaccord.position_b}\n` +
        `    À trancher : ${desaccord.question_a_trancher}`
      )
      .join("\n");
    sections.push(`DÉSACCORDS AVEC UNE ANALYSE INDÉPENDANTE — instruis chacun par une recherche ou un calcul, ou expose explicitement pourquoi il reste ouvert :\n${lignes}`);
  }

  if (divergence.accordsNonEtayes) {
    const lignes = divergence.accords.filter(accord => !accord.etaye).map(accord => `  • ${accord.sujet}`).join("\n");
    sections.push(`ACCORDS NON ÉTAYÉS — les deux analyses concordent sans source vérifiable. Un accord n'est pas une preuve : étaye-les ou signale-les comme incertains :\n${lignes}`);
  }

  if (divergence.incertitudes.length) {
    sections.push(`INCERTITUDES PARTAGÉES :\n${divergence.incertitudes.map(incertitude => `  • ${incertitude}`).join("\n")}`);
  }

  return sections.join("\n\n");
}

export function divergenceSummary(divergence) {
  if (!divergence) return "Comparaison des deux analyses non concluante.";
  return `Second avis : ${divergence.accords.length} accord(s) dont ${divergence.accordsNonEtayes} non étayé(s), ` +
    `${divergence.desaccords.length} désaccord(s) de fond.`;
}
