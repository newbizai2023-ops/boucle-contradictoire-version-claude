// Agrégation de la consommation (coût et tokens) par modèle pour le tableau de bord.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

export function buildDashboard(runs) {
  const byModel = {};
  let cost = 0, prompt = 0, completion = 0;
  for (const run of runs) {
    for (const call of run.calls || []) {
      const key = call.model || "unknown";
      const usage = call.usage || {};
      byModel[key] ||= { model: key, calls: 0, cost: 0, promptTokens: 0, completionTokens: 0 };
      byModel[key].calls += 1;
      byModel[key].cost += Number(usage.cost || 0);
      byModel[key].promptTokens += Number(usage.prompt_tokens || 0);
      byModel[key].completionTokens += Number(usage.completion_tokens || 0);
      cost += Number(usage.cost || 0);
      prompt += Number(usage.prompt_tokens || 0);
      completion += Number(usage.completion_tokens || 0);
    }
  }
  return {
    totals: { runs: runs.length, cost, promptTokens: prompt, completionTokens: completion, validated: runs.filter(r => String(r.status).startsWith("validated")).length },
    byModel: Object.values(byModel).sort((a, b) => b.cost - a.cost)
  };
}
