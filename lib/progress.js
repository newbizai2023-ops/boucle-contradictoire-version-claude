// Position des étapes sur la barre de progression.
//
// Extrait de server.js pour être testable : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

/** Cadrage préalable, avant même la rédaction. */
export const PROGRESS_EXPLORE = 3;
/** Rédaction initiale, avant l'entrée dans la boucle. */
export const PROGRESS_DRAFT = 8;
/** Second avis indépendant et comparaison, entre la rédaction initiale et la boucle. */
export const PROGRESS_CHALLENGER = 12;
export const PROGRESS_DIVERGENCE = 16;
/** Réfutation adversariale, après la sortie de la boucle et avant l'arbitrage. */
export const PROGRESS_FALSIFY = 88;
/** Arbitrage final. */
export const PROGRESS_ARBITER = 94;
export const PROGRESS_COMPLETE = 100;

// Bande réservée aux cycles. Elle démarre après le second avis, dont les étapes sont facultatives :
// quand elles n'ont pas lieu, la barre saute simplement de la rédaction au premier cycle, ce qui
// reste croissant.
const CYCLE_BAND_START = 18;
const CYCLE_BAND_END = 86;
// Dans l'ordre d'exécution ; l'index d'une étape donne sa position dans la tranche du cycle.
const CYCLE_STEPS = ["sources", "audit", "correction"];

/** Position (en %) d'une étape de cycle.
 *
 *  La bande [10, 90] est découpée en `maxCycles` tranches égales, chacune partagée entre les trois
 *  étapes d'un cycle. La progression est ainsi strictement croissante, quel que soit le nombre de
 *  cycles demandé, et reste comprise entre la rédaction initiale et l'arbitrage.
 *
 *  Les formules précédentes (`12 + cycle * 12`, `22 + cycle * 14`, `30 + cycle * 16`) ignoraient
 *  `maxCycles` : la barre **reculait** au passage d'un cycle au suivant — 46 % à la fin du cycle 1,
 *  puis 36 % au début du cycle 2 — et dépassait 100 % dès quatre cycles (30 + 4 × 16 = 94, puis
 *  110 au cinquième), ce que seule la borne appliquée côté client masquait. */
export function cycleProgress(step, cycle, maxCycles) {
  const stepIndex = CYCLE_STEPS.indexOf(step);
  if (stepIndex < 0) throw new Error(`Étape de cycle inconnue : ${step}`);
  const cycles = Math.max(1, Number(maxCycles) || 1);
  const position = (Math.min(cycle, cycles) - 1 + stepIndex / CYCLE_STEPS.length) / cycles;
  return Math.round(CYCLE_BAND_START + position * (CYCLE_BAND_END - CYCLE_BAND_START));
}
