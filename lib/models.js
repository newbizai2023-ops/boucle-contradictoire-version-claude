// Choix des modèles OpenRouter : valeurs par défaut par domaine, libellés lisibles et validation
// des sélections manuelles.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

// Correspond au tableau documenté dans le README : Opus pour les domaines à haut risque
// (technique, financier, juridique), Sonnet pour l'actualité et l'analyse générale.
// `challenger` sert le second avis indépendant : il doit différer du rédacteur, sinon la « seconde
// lecture » n'en est pas une. Il diffère aussi de l'arbitre — un arbitre qui a co-rédigé ne peut
// plus juger.
//
// `falsifier` mène la recherche adversariale. Il était confié à l'arbitre en 1.7.0, ce qui revenait
// à lui faire chercher les contradictions puis juger ses propres contradictions : l'indépendance de
// l'arbitrage s'en trouvait entamée, sur l'élément de preuve le plus lourd du dispositif. Il doit
// donc différer de l'arbitre et du rédacteur.
//
// Depuis le retrait de Kimi (1.11.3), la réfutation revient à Gemini Flash. Les quatre éditeurs
// représentés — Anthropic pour la rédaction, OpenAI pour l'audit et le second avis, x-ai pour
// l'arbitrage, Google pour la réfutation — rendent l'indépendance effective au niveau de l'éditeur
// et plus seulement à celui du modèle, ce qui manquait tant que la liste blanche ne comptait que
// trois fournisseurs.
//
// Contrepartie assumée : Gemini Flash est un modèle léger, là où la réfutation est l'étape la plus
// exigeante du dispositif. C'est le seul candidat dont on ait constaté le bon fonctionnement dans
// les journaux du service ; à revoir si ses réfutations se révèlent pauvres.
export const MODEL_DEFAULTS = {
  technical: { writer: "~anthropic/claude-opus-latest", auditor: "openai/gpt-5.6-sol", arbiter: "~x-ai/grok-latest", challenger: "~openai/gpt-latest", falsifier: "~google/gemini-flash-latest" },
  financial: { writer: "~anthropic/claude-opus-latest", auditor: "openai/gpt-5.6-sol", arbiter: "~x-ai/grok-latest", challenger: "~openai/gpt-latest", falsifier: "~google/gemini-flash-latest" },
  legal: { writer: "~anthropic/claude-opus-latest", auditor: "openai/gpt-5.6-sol", arbiter: "~x-ai/grok-latest", challenger: "~openai/gpt-latest", falsifier: "~google/gemini-flash-latest" },
  current_research: { writer: "~anthropic/claude-sonnet-latest", auditor: "openai/gpt-5.6-sol", arbiter: "~x-ai/grok-latest", challenger: "~openai/gpt-latest", falsifier: "~google/gemini-flash-latest" },
  general_analysis: { writer: "~anthropic/claude-sonnet-latest", auditor: "~openai/gpt-latest", arbiter: "~x-ai/grok-latest", challenger: "openai/gpt-5.6-terra", falsifier: "~google/gemini-flash-latest" }
};

// Libellés lisibles pour les identifiants de modèle OpenRouter, alignés sur les options du
// sélecteur (public/index.html). Sert à ce que les messages affichés côté client (fil de suivi)
// citent le modèle réellement utilisé, y compris en sélection manuelle, plutôt qu'un texte figé.
export const MODEL_LABELS = {
  "~anthropic/claude-opus-latest": "Claude Opus",
  "~anthropic/claude-sonnet-latest": "Claude Sonnet",
  "openai/gpt-5.6-sol": "GPT-5.6 Sol",
  "openai/gpt-5.6-terra": "GPT-5.6 Terra",
  "~openai/gpt-latest": "GPT",
  "~x-ai/grok-latest": "Grok",
  "~google/gemini-flash-latest": "Gemini Flash",
  "~deepseek/deepseek-v4-flash-latest": "DeepSeek V4 Flash",
  "~anthropic/claude-haiku-latest": "Claude Haiku"
};

// Modèles retirés du choix, mais encore cités par les analyses déjà enregistrées. Les libellés
// restent connus pour que l'historique se relise : le retrait vaut pour l'avenir, il ne réécrit pas
// ce qui a réellement tourné. Volontairement tenus à l'écart de MODEL_LABELS, dont ALLOWED_MODELS
// est dérivée — les y laisser les rendrait de nouveau sélectionnables.
export const RETIRED_MODEL_LABELS = {
  "~moonshotai/kimi-latest": "Kimi (retiré)"
};

export function modelLabel(id) {
  return MODEL_LABELS[id] || RETIRED_MODEL_LABELS[id] || String(id || "").replace(/^~/, "");
}

// Liste blanche des modèles acceptés en sélection manuelle. Valider uniquement le *format* de
// l'identifiant ne suffisait pas : OPENROUTER_API_KEY (clé du déploiement) prime sur la clé
// fournie par l'utilisateur, donc n'importe quel compte authentifié pouvait faire facturer au
// déploiement le modèle de son choix, aussi coûteux soit-il. Le <select> de l'interface n'est
// pas une protection — la contrainte doit être appliquée côté serveur. La liste est dérivée de
// MODEL_LABELS, qui reflète déjà les options proposées par l'interface.
export const ALLOWED_MODELS = new Set(Object.keys(MODEL_LABELS));

export function validateModel(value, label) {
  if (typeof value !== "string" || !ALLOWED_MODELS.has(value)) throw new Error(`${label} invalide ou non autorisé.`);
  return value;
}

// Candidats de repli, du plus au moins souhaitable. Aucun n'est le rédacteur par défaut d'un
// domaine : ces listes servent précisément à sortir d'une collision.
const CHALLENGER_FALLBACKS = ["~openai/gpt-latest", "openai/gpt-5.6-terra", "openai/gpt-5.6-sol", "~google/gemini-flash-latest"];
const FALSIFIER_FALLBACKS = ["~google/gemini-flash-latest", "~deepseek/deepseek-v4-flash-latest", "openai/gpt-5.6-terra", "~openai/gpt-latest", "openai/gpt-5.6-sol"];

/** Retient le premier candidat qui n'entre en collision avec aucun des rôles interdits. */
function distinctFrom(choix, interdits, candidats) {
  return interdits.includes(choix) ? candidats.find(candidat => !interdits.includes(candidat)) ?? choix : choix;
}

export function selectModels(task, supplied = {}) {
  const defaults = MODEL_DEFAULTS[task];
  const models = {
    writer: supplied.writer ? validateModel(supplied.writer, "Modèle rédacteur") : defaults.writer,
    auditor: supplied.auditor ? validateModel(supplied.auditor, "Modèle auditeur") : defaults.auditor,
    arbiter: supplied.arbiter ? validateModel(supplied.arbiter, "Modèle arbitre") : defaults.arbiter,
    challenger: supplied.challenger ? validateModel(supplied.challenger, "Modèle du second avis") : defaults.challenger,
    falsifier: supplied.falsifier ? validateModel(supplied.falsifier, "Modèle de réfutation") : defaults.falsifier
  };
  // En sélection manuelle, l'utilisateur peut désigner comme second avis le modèle qui rédige — ou
  // celui qui arbitre. Ni l'un ni l'autre ne tient : un second avis rendu par le rédacteur n'en est
  // pas un, et un arbitre qui a co-rédigé ne peut plus juger. On retient donc le premier candidat
  // disponible qui diffère des deux.
  models.challenger = distinctFrom(models.challenger, [models.writer, models.arbiter], CHALLENGER_FALLBACKS);
  // Le falsificateur cherche les contradictions ; l'arbitre les juge. Les confondre reviendrait à
  // faire juger un modèle sur ses propres trouvailles, sur l'élément de preuve le plus lourd du
  // dispositif — celui qui peut dégrader un APPROUVE.
  models.falsifier = distinctFrom(models.falsifier, [models.writer, models.arbiter], FALSIFIER_FALLBACKS);
  return models;
}

/** Résout les modèles d'une analyse à partir du mode de sélection.
 *
 *  En mode automatique, les modèles transmis par le client sont délibérément ignorés : l'interface
 *  envoie la valeur de ses trois <select> même lorsqu'ils sont masqués, et les honorer rendait
 *  MODEL_DEFAULTS inopérant — la « sélection automatique » se contentait alors des valeurs par
 *  défaut du formulaire (bug corrigé en 1.2.0, couvert par test/models.test.js). */
export function resolveModels({ autoModel, task, supplied = {} }) {
  return selectModels(autoModel ? task : "general_analysis", autoModel ? {} : supplied);
}
