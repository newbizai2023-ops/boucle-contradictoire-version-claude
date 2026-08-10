import test from "node:test";
import assert from "node:assert/strict";
import { MODEL_DEFAULTS, ALLOWED_MODELS, modelLabel, validateModel, selectModels, resolveModels } from "../lib/models.js";

test("les domaines à haut risque sont rédigés par Opus, les autres par Sonnet", () => {
  // Reprend le tableau documenté dans le README (section « Modèles par domaine »).
  for (const task of ["technical", "financial", "legal"]) {
    assert.equal(MODEL_DEFAULTS[task].writer, "~anthropic/claude-opus-latest", task);
  }
  for (const task of ["current_research", "general_analysis"]) {
    assert.equal(MODEL_DEFAULTS[task].writer, "~anthropic/claude-sonnet-latest", task);
  }
});

test("tous les modèles par défaut figurent dans la liste blanche", () => {
  for (const [task, roles] of Object.entries(MODEL_DEFAULTS)) {
    for (const [role, model] of Object.entries(roles)) {
      assert.ok(ALLOWED_MODELS.has(model), `${task}.${role} = ${model} absent de ALLOWED_MODELS`);
    }
  }
});

test("validateModel n'accepte que les modèles de la liste blanche", () => {
  assert.equal(validateModel("~google/gemini-flash-latest", "Modèle rédacteur"), "~google/gemini-flash-latest");
  // Kimi a été retiré du choix en 1.11.3 : son libellé reste connu pour relire l'historique, mais il
  // n'est plus sélectionnable. Le distinguer d'un identifiant jamais accepté est ce qui garantit que
  // le retrait porte bien sur la liste blanche, et pas seulement sur le formulaire.
  assert.throws(() => validateModel("~moonshotai/kimi-latest", "Modèle rédacteur"), /invalide ou non autorisé/);
  // Identifiant OpenRouter de forme parfaitement valide, mais hors liste : c'est précisément le
  // cas que la validation par expression régulière laissait passer avant la 1.2.0, permettant à
  // tout compte authentifié de faire facturer le modèle de son choix à la clé du déploiement.
  assert.throws(() => validateModel("openai/o3-pro", "Modèle rédacteur"), /invalide ou non autorisé/);
  for (const invalide of [null, undefined, 42, "", { model: "x" }]) {
    assert.throws(() => validateModel(invalide, "Modèle auditeur"), /invalide ou non autorisé/);
  }
});

test("validateModel nomme le rôle fautif dans son message", () => {
  assert.throws(() => validateModel("x", "Modèle arbitre"), /^Error: Modèle arbitre invalide/);
});

test("selectModels complète chaque rôle non fourni par la valeur par défaut du domaine", () => {
  assert.deepEqual(selectModels("technical"), MODEL_DEFAULTS.technical);
  // Gemini Flash est le falsificateur par défaut : le désigner comme rédacteur crée une collision,
  // et le falsificateur bascule sur un repli. Un modèle ne peut pas réfuter le document qu'il a écrit.
  assert.deepEqual(selectModels("technical", { writer: "~google/gemini-flash-latest" }), {
    ...MODEL_DEFAULTS.technical,
    writer: "~google/gemini-flash-latest",
    falsifier: "~deepseek/deepseek-v4-flash-latest"
  });
});

test("resolveModels ignore les modèles transmis lorsque la sélection est automatique", () => {
  // Régression 1.2.0 : l'interface envoie la valeur de ses trois <select> même masqués. Les
  // honorer rendait MODEL_DEFAULTS inopérant — une demande classée « technical » était rédigée
  // par Sonnet, la valeur par défaut du formulaire, au lieu d'Opus.
  const suppliedParLeFormulaire = {
    writer: "~anthropic/claude-sonnet-latest",
    auditor: "openai/gpt-5.6-sol",
    arbiter: "~x-ai/grok-latest"
  };
  const resolved = resolveModels({ autoModel: true, task: "technical", supplied: suppliedParLeFormulaire });
  assert.equal(resolved.writer, "~anthropic/claude-opus-latest");
  assert.deepEqual(resolved, MODEL_DEFAULTS.technical);
});

test("resolveModels honore les modèles transmis en sélection manuelle", () => {
  const resolved = resolveModels({
    autoModel: false,
    task: "manual",
    supplied: { writer: "~anthropic/claude-haiku-latest" }
  });
  assert.equal(resolved.writer, "~anthropic/claude-haiku-latest");
  // Le domaine « manual » n'existe pas dans MODEL_DEFAULTS : les rôles non fournis retombent sur
  // le domaine général, sans quoi la lecture de `defaults` lèverait un TypeError.
  assert.equal(resolved.auditor, MODEL_DEFAULTS.general_analysis.auditor);
});

test("resolveModels rejette un modèle hors liste blanche en sélection manuelle", () => {
  assert.throws(
    () => resolveModels({ autoModel: false, task: "manual", supplied: { arbiter: "openai/o3-pro" } }),
    /Modèle arbitre invalide ou non autorisé/
  );
});

test("modelLabel rend les identifiants lisibles, y compris hors catalogue", () => {
  assert.equal(modelLabel("~anthropic/claude-opus-latest"), "Claude Opus");
  assert.equal(modelLabel("~inconnu/modele-x"), "inconnu/modele-x", "le tilde de préfixe est retiré");
  assert.equal(modelLabel(undefined), "");
});

test("le second avis est toujours confié à un autre modèle que le rédacteur", () => {
  // Un « second avis » rendu par le modèle qui a rédigé n'en est pas un : la seule propriété qui
  // compte ici est la différence, y compris quand l'utilisateur choisit ses modèles à la main.
  for (const task of Object.keys(MODEL_DEFAULTS)) {
    const models = selectModels(task);
    assert.notEqual(models.challenger, models.writer, `${task} : rédacteur et second avis identiques`);
    assert.notEqual(models.challenger, models.arbiter, `${task} : un arbitre qui a co-rédigé ne peut plus juger`);
  }
  const manuel = selectModels("general_analysis", { writer: "openai/gpt-5.6-terra", challenger: "openai/gpt-5.6-terra" });
  assert.notEqual(manuel.challenger, manuel.writer, "sélection manuelle : le doublon est corrigé");
});

test("le falsificateur n'est jamais l'arbitre ni le rédacteur", () => {
  // En 1.7.0, la réfutation était confiée au modèle d'arbitrage : il cherchait les contradictions
  // puis jugeait ses propres trouvailles, sur l'élément de preuve le plus lourd du dispositif.
  for (const task of Object.keys(MODEL_DEFAULTS)) {
    const models = selectModels(task);
    assert.notEqual(models.falsifier, models.arbiter, `${task} : le falsificateur juge ses propres contradictions`);
    assert.notEqual(models.falsifier, models.writer, `${task} : le falsificateur réfute son propre document`);
  }
  const manuel = selectModels("technical", { arbiter: "~google/gemini-flash-latest" });
  assert.notEqual(manuel.falsifier, manuel.arbiter, "sélection manuelle : la collision est corrigée");
});

test("un modèle retiré reste lisible dans l'historique sans redevenir sélectionnable", () => {
  // Retirer Kimi du choix ne doit pas rendre illisibles les analyses qui l'ont réellement employé :
  // le retrait vaut pour l'avenir, il ne réécrit pas ce qui a tourné. Sans son libellé, l'historique
  // afficherait « moonshotai/kimi-latest » à la place de son nom.
  assert.equal(modelLabel("~moonshotai/kimi-latest"), "Kimi (retiré)");
  assert.ok(!ALLOWED_MODELS.has("~moonshotai/kimi-latest"), "Kimi ne doit plus être sélectionnable");
});

test("aucun modèle retiré n'est proposé par défaut ni en repli", () => {
  // Le vrai risque du retrait : oublier une occurrence dans MODEL_DEFAULTS ou dans les listes de
  // repli. La sélection échouerait alors à la validation, après le 202 — donc tardivement, dans le
  // seul flux d'événements. On vérifie que tout ce que le code peut choisir est autorisé.
  for (const [task, roles] of Object.entries(MODEL_DEFAULTS)) {
    for (const [role, model] of Object.entries(roles)) {
      assert.ok(ALLOWED_MODELS.has(model), `${task}/${role} : ${model} n'est pas dans la liste blanche`);
    }
  }
  // Chaque collision possible mène à un repli, lui aussi autorisé.
  for (const task of Object.keys(MODEL_DEFAULTS)) {
    for (const model of ALLOWED_MODELS) {
      for (const role of ["writer", "arbiter"]) {
        const choisis = selectModels(task, { [role]: model });
        assert.ok(ALLOWED_MODELS.has(choisis.challenger), `${task} : second avis ${choisis.challenger} hors liste`);
        assert.ok(ALLOWED_MODELS.has(choisis.falsifier), `${task} : réfutation ${choisis.falsifier} hors liste`);
      }
    }
  }
});
