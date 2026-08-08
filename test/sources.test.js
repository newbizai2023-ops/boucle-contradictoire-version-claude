import test from "node:test";
import assert from "node:assert/strict";
import { extractUrls, annotationSources, sourceClass, sourceBudget } from "../lib/sources.js";

test("extractUrls repère les URL en texte brut et les dédoublonne", () => {
  const texte = "Voir https://a.example.com/1 puis https://b.example.com/2 et encore https://a.example.com/1.";
  assert.deepEqual(extractUrls(texte), ["https://a.example.com/1", "https://b.example.com/2"]);
});

test("extractUrls retire la ponctuation finale collée à l'URL", () => {
  // Cas courant en rédaction : « ...voir https://exemple.fr/page. » — sans ce nettoyage, Firecrawl
  // recevrait une URL avec un point final et la déclarerait inaccessible.
  assert.deepEqual(extractUrls("source : https://exemple.fr/page."), ["https://exemple.fr/page"]);
  assert.deepEqual(extractUrls("source : https://exemple.fr/page, et"), ["https://exemple.fr/page"]);
  assert.deepEqual(extractUrls("(cf. https://exemple.fr/page)"), ["https://exemple.fr/page"]);
});

test("extractUrls ignore ce qui n'est pas une adresse http(s)", () => {
  assert.deepEqual(extractUrls("contact@exemple.fr et ftp://exemple.fr/f"), []);
  assert.deepEqual(extractUrls(""), []);
  assert.deepEqual(extractUrls(undefined), []);
});

test("extractUrls plafonne à 12 adresses par défaut, et les énumère toutes sur demande", () => {
  const texte = Array.from({ length: 30 }, (_, i) => `https://exemple.fr/${i}`).join(" ");
  assert.equal(extractUrls(texte).length, 12);
  // La condition d'arrêt doit voir tous les liens du document, pas seulement ceux que le budget
  // Firecrawl retient comme candidats à la vérification.
  assert.equal(extractUrls(texte, Infinity).length, 30);
});

test("sourceBudget réserve toujours de quoi contrôler les sources d'un cycle tardif", () => {
  // Le cycle 1 consomme son quota, mais les cycles suivants en conservent un : c'est ce qui permet
  // de vérifier les URL qu'une correction vient d'ajouter. Avec l'ancien budget uniquement global,
  // ce quota valait 0 dès que le premier cycle avait épuisé le plafond.
  const quotas = { perCycle: 10, perRun: 20 };
  assert.equal(sourceBudget(0, quotas), 10, "premier cycle : quota plein");
  assert.equal(sourceBudget(10, quotas), 10, "deuxième cycle : quota plein, sous le plafond");
  assert.equal(sourceBudget(16, quotas), 4, "le plafond par analyse reprend la main");
});

test("sourceBudget ne renvoie jamais de quota négatif", () => {
  assert.equal(sourceBudget(20, { perCycle: 10, perRun: 20 }), 0);
  assert.equal(sourceBudget(45, { perCycle: 10, perRun: 20 }), 0);
});

test("annotationSources lit les deux formes d'annotation OpenRouter", () => {
  const sources = annotationSources([
    { annotations: [{ url_citation: { url: "https://a.fr", title: "A", content: "extrait" } }] },
    { annotations: [{ url: "https://b.fr", title: "B" }] }
  ]);
  assert.deepEqual(sources.map(s => s.url), ["https://a.fr", "https://b.fr"]);
  assert.equal(sources[0].excerpt, "extrait");
  assert.equal(sources[0].origin, "openrouter");
});

test("annotationSources dédoublonne par URL entre plusieurs appels", () => {
  // Les appels s'accumulent dans result.calls au fil des cycles : la même source citée à chaque
  // cycle ne doit être vérifiée qu'une fois.
  const sources = annotationSources([
    { annotations: [{ url_citation: { url: "https://a.fr" } }] },
    { annotations: [{ url_citation: { url: "https://a.fr" } }] }
  ]);
  assert.equal(sources.length, 1);
});

test("annotationSources tolère des appels sans annotation", () => {
  assert.deepEqual(annotationSources([]), []);
  assert.deepEqual(annotationSources([{}, { annotations: [] }, { annotations: [{ title: "sans url" }] }]), []);
});

test("sourceClass reconnaît les sources officielles, documentaires et médiatiques", () => {
  assert.equal(sourceClass("https://www.legifrance.gouv.fr/loda/id/X"), "primary_official");
  assert.equal(sourceClass("https://eur-lex.europa.eu/eli/reg/2016/679"), "primary_official");
  assert.equal(sourceClass("https://learn.microsoft.com/azure"), "primary_documentation");
  assert.equal(sourceClass("https://docs.python.org/3/"), "primary_documentation");
  assert.equal(sourceClass("https://www.reuters.com/article"), "reputable_media");
  assert.equal(sourceClass("https://blog.perso.example/avis"), "other");
});

test("sourceClass renvoie « invalid » pour une chaîne qui n'est pas une URL", () => {
  assert.equal(sourceClass("pas une url"), "invalid");
  assert.equal(sourceClass(""), "invalid");
});

test("sourceClass : usurpation possible par sous-domaine (limite connue)", () => {
  // Les motifs média et documentation ne sont pas ancrés sur le domaine enregistrable : n'importe
  // quel hôte *contenant* « bbc » ou « docs. » hérite du rang correspondant, alors que ce
  // classement est ensuite présenté à l'auditeur et à l'arbitre comme un fait établi. Constaté et
  // figé ici pour qu'un ancrage futur (host === d || host.endsWith("." + d)) soit un changement
  // délibéré et visible.
  assert.equal(sourceClass("https://bbc.exemple-malveillant.com/faux"), "reputable_media");
  assert.equal(sourceClass("https://docs.exemple-malveillant.com/faux"), "primary_documentation");
  // À l'inverse, l'ancrage des suffixes officiels, lui, fonctionne déjà.
  assert.equal(sourceClass("https://gouv.fr.exemple-malveillant.com/faux"), "other");
});
