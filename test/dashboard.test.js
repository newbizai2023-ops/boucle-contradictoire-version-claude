import test from "node:test";
import assert from "node:assert/strict";
import { buildDashboard } from "../lib/dashboard.js";

const run = (status, calls) => ({ status, calls });
const call = (model, cost, prompt, completion) => ({ model, usage: { cost, prompt_tokens: prompt, completion_tokens: completion } });

test("buildDashboard agrège la consommation par modèle", () => {
  const { byModel } = buildDashboard([
    run("validated", [call("opus", 0.5, 100, 50), call("grok", 0.1, 10, 5)]),
    run("rejected_by_arbiter", [call("opus", 0.25, 40, 20)])
  ]);
  assert.deepEqual(byModel, [
    { model: "opus", calls: 2, cost: 0.75, promptTokens: 140, completionTokens: 70 },
    { model: "grok", calls: 1, cost: 0.1, promptTokens: 10, completionTokens: 5 }
  ]);
});

test("buildDashboard classe les modèles du plus coûteux au moins coûteux", () => {
  const { byModel } = buildDashboard([run("validated", [call("pas-cher", 0.01, 1, 1), call("cher", 9, 1, 1)])]);
  assert.deepEqual(byModel.map(m => m.model), ["cher", "pas-cher"]);
});

test("buildDashboard totalise coûts et tokens sur toutes les exécutions", () => {
  const { totals } = buildDashboard([
    run("validated", [call("a", 1, 10, 5)]),
    run("validated", [call("b", 2, 20, 10)])
  ]);
  assert.equal(totals.runs, 2);
  assert.equal(totals.cost, 3);
  assert.equal(totals.promptTokens, 30);
  assert.equal(totals.completionTokens, 15);
});

test("buildDashboard compte comme validées les deux variantes de validation", () => {
  // `validated_with_reservations` doit être compté : le préfixe commun est la règle voulue.
  const { totals } = buildDashboard([
    run("validated", []),
    run("validated_with_reservations", []),
    run("rejected_by_arbiter", [])
  ]);
  assert.equal(totals.validated, 2);
});

test("buildDashboard tolère des exécutions sans appels ni statut", () => {
  const dashboard = buildDashboard([{}, run(undefined, [])]);
  assert.equal(dashboard.totals.runs, 2);
  assert.equal(dashboard.totals.cost, 0);
  assert.equal(dashboard.totals.validated, 0);
  assert.deepEqual(dashboard.byModel, []);
});

test("buildDashboard regroupe sous « unknown » les appels sans modèle et ignore les usages absents", () => {
  const { byModel, totals } = buildDashboard([run("validated", [{ usage: { cost: 1 } }, { model: undefined }])]);
  assert.deepEqual(byModel, [{ model: "unknown", calls: 2, cost: 1, promptTokens: 0, completionTokens: 0 }]);
  assert.equal(totals.cost, 1);
});

test("buildDashboard renvoie des totaux nuls sans exécution", () => {
  assert.deepEqual(buildDashboard([]), {
    totals: { runs: 0, cost: 0, promptTokens: 0, completionTokens: 0, validated: 0 },
    byModel: []
  });
});
