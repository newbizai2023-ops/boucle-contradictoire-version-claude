// Mise en forme des exports : le dossier de preuves, pas seulement la prose finale.
//
// Les exports ne contenaient que le document et le JSON brut de l'arbitrage. Tout ce qui rend
// l'analyse opposable — le cadrage qui a délimité le travail, les affirmations et leur statut, les
// sources et leur état réel, les désaccords, la réfutation — restait dans l'application. Un
// document exporté redevenait donc une prose parmi d'autres, exactement ce que la méthodologie
// cherche à dépasser.
//
// Fonctions pures, testables sans serveur ni base : elles ne font que produire du texte.

const etatSource = source =>
  source?.accessible === true ? "accessible" : source?.accessible === false ? "inaccessible" : "non contrôlée";

const liste = (items, formatter) => (items ?? []).map(formatter).join("\n");

/** Rapport Markdown complet : document final suivi du dossier qui le soutient. */
export function evidenceMarkdown(run) {
  const sections = [`# Boucle contradictoire\n\n${run?.finalDocument ?? ""}`];

  if (run?.stopReason) sections.push(`## Raison d'arrêt\n\n${run.stopReason}`);

  if (run?.exploration) {
    const dimensions = liste(run.exploration.dimensions, dimension =>
      `- **${dimension.axe}**${dimension.enjeu ? ` — ${dimension.enjeu}` : ""}\n${liste(dimension.questions, question => `  - ${question}`)}`
    );
    const angles = run.exploration.angles_morts?.length
      ? `\n\n**Angles morts signalés**\n\n${liste(run.exploration.angles_morts, angle => `- ${angle}`)}`
      : "";
    sections.push(`## Cadrage préalable\n\n${dimensions}${angles}`);
  }

  const claims = run?.audits?.at(-1)?.claims ?? [];
  if (claims.length) {
    const lignes = liste(claims, claim =>
      `| ${claim.statut} | ${claim.critique ? "déterminante" : "—"} | ${claim.type} | ${String(claim.affirmation).replace(/\|/g, "\\|")} | ${(claim.sources ?? []).join("<br>")} |`
    );
    sections.push(
      `## Affirmations (dernier cycle)\n\n| Statut | Portée | Type | Affirmation | Sources |\n|---|---|---|---|---|\n${lignes}`
    );
  }

  if (run?.sources?.length) {
    const lignes = liste(run.sources, source => `| ${etatSource(source)} | ${source.sourceClass ?? ""} | ${source.url} | ${source.reason ?? ""} |`);
    sections.push(`## Sources contrôlées\n\n| État | Classe | URL | Motif |\n|---|---|---|---|\n${lignes}`);
  }

  if (run?.divergence?.desaccords?.length) {
    const lignes = liste(run.divergence.desaccords, desaccord =>
      `- **${desaccord.sujet}** _(cause : ${desaccord.cause})_\n  - A : ${desaccord.position_a}\n  - B : ${desaccord.position_b}\n  - À trancher : ${desaccord.question_a_trancher}`
    );
    sections.push(`## Désaccords avec l'analyse indépendante\n\n${lignes}`);
  }

  if (run?.falsification) {
    const contradictions = run.falsification.contradictions?.length
      ? liste(run.falsification.contradictions, contradiction =>
          `- ${contradiction.confirmee ? "**Confirmée**" : "Écartée"} — ${contradiction.affirmation}\n  - Source : ${contradiction.source}\n  - Relation établie : ${contradiction.preuve?.relation ?? "non validée"}`
        )
      : "_Aucune contradiction sourcée._";
    sections.push(`## Recherche adversariale — verdict ${run.falsification.verdict}\n\n${contradictions}`);
  }

  if (run?.arbitration) {
    const a = run.arbitration;
    sections.push(
      `## Arbitrage\n\n- Décision : **${a.decision}**\n- Confiance globale : ${a.confiance ?? "—"}/100\n` +
      `- Confiance dans les preuves : ${a.confiance_preuves ?? "—"}/100\n- Confiance dans la conclusion : ${a.confiance_conclusion ?? "—"}/100` +
      (a.confiance_annoncee ? `\n- Confiance annoncée avant plafonnement : ${a.confiance_annoncee}/100` : "") +
      (a.reserves?.length ? `\n\n**Réserves**\n\n${liste(a.reserves, reserve => `- ${reserve}`)}` : "") +
      (a.actions_requises?.length ? `\n\n**Actions requises**\n\n${liste(a.actions_requises, action => `- ${action}`)}` : "")
    );
  }

  return `${sections.join("\n\n")}\n`;
}

/** Annexe compacte, pour les formats qui ne rendent pas le Markdown (PDF, Word). */
export function evidenceAnnex(run) {
  const blocs = [];
  const claims = run?.audits?.at(-1)?.claims ?? [];

  if (claims.length) {
    blocs.push(`AFFIRMATIONS (${claims.length})\n${liste(claims, claim =>
      `  [${claim.statut}${claim.critique ? " · déterminante" : ""}] ${claim.affirmation}${(claim.sources ?? []).length ? `\n    ${claim.sources.join("\n    ")}` : ""}`
    )}`);
  }

  if (run?.sources?.length) {
    blocs.push(`SOURCES (${run.sources.length})\n${liste(run.sources, source => `  [${etatSource(source)}] ${source.url}`)}`);
  }

  if (run?.divergence?.desaccords?.length) {
    blocs.push(`DÉSACCORDS\n${liste(run.divergence.desaccords, desaccord => `  ${desaccord.sujet} (${desaccord.cause}) — à trancher : ${desaccord.question_a_trancher}`)}`);
  }

  if (run?.falsification) {
    blocs.push(`RECHERCHE ADVERSARIALE — ${run.falsification.verdict}\n${liste(run.falsification.contradictions, contradiction =>
      `  [${contradiction.confirmee ? "confirmée" : "écartée"}] ${contradiction.affirmation} — ${contradiction.source}`
    ) || "  Aucune contradiction sourcée."}`);
  }

  if (run?.arbitration) {
    const a = run.arbitration;
    blocs.push(`ARBITRAGE\n  Décision : ${a.decision}\n  Confiance globale : ${a.confiance ?? "—"}/100 (preuves ${a.confiance_preuves ?? "—"}, conclusion ${a.confiance_conclusion ?? "—"})`);
  }

  return blocs.join("\n\n") || "Aucun élément de dossier disponible pour cette analyse.";
}
