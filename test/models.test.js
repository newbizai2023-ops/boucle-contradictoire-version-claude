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
  assert.equal(validateModel("~moonshotai/kimi-latest", "Modèle rédacteur"), "~moonshotai/kimi-latest");
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
  assert.deepEqual(selectModels("technical", { writer: "~moonshotai/kimi-latest" }), {
    ...MODEL_DEFAULTS.technical,
    writer: "~moonshotai/kimi-latest"
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
    supplied: { writer: "~moonshotai/kimi-latest" }
  });
  assert.equal(resolved.writer, "~moonshotai/kimi-latest");
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
