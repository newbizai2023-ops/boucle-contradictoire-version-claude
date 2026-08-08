// EXPLORE — cadrage de la demande avant toute rédaction.
//
// Sans cette étape, le périmètre de l'analyse est celui que le premier brouillon retient : le
// rédacteur choisit implicitement les dimensions du problème, et les cycles suivants ne font que
// perfectionner ce choix. Une question mal cadrée le reste, sans que rien ne le signale.
//
// L'étape produit des *questions*, pas des réponses. Elle ne coûte qu'un appel court, sans
// recherche web : énumérer les angles d'un problème ne demande pas de sources, seulement de ne pas
// s'arrêter au premier.

export const explorerSystem = `Tu cadres une demande d'analyse avant sa rédaction. Tu ne réponds pas à la question posée : tu délimites ce qu'il faudrait examiner pour y répondre sérieusement. Réponds uniquement en JSON valide.

RÈGLES DE CADRAGE
- Identifie les dimensions réellement en jeu, y compris celles que la formulation de la demande passe sous silence.
- Pour chaque dimension, formule des questions de recherche précises, vérifiables et distinctes les unes des autres. Une question à laquelle on peut répondre par oui ou non sans source n'est pas une question de recherche.
- Signale les angles morts : ce que la demande présuppose, ce qu'elle exclut sans le dire, les populations ou périmètres qu'elle oublie.
- Signale les éléments de périmètre que seul le demandeur peut trancher (juridiction, horizon, population, devise, unité de comparaison).
- N'invente aucun fait, aucun chiffre et aucune source : à ce stade tu ne sais rien, tu listes ce qu'il faudra établir.
- Six dimensions au maximum, trois questions au maximum par dimension. Un cadrage exhaustif est un cadrage inutilisable.`;

export function explorePrompt(task, request, guidance) {
  return `TYPE DE TÂCHE :
${task}

EXIGENCES SPÉCIFIQUES :
${guidance}

DEMANDE À CADRER :
${request}

Retourne ce JSON strict : {"dimensions":[{"axe":"","enjeu":"","questions":[""]}],"angles_morts":[""],"perimetre_a_preciser":[""]}. Six dimensions au maximum, trois questions au maximum par dimension.`;
}

const texte = value => String(value ?? "").trim();

/** Ramène le cadrage à une forme sûre et bornée : un modèle peut renvoyer des champs manquants,
 *  des chaînes là où des tableaux sont attendus, ou une liste de cinquante dimensions. */
export function normalizeExploration(exploration) {
  if (!exploration || typeof exploration !== "object") return null;
  const liste = value => (Array.isArray(value) ? value : []).map(texte).filter(Boolean);

  const dimensions = (Array.isArray(exploration.dimensions) ? exploration.dimensions : [])
    .slice(0, 6)
    .map(dimension => ({
      axe: texte(dimension?.axe),
      enjeu: texte(dimension?.enjeu),
      questions: liste(dimension?.questions).slice(0, 3)
    }))
    .filter(dimension => dimension.axe || dimension.questions.length);

  const normalisee = {
    dimensions,
    angles_morts: liste(exploration.angles_morts).slice(0, 6),
    perimetre_a_preciser: liste(exploration.perimetre_a_preciser).slice(0, 6)
  };
  // Un cadrage sans la moindre dimension n'apporte rien au rédacteur : autant ne rien lui imposer.
  return dimensions.length ? normalisee : null;
}

/** Bloc de cadrage préfixé à la demande du rédacteur.
 *
 *  Formulé comme une contrainte de couverture, pas comme un plan à suivre : le rédacteur doit
 *  traiter ces dimensions ou justifier de les écarter, pas les recopier en titres. */
export function exploreBrief(exploration) {
  if (!exploration) return "";
  const dimensions = exploration.dimensions
    .map(dimension => {
      const questions = dimension.questions.map(question => `    - ${question}`).join("\n");
      return `  • ${dimension.axe}${dimension.enjeu ? ` — ${dimension.enjeu}` : ""}${questions ? `\n${questions}` : ""}`;
    })
    .join("\n");

  const sections = [`CADRAGE PRÉALABLE — dimensions à couvrir ou à écarter explicitement :\n${dimensions}`];
  if (exploration.angles_morts.length) {
    sections.push(`ANGLES MORTS SIGNALÉS — traite-les ou explique pourquoi ils ne s'appliquent pas :\n${exploration.angles_morts.map(angle => `  • ${angle}`).join("\n")}`);
  }
  if (exploration.perimetre_a_preciser.length) {
    sections.push(`PÉRIMÈTRE NON TRANCHÉ PAR LA DEMANDE — retiens une hypothèse et affiche-la comme telle :\n${exploration.perimetre_a_preciser.map(element => `  • ${element}`).join("\n")}`);
  }
  return `${sections.join("\n\n")}\n\nCe cadrage a été produit avant toute recherche : il délimite le travail, il ne préjuge d'aucune conclusion.`;
}

/** Décompte lisible pour le fil de suivi. */
export function exploreSummary(exploration) {
  if (!exploration) return "Cadrage préalable indisponible : le rédacteur travaille sur la demande seule.";
  const questions = exploration.dimensions.reduce((total, dimension) => total + dimension.questions.length, 0);
  return `Cadrage : ${exploration.dimensions.length} dimension(s), ${questions} question(s) de recherche, ${exploration.angles_morts.length} angle(s) mort(s) signalé(s).`;
}
