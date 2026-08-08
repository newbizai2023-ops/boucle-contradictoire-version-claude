// Extraction, dédoublonnage et classification des sources citées.
//
// Extraits de server.js pour être testables : le serveur appelle `app.listen()` au chargement du
// module, il ne peut donc pas être importé par une suite de tests.

export function extractUrls(text) {
  return [...new Set((String(text).match(/https?:\/\/[^\s)\]}>"']+/g) || []).map(url => url.replace(/[.,;:!?]+$/, "")))].slice(0, 12);
}

/** Rassemble les sources citées par les annotations OpenRouter des appels déjà effectués,
 *  dédoublonnées par URL. */
export function annotationSources(calls) {
  const items = [];
  for (const call of calls) {
    for (const annotation of call.annotations || []) {
      const citation = annotation.url_citation || annotation;
      if (citation.url) items.push({ url: citation.url, title: citation.title || "", excerpt: citation.content || "", origin: "openrouter" });
    }
  }
  return [...new Map(items.map(item => [item.url, item])).values()];
}

/** Nom d'hôte normalisé, ou null si l'URL est inexploitable. Sert à regrouper les sources par
 *  domaine dans les statistiques : `https://WWW.Exemple.fr/a` et `https://www.exemple.fr/b`
 *  doivent compter pour un seul et même site. */
export function sourceHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function sourceClass(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (/\.gov$|\.gouv\.fr$|\.europa\.eu$|\.int$/.test(host)) return "primary_official";
    if (/docs\.|learn\.microsoft|developer\.|developers\.|openrouter\.ai|firecrawl\.dev/.test(host)) return "primary_documentation";
    if (/reuters|apnews|afp|bbc|lemonde|ft\.com/.test(host)) return "reputable_media";
    return "other";
  } catch {
    return "invalid";
  }
}
