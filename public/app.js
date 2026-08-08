const $ = s => document.querySelector(s);
let currentRunId = localStorage.getItem('currentRunId');
let currentEventSource = null;
// Mémorise la demande en cours pour l'afficher dans le fil de suivi et la restaurer telle quelle
// en cas de reconnexion (rechargement de page pendant qu'une analyse tourne encore).
function rememberCurrentRun(id, requestText){
  currentRunId = id;
  try { localStorage.setItem('currentRunId', id); localStorage.setItem('currentRunRequest', requestText ?? ''); } catch {}
}
function summarizeRequest(text, max = 240){
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
function showRequestSummary(text){
  const node = $('#requestSummary');
  const summary = summarizeRequest(text);
  node.textContent = summary ? `Demande : ${summary}` : '';
  node.hidden = !summary;
}
const HISTORY_CACHE_KEY = 'boucleHistoryCache';
function readHistoryCache(){ try { return JSON.parse(localStorage.getItem(HISTORY_CACHE_KEY) || '[]'); } catch { return []; } }
function writeHistoryCache(runs){ try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify((runs || []).slice(0,100))); } catch {} }
function rememberRun(run){ const cached=readHistoryCache(); const merged=[run,...cached.filter(item=>item.id!==run.id)]; writeHistoryCache(merged); }
const dateLabel = value => new Date(value || Date.now()).toLocaleString();
const scoreLabel = run => run.final_score ?? run.audits?.at(-1)?.score_global ?? '—';
const sourcesLabel = run => (run.sources_total == null ? (run.sources?.length ?? '—') : `${run.sources_accessible ?? 0}/${run.sources_total}`);
function historyRows(runs){
  if(!runs.length) return '<p>Aucune analyse enregistrée pour l’instant.</p>';
  const lignes = runs.map(r=>`<tr class="history-row" data-run-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Ouvrir l’analyse du ${esc(dateLabel(r.created_at||r.createdAt))}">
    <td>${esc(dateLabel(r.created_at||r.createdAt))}</td>
    <td>${esc((r.request||'').slice(0,80))}</td>
    <td>${esc(r.task_type||r.taskType||'')}</td>
    <td><span class="status-chip ${esc(String(r.status||'').split('_')[0])}">${esc(r.status)}</span></td>
    <td>${esc(String(scoreLabel(r)))}</td>
    <td>${esc(String(r.cycles ?? r.audits?.length ?? '—'))}</td>
    <td>${esc(String(sourcesLabel(r)))}</td>
    <td>$${Number(r.total_cost||r.totalCost||0).toFixed(4)}</td>
  </tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Demande</th><th>Type</th><th>Statut</th><th>Score</th><th>Cycles</th><th>Sources</th><th>Coût</th></tr></thead><tbody>${lignes}</tbody></table></div>`;
}
let healthState = {};
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function isChecked(selector) { return Boolean($(selector)?.checked); }
const keyRules = {
  openrouter: { pattern: /^sk-or-v1-[A-Za-z0-9_-]{20,}$/, label: 'La clé OpenRouter doit commencer par sk-or-v1-.' },
  firecrawl: { pattern: /^fc[-_][A-Za-z0-9_-]{8,}$/, label: 'La clé Firecrawl doit commencer par fc- ou fc_.' }
};
async function json(url, options) { const r = await fetch(url, options); const d = await r.json().catch(()=>({})); if (!r.ok) throw new Error(d.error || `Erreur ${r.status}`); return d; }

function keyStatus(input, type, serverConfigured = false) {
  const value = input.value.trim();
  if (!value) return serverConfigured ? 'server' : 'empty';
  return keyRules[type].pattern.test(value) ? 'valid' : 'invalid';
}
function renderKeyStatus(input, type, help, icon, serverConfigured = false) {
  const status = keyStatus(input, type, serverConfigured);
  input.classList.toggle('is-valid', status === 'valid');
  input.classList.toggle('is-invalid', status === 'invalid');
  input.setAttribute('aria-invalid', String(status === 'invalid'));
  icon.textContent = status === 'valid' ? '✓' : status === 'invalid' ? '!' : status === 'server' ? '●' : '';
  icon.className = `key-icon ${status}`;
  help.className = status === 'invalid' ? 'field-error' : '';
  help.textContent = status === 'invalid' ? keyRules[type].label : status === 'valid' ? 'Format valide.' : status === 'server' ? 'Une clé est déjà configurée sur le serveur.' : `Format attendu : ${type === 'openrouter' ? 'sk-or-v1-…' : 'fc-…'}`;
  return status;
}
function syncFirecrawlAvailability() {
  const input = $('#firecrawlApiKey');
  const toggle = $('#webSearch');
  const option = $('#firecrawlOption');
  const status = renderKeyStatus(input, 'firecrawl', $('#firecrawlKeyHelp'), $('#firecrawlKeyIcon'), Boolean(healthState.hasFirecrawlKey));
  const enabled = status === 'valid' || status === 'server';
  if (toggle) toggle.disabled = !enabled;
  if (!enabled && toggle) toggle.checked = false;
  option.classList.toggle('disabled-option', !enabled);
  option.setAttribute('aria-disabled', String(!enabled));
  $('#webSearchHelp').textContent = enabled
    ? 'Firecrawl est disponible. Active cette option pour contrôler plus profondément les sources citées.'
    : 'Saisis une clé Firecrawl valide pour activer cette option. La recherche Web OpenRouter reste active.';
}
function validateKeys(showErrors = false) {
  const openStatus = renderKeyStatus($('#apiKey'), 'openrouter', $('#apiKeyHelp'), $('#apiKeyIcon'), Boolean(healthState.hasOpenRouterKey));
  const fireStatus = renderKeyStatus($('#firecrawlApiKey'), 'firecrawl', $('#firecrawlKeyHelp'), $('#firecrawlKeyIcon'), Boolean(healthState.hasFirecrawlKey));
  syncFirecrawlAvailability();
  const errors = [];
  if (openStatus === 'invalid') errors.push(keyRules.openrouter.label);
  if (fireStatus === 'invalid') errors.push(keyRules.firecrawl.label);
  if (isChecked('#webSearch') && !['valid','server'].includes(fireStatus)) errors.push('Une clé Firecrawl valide est obligatoire pour activer la vérification approfondie.');
  if (showErrors && errors.length) showError(new Error(errors.join(' ')));
  return errors.length === 0;
}

function renderServerApiStatus(health) {
  // OpenRouter et l'authentification Google sont indispensables (aucune analyse, ni aucune
  // connexion, n'est possible sans elles) : affichées en "critical" (rouge) si absentes, plus
  // sévère que Firecrawl et la base de données, qui ne font que dégrader l'expérience.
  const items = [
    ['#openrouterServerStatus', Boolean(health.hasOpenRouterKey), 'critical', 'Configurée sur Render', 'Non configurée'],
    ['#firecrawlServerStatus', Boolean(health.hasFirecrawlKey), 'missing', 'Configurée sur Render', 'Non configurée'],
    ['#googleServerStatus', Boolean(health.googleAuth), 'critical', 'Configurée', 'Non configurée'],
    ['#databaseServerStatus', Boolean(health.database), 'missing', 'Connectée', 'Non connectée']
  ];
  for (const [selector, configured, missingSeverity, okLabel, missingLabel] of items) {
    const node = $(selector);
    if (!node) continue;
    node.textContent = configured ? okLabel : missingLabel;
    node.className = `service-status ${configured ? 'configured' : missingSeverity}`;
  }
  const details = $('#temporaryKeys');
  if (details && (!health.hasOpenRouterKey || !health.hasFirecrawlKey)) details.open = true;
}

function updateTabsOverflow() {
  const wrap = document.querySelector('.tabs-wrap');
  const tabs = $('.tabs');
  if (!wrap || !tabs) return;
  wrap.classList.toggle('has-overflow', tabs.scrollWidth > tabs.clientWidth + 1);
}

async function init() {
  const [me, health] = await Promise.all([json('/api/me'), json('/api/health')]);
  healthState = health;
  renderServerApiStatus(health);
  const releaseLabel = `Release v${health.release || 'inconnue'}`;
  $('#release').textContent = releaseLabel;
  $('#releaseFooter').textContent = releaseLabel;
  $('#health').textContent = health.ok ? `Serveur prêt${health.database?' · DB':''}${health.hasFirecrawlKey?' · Firecrawl':''}` : 'Serveur indisponible';
  $('#health').className = `badge ${health.ok?'ok':'warn'}`;
  if (!me.user) {
    $('#auth').innerHTML = me.googleConfigured ? '<a class="login" href="/auth/google">Se connecter avec Google</a>' : '<span class="badge warn">OAuth Google non configuré</span>';
    return;
  }
  $('#auth').innerHTML = `<span>${esc(me.user.name || me.user.email)}</span> <button id="logout" class="secondary">Déconnexion</button>`;
  $('#logout').onclick = async()=>{ await json('/auth/logout',{method:'POST'}); location.reload(); };
  $('#app').hidden = false;
  syncFirecrawlAvailability();
  renderKeyStatus($('#apiKey'), 'openrouter', $('#apiKeyHelp'), $('#apiKeyIcon'), Boolean(health.hasOpenRouterKey));
  const [historyResult, dashboardResult] = await Promise.allSettled([loadHistory(), loadAnalytics()]);
  if (currentRunId) { $('#resultsPanel').hidden=false; $('#results').hidden=true; $('#progressPanel').hidden=false; resetFeed(); showRequestSummary(localStorage.getItem('currentRunRequest')); setProgress(1,'Reconnexion au traitement…'); watchJob(currentRunId); }
  if (historyResult.status === 'rejected') $('#historyList').innerHTML = `<p class="error">Historique indisponible : ${esc(historyResult.reason.message)}</p>`;
  if (dashboardResult.status === 'rejected') $('#analyticsOverview').innerHTML = `<p class="error">Données historisées indisponibles : ${esc(dashboardResult.reason.message)}</p>`;
  updateTabsOverflow();
}

// Les sélecteurs de modèles ne sont utiles qu'en sélection manuelle : masqués entièrement
// (plutôt que simplement grisés) tant que le mode automatique est actif, pour ne pas
// encombrer le formulaire par défaut.
$('#autoModel')?.addEventListener('change', e => { const models = $('#models'); if (models) models.hidden = Boolean(e.target?.checked); });
window.addEventListener('resize', updateTabsOverflow);
$('#files').addEventListener('change', renderSelectedFiles);
$('#apiKey').addEventListener('input', () => renderKeyStatus($('#apiKey'), 'openrouter', $('#apiKeyHelp'), $('#apiKeyIcon'), Boolean(healthState.hasOpenRouterKey)));
$('#firecrawlApiKey').addEventListener('input', syncFirecrawlAvailability);
function renderSelectedFiles(){
  const files=[...$('#files').files];
  $('#fileList').innerHTML=files.map((file,index)=>`<span class="file-chip"><span class="file-chip-label">${esc(file.name)} · ${(file.size/1024/1024).toFixed(2)} Mo</span><button type="button" class="file-remove" data-file-index="${index}" aria-label="Supprimer ${esc(file.name)}" title="Supprimer ce document">×</button></span>`).join('');
  $('#fileList').setAttribute('aria-label', files.length ? `${files.length} document${files.length>1?'s':''} sélectionné${files.length>1?'s':''}` : 'Aucun document sélectionné');
}
function removeSelectedFile(index){
  const input=$('#files');
  const transfer=new DataTransfer();
  [...input.files].forEach((file,fileIndex)=>{ if(fileIndex!==index) transfer.items.add(file); });
  input.files=transfer.files;
  renderSelectedFiles();
}
$('#fileList').addEventListener('click',event=>{
  const button=event.target.closest('.file-remove');
  if(!button) return;
  removeSelectedFile(Number(button.dataset.fileIndex));
});

$('#reviewForm').addEventListener('submit', async event => {
  event.preventDefault(); $('#error').hidden = true;
  if (!$('#request').checkValidity()) return showError(new Error('La demande doit contenir au moins 20 caractères.'));
  if (!validateKeys(true)) return;
  $('#submitButton').disabled = true; $('#submitButton').textContent='Initialisation…';
  $('#resultsPanel').hidden=false; $('#progressPanel').hidden=false; resetFeed(); showRequestSummary($('#request').value); appendFeedItem('start','Analyse demandée au serveur'); setProgress(1,'Envoi de la demande…');
  const formData = new FormData();
  formData.append('request',$('#request').value);
  const autoModel = isChecked('#autoModel');
  formData.append('autoModel',String(autoModel));
  formData.append('firecrawl',String(isChecked('#webSearch')));
  // Les trois sélecteurs restent renseignés même masqués : ne les transmettre qu'en sélection
  // manuelle, sinon ils décrivent un choix que l'utilisateur n'a pas fait. Le serveur les ignore
  // désormais en mode automatique — cette condition évite simplement d'envoyer une intention
  // trompeuse, elle ne tient pas lieu de contrôle.
  if (!autoModel) {
    formData.append('writerModel',$('#writerModel').value.trim());
    formData.append('auditorModel',$('#auditorModel').value.trim());
    formData.append('arbiterModel',$('#arbiterModel').value.trim());
  }
  formData.append('maxCycles',$('#maxCycles').value);
  formData.append('minScore',$('#minScore').value);
  formData.append('apiKey',$('#apiKey').value.trim());
  formData.append('firecrawlApiKey',$('#firecrawlApiKey').value.trim());
  [...$('#files').files].forEach(file=>formData.append('files',file));
  try {
    const { id } = await json('/api/jobs',{method:'POST',body:formData}); rememberCurrentRun(id, $('#request').value);
    $('#results').hidden=true; appendFeedItem('start','Tâche créée'); setProgress(2,'Initialisation de l’analyse'); watchJob(id);
  } catch(error) { appendFeedItem('error',`Échec du lancement : ${error.message}`); showError(error); resetButton(); }
});

// ---------------------------------------------------------------------------
// Flux unifié de suivi : chaque étape (rédaction, sources, audit, arbitrage…)
// démarre comme une entrée "en cours" (progress) puis s'enrichit en place avec
// son constat détaillé (insight), plutôt que de produire deux entrées séparées.
// ---------------------------------------------------------------------------
let feedSteps = new Map();
function resetFeed(){ feedSteps = new Map(); $('#timeline').innerHTML = ''; }
function stepKey(kind, cycle){ return `${kind}:${cycle ?? ''}`; }
// Les catégories/étapes ci-dessous ont un point de départ (progress) et un résultat
// (insight) à faire coïncider dans une même entrée ; "arbiter" et "arbitration"
// désignent la même étape finale sous deux noms différents.
// Étapes appariées : le nom de l'étape "progress" et celui de la catégorie "insight" coïncident,
// sauf pour l'arbitrage, qui porte deux noms différents de part et d'autre.
const PAIRED_STEPS = ['explore','draft','challenger','divergence','sources','audit','falsify'];
function progressStepKey(payload){
  if (PAIRED_STEPS.includes(payload.step)) return stepKey(payload.step, payload.cycle);
  if (payload.step === 'arbiter') return stepKey('arbitration', null);
  return null;
}
function insightStepKey(payload){
  if (payload.category === 'arbitration') return stepKey('arbitration', null);
  if (PAIRED_STEPS.includes(payload.category)) return stepKey(payload.category, payload.cycle);
  return null;
}
function nowLabel(){ return new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'}); }
function feedItemInner(kind, time, message, details){
  const showCategory = !['start','complete','error','source-ping','progress'].includes(kind);
  const category = showCategory ? `<span class="feed-category">${esc(kind)}</span>` : '';
  const detailsHtml = details ? `<details><summary>Détails</summary><pre>${esc(JSON.stringify(details,null,2))}</pre></details>` : '';
  return `<span class="feed-marker" aria-hidden="true"></span><div><div class="feed-item-head"><time>${esc(time)}</time>${category}</div><p>${esc(message)}</p>${detailsHtml}</div>`;
}
function appendFeedItem(kind, message, details){
  const feed = $('#timeline');
  const li = document.createElement('li');
  li.className = `feed-item ${kind}`;
  li.innerHTML = feedItemInner(kind, nowLabel(), message, details);
  feed.append(li);
  scrollFeedToLatest(feed);
  return li;
}
// Ajoute une entrée "en cours" pour une étape qui sera enrichie à la réception de son insight.
function startFeedStep(key, kind, message){
  const li = appendFeedItem(kind, message);
  li.classList.add('pending');
  feedSteps.set(key, li);
}
// Enrichit en place l'entrée "en cours" correspondante avec son résultat ; ajoute une nouvelle
// entrée si aucune étape en attente ne correspond (constat sans point de départ, ex. stratégie).
function resolveFeedStep(key, kind, message, details){
  const pending = key ? feedSteps.get(key) : null;
  if (pending) {
    const time = pending.querySelector('time')?.textContent || nowLabel();
    pending.className = `feed-item ${kind}`;
    pending.innerHTML = feedItemInner(kind, time, message, details);
    scrollFeedToLatest($('#timeline'));
    feedSteps.delete(key);
    return;
  }
  appendFeedItem(kind, message, details);
}
// Les tâches vivent dans la mémoire du processus : tout redémarrage du serveur (déploiement, mise
// en veille de l'hébergeur) les efface, et /api/jobs/:id/events répond alors 404. Un EventSource
// ne retente pas après un 404 — sans ce traitement, l'interface restait indéfiniment figée sur
// « Reconnexion au traitement… 1 % », sans message ni moyen d'en sortir autrement qu'en vidant le
// stockage local.
function forgetCurrentRun(message){
  currentRunId = null;
  try { localStorage.removeItem('currentRunId'); localStorage.removeItem('currentRunRequest'); } catch {}
  if (!message) return;
  $('#progressPanel').hidden = true;
  $('#resultsPanel').hidden = true;
  showError(new Error(message));
}
// Le suivi en direct est perdu, mais l'analyse a pu se terminer avant le redémarrage : elle reste
// consultable si elle a été historisée ou si elle est encore en mémoire.
async function recoverFinishedRun(id){
  try {
    const { run } = await json(`/api/runs/${encodeURIComponent(id)}`);
    appendFeedItem('complete', 'Analyse retrouvée : seul le suivi en direct avait été interrompu.');
    renderResult(run);
    setProgress(100, 'Terminé');
    loadHistory().catch(()=>{});
    loadAnalytics().catch(()=>{});
  } catch {
    forgetCurrentRun('Le suivi de cette analyse n’est plus disponible : le serveur a redémarré depuis son lancement et ne la connaît plus. Relance une analyse pour repartir.');
  }
}

function watchJob(id) {
  if (currentEventSource) currentEventSource.close();
  const es = new EventSource(`/api/jobs/${id}/events`);
  currentEventSource = es;
  // Le navigateur reconnecte silencieusement l'EventSource après une coupure (veille mobile,
  // changement de réseau…), et le serveur rejoue alors tout l'historique du job depuis le début.
  // Sans ce garde-fou, chaque reconnexion dupliquait dans le fil de suivi les entrées déjà
  // affichées (numéro de séquence croissant par job, voir server.js `emit`).
  let lastSeq = -1;
  function onceParsed(handler) {
    return e => {
      const d = JSON.parse(e.data);
      if (d.seq != null) {
        if (d.seq <= lastSeq) return;
        lastSeq = d.seq;
      }
      handler(d);
    };
  }
  es.addEventListener('progress', onceParsed(d => {
    if (d.percent != null) setProgress(d.percent, d.message);
    const key = progressStepKey(d);
    const kind = d.step || 'progress';
    if (key) startFeedStep(key, kind, d.message); else appendFeedItem(kind, d.message);
  }));
  es.addEventListener('source', onceParsed(d => appendFeedItem('source-ping', d.message)));
  // L'événement "audit" (scores bruts) est absorbé par le constat "insight" équivalent, plus complet.
  es.addEventListener('insight', onceParsed(d => resolveFeedStep(insightStepKey(d), d.category||'analyse', d.message||'', d.details)));
  es.addEventListener('complete', onceParsed(d => { es.close(); appendFeedItem('complete','Analyse terminée'); renderResult(d.result); setProgress(100,'Terminé'); resetButton(); loadHistory().catch(showError); loadAnalytics().catch(showError); }));
  // Sert à la fois pour les erreurs réseau natives de l'EventSource (sans e.data, avant une
  // reconnexion automatique) et pour l'événement "error" émis par le serveur quand le job échoue.
  es.addEventListener('error', e => {
    if (e.data) {
      // Événement "error" émis par le serveur : l'analyse elle-même a échoué.
      const d = JSON.parse(e.data);
      if (d.seq != null) { if (d.seq <= lastSeq) return; lastSeq = d.seq; }
      showError(new Error(d.message));
      appendFeedItem('error', d.message);
      forgetCurrentRun();
      es.close();
      resetButton();
      return;
    }
    // Erreur native de l'EventSource. Tant que readyState vaut CONNECTING, le navigateur retente
    // de lui-même (veille mobile, changement de réseau) : ne rien faire, et surtout pas close(),
    // qui supprimerait cette reconnexion automatique. CLOSED signifie au contraire que la
    // connexion a été refusée définitivement — typiquement un 404 sur un job inconnu.
    if (es.readyState !== EventSource.CLOSED) return;
    resetButton();
    recoverFinishedRun(id);
  });
}
function setProgress(p,t){ const value=Math.min(100,Math.max(0,Number(p)||0)); $('#progressBar').style.width=`${value}%`; $('#progressText').textContent=t||''; $('#progressPercent').textContent=`${Math.round(value)} %`; $('.progress').setAttribute('aria-valuenow',String(value)); }
function scrollFeedToLatest(feed){
  requestAnimationFrame(()=>{
    feed.scrollTo({top:feed.scrollHeight,behavior:'smooth'});
  });
}
function resetButton(){ $('#submitButton').disabled=false; $('#submitButton').textContent='Lancer la boucle'; }
function showError(error){ $('#error').textContent=error.message; $('#error').hidden=false; $('#error').scrollIntoView({block:'nearest'}); }
function renderResult(data){ $('#progressPanel').hidden=true; $('#results').hidden=false; rememberCurrentRun(data.id, data.request); $('#status').textContent=data.status; const last=data.audits?.at(-1); $('#score').textContent=last?.score_global??'—'; $('#calls').textContent=data.calls?.length||0; $('#cost').textContent=`$${Number(data.totalCost||0).toFixed(4)}`; renderStopReason($('#stopReason'), data.stopReason); $('#finalDocument').textContent=data.finalDocument||''; $('#arbitration').innerHTML=renderArbitration(data.arbitration); $('#audits').innerHTML=(data.audits||[]).map(a=>`<article class="audit-card"><h3>Cycle ${a.cycle} — ${a.score_global}/100</h3><p>${esc(a.resume||'')}</p>${(a.anomalies||[]).map(x=>`<div class="issue ${esc(x.gravite)}"><b>${esc(x.categorie)} · ${esc(x.gravite)}</b><p>${esc(x.probleme)}</p><small>${esc(x.correction_attendue)}</small></div>`).join('')}</article>`).join(''); $('#scores').innerHTML=renderScores(data.audits||[]); $('#sources').innerHTML=renderSources(data.sources||[]); $('#claims').innerHTML=renderClaims(data.audits||[]); $('#contradiction').innerHTML=renderContradiction(data); $('#usage').innerHTML=renderUsage(data.calls||[]); document.querySelectorAll('[data-export]').forEach(a=>{ a.href=`/api/runs/${data.id}/export/${a.dataset.export}`; }); updateTabsOverflow(); }
// La raison d'arrêt était enregistrée et historisée mais n'apparaissait nulle part : rien ne
// distinguait à l'écran une boucle qui s'est arrêtée parce que l'audit validait, une boucle
// interrompue faute de cycles, et une boucle abandonnée pour stagnation.
function renderStopReason(element, stopReason){
  if(!element) return;
  element.textContent = stopReason || '';
  element.hidden = !stopReason;
  element.className = /stagnation|maximal/i.test(String(stopReason||'')) ? 'stop-reason warn' : 'stop-reason';
}
// Les motifs de l'arbitre sont des objets {constat, preuve} ; les réserves et actions attendues
// sont des chaînes. Un modèle peut livrer l'un pour l'autre : la forme reçue est rendue telle
// quelle plutôt que d'afficher « [object Object] ».
function arbitrationList(title, items){
  if(!Array.isArray(items) || !items.length) return '';
  const entries = items.map(item => {
    if(item && typeof item === 'object') {
      const head = item.constat ?? item.motif ?? JSON.stringify(item);
      const proof = item.preuve ? `<small>${esc(String(item.preuve))}</small>` : '';
      return `<li>${esc(String(head))}${proof}</li>`;
    }
    return `<li>${esc(String(item))}</li>`;
  }).join('');
  return `<div class="arbitration-list"><h4>${esc(title)}</h4><ul>${entries}</ul></div>`;
}
const VERDICT_CSS = { APPROUVE:'ok', APPROUVE_AVEC_RESERVES:'warn', REJETE:'bad' };
function confidenceCard(label, value, hint){
  const known = Number.isFinite(Number(value));
  const percent = known ? Math.min(100, Math.max(0, Number(value))) : 0;
  return `<article class="confidence"><span>${esc(label)}</span><strong>${known?`${percent}<em>/100</em>`:'—'}</strong>
    <div class="confidence-bar"><span style="width:${percent}%"></span></div><small>${esc(hint)}</small></article>`;
}
// Les deux dimensions de confiance sont indépendantes : des preuves solides peuvent porter une
// recommandation fragile. Les afficher séparément est tout l'intérêt de les avoir demandées —
// noyées dans le JSON brut, elles seraient restées invisibles.
function renderArbitration(arbitration){
  if(!arbitration) return '';
  const verdict = String(arbitration.decision||'—');
  const plafonnee = Number.isFinite(Number(arbitration.confiance_annoncee))
    ? `<p class="arbitration-note">Confiance globale ramenée de ${esc(String(arbitration.confiance_annoncee))} à ${esc(String(arbitration.confiance))} : elle ne peut pas dépasser la plus faible de ses deux dimensions.</p>`
    : '';
  return `<div class="arbitration">
    <div class="arbitration-head"><h3>Arbitrage final indépendant</h3><span class="verdict ${VERDICT_CSS[verdict]||'unchecked'}">${esc(verdict)}</span></div>
    <div class="confidence-grid">
      ${confidenceCard('Confiance globale', arbitration.confiance, 'Plafonnée par la plus faible des deux dimensions')}
      ${confidenceCard('Confiance dans les preuves', arbitration.confiance_preuves, 'Solidité, indépendance et accessibilité des sources')}
      ${confidenceCard('Confiance dans la conclusion', arbitration.confiance_conclusion, 'Dépendance aux hypothèses et au périmètre retenus')}
    </div>
    ${plafonnee}
    ${arbitrationList('Motifs', arbitration.motifs)}
    ${arbitrationList('Réserves', arbitration.reserves)}
    ${arbitrationList('Actions requises', arbitration.actions_requises)}
    <details><summary>Arbitrage brut (JSON)</summary><pre>${esc(JSON.stringify(arbitration,null,2))}</pre></details>
  </div>`;
}
function renderScores(audits){ const keys=['exactitude_factuelle','qualite_sources','calculs','couverture','coherence','actualite']; return `<div class="table-wrap"><table><thead><tr><th>Cycle</th><th>Global</th>${keys.map(k=>`<th>${k.replaceAll('_',' ')}</th>`).join('')}</tr></thead><tbody>${audits.map(a=>`<tr><td>${a.cycle}</td><td>${a.score_global}</td>${keys.map(k=>`<td>${a.scores?.[k]??'—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; }
function sourceState(source){
  if(source.accessible===true)return{key:'accessible',label:'Accessible',detail:'Page extraite et contrôlée par Firecrawl',css:'ok'};
  if(source.accessible===null)return{key:'unchecked',label:'Non contrôlée',detail:source.reason||'Contrôle Firecrawl désactivé',css:'unchecked'};
  const technical=/HTTP|timeout|fetch|Firecrawl|clé|API|quota|rate/i.test(String(source.reason||''));
  return technical?{key:'error',label:'Erreur de contrôle',detail:source.reason||'Erreur Firecrawl',css:'warn'}:{key:'inaccessible',label:'Inaccessible',detail:source.reason||'La page n’a pas pu être extraite',css:'bad'};
}
function renderSources(sources){
  if(!sources.length)return '<p>Aucune source structurée détectée par OpenRouter.</p>';
  const states=sources.map(sourceState);
  const count=key=>states.filter(state=>state.key===key).length;
  const summary=`<div class="source-summary"><span>Accessibles : <b>${count('accessible')}</b></span><span>Inaccessibles : <b>${count('inaccessible')}</b></span><span>Non contrôlées : <b>${count('unchecked')}</b></span><span>Erreurs de contrôle : <b>${count('error')}</b></span></div>`;
  const cards=sources.map((source,index)=>{const state=states[index];return `<article class="source ${state.css}"><div><b>${esc(source.title||source.url)}</b><span class="source-status ${state.css}">${state.label}</span></div><a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.url)}</a><p>${esc(state.detail)}</p><small>${esc(source.sourceClass)}</small></article>`;}).join('');
  return summary+`<div class="source-grid">${cards}</div>`;
}
// Inventaire des affirmations du dernier cycle : le niveau de traçabilité qui manquait entre le
// document et ses sources. Les déterminantes non établies sont mises en tête — ce sont elles qui
// bloquent la validation, et la première chose qu'un lecteur doit voir.
const CLAIM_STATUS = {
  VERIFIE: { label: 'Établie', css: 'ok' },
  NON_VERIFIE: { label: 'Non établie', css: 'warn' },
  CONTREDIT: { label: 'Contredite', css: 'bad' }
};
function renderClaims(audits){
  const dernier = audits?.at(-1);
  const claims = dernier?.claims || [];
  if(!claims.length) return '<p>Aucun inventaire d’affirmations : l’auditeur n’en a pas produit pour cette analyse.</p>';

  const bloquantes = claims.filter(c=>c.critique && c.statut!=='VERIFIE');
  const rang = c => (c.critique && c.statut!=='VERIFIE' ? 0 : c.critique ? 1 : c.statut!=='VERIFIE' ? 2 : 3);
  const ordonnees = [...claims].sort((a,b)=>rang(a)-rang(b));

  const alerte = bloquantes.length
    ? `<p class="stop-reason warn">${bloquantes.length} affirmation(s) déterminante(s) non établie(s) : la conclusion repose sur du non démontré.</p>`
    : '';
  const regressions = (dernier?.regressions||[]).length
    ? `<div class="arbitration-list"><h4>Perdues à la réécriture</h4><ul>${dernier.regressions.map(r=>`<li>${esc(r.affirmation)}<small>établie au cycle précédent → ${esc(r.apres)}</small></li>`).join('')}</ul></div>`
    : '';

  const lignes = ordonnees.map(claim=>{
    const etat = CLAIM_STATUS[claim.statut] || CLAIM_STATUS.NON_VERIFIE;
    const sources = (claim.sources||[]).map(url=>`<a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a>`).join(' ');
    return `<tr class="claim ${etat.css}">
      <td><span class="source-status ${etat.css}">${etat.label}</span></td>
      <td>${claim.critique?'<b title="La conclusion en dépend">déterminante</b>':'—'}</td>
      <td>${esc(claim.type)}</td>
      <td>${esc(claim.affirmation)}${sources?`<div class="claim-sources">${sources}</div>`:''}</td>
    </tr>`;
  }).join('');

  return `${alerte}<div class="source-summary"><span>Total : <b>${claims.length}</b></span><span>Déterminantes : <b>${claims.filter(c=>c.critique).length}</b></span><span>Établies : <b>${claims.filter(c=>c.statut==='VERIFIE').length}</b></span><span>Non établies : <b>${claims.filter(c=>c.statut!=='VERIFIE').length}</b></span></div>
    <div class="table-wrap"><table><thead><tr><th>Statut</th><th>Portée</th><th>Type</th><th>Affirmation</th></tr></thead><tbody>${lignes}</tbody></table></div>${regressions}`;
}

// Les trois étapes qui existent pour mettre le document en difficulté : le cadrage qui l'empêche de
// choisir son périmètre, le second avis qui le confronte à une autre lecture, la réfutation qui
// cherche à le démentir. Regroupées ici parce qu'elles se lisent ensemble.
function renderContradiction(data){
  const blocs = [];

  if(data.exploration){
    const dimensions = data.exploration.dimensions.map(d=>`<li>${esc(d.axe)}${d.enjeu?` — <span class="muted">${esc(d.enjeu)}</span>`:''}${d.questions.length?`<ul>${d.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul>`:''}</li>`).join('');
    blocs.push(`<div class="arbitration"><h3>Cadrage préalable</h3><p class="muted">Produit avant toute rédaction, pour que le périmètre ne soit pas choisi en silence par le premier brouillon.</p>
      <div class="arbitration-list"><h4>Dimensions à couvrir</h4><ul>${dimensions}</ul></div>
      ${data.exploration.angles_morts.length?`<div class="arbitration-list"><h4>Angles morts signalés</h4><ul>${data.exploration.angles_morts.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`:''}
      ${data.exploration.perimetre_a_preciser.length?`<div class="arbitration-list"><h4>Périmètre non tranché par la demande</h4><ul>${data.exploration.perimetre_a_preciser.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}</div>`);
  }

  if(data.divergence){
    const desaccords = data.divergence.desaccords.map(d=>`<li>${esc(d.sujet)} <span class="source-status unchecked">${esc(d.cause)}</span>
      <small><b>A :</b> ${esc(d.position_a)}</small><small><b>B :</b> ${esc(d.position_b)}</small><small><b>À trancher :</b> ${esc(d.question_a_trancher)}</small></li>`).join('');
    const nonEtayes = data.divergence.accords.filter(a=>!a.etaye);
    blocs.push(`<div class="arbitration"><h3>Second avis indépendant</h3><p class="muted">Une seconde analyse du même sujet, rédigée sans voir la première. Les désaccords ne sont pas départagés par un vote : ce sont des questions à instruire.</p>
      ${desaccords?`<div class="arbitration-list"><h4>Désaccords de fond</h4><ul>${desaccords}</ul></div>`:'<p>Aucun désaccord de fond relevé.</p>'}
      ${nonEtayes.length?`<div class="arbitration-list"><h4>Accords non étayés — un accord n’est pas une preuve</h4><ul>${nonEtayes.map(a=>`<li>${esc(a.sujet)}</li>`).join('')}</ul></div>`:''}</div>`);
  }

  if(data.falsification){
    const f = data.falsification;
    const verdictCss = {CONFIRME:'ok', AFFAIBLI:'warn', CONTREDIT:'bad'}[f.verdict] || 'unchecked';
    const contradictions = f.contradictions.map(c=>`<li>${esc(c.affirmation)} <span class="source-status ${severityCss(c.gravite)}">${esc(c.gravite||'')}</span><small>${esc(c.extrait||'')}</small><a href="${esc(c.source)}" target="_blank" rel="noopener">${esc(c.source)}</a></li>`).join('');
    const recentes = f.donnees_plus_recentes.map(d=>`<li>${esc(d.sujet)}<small>document : ${esc(d.valeur_document||'—')} → trouvé : ${esc(d.valeur_trouvee||'—')}</small><a href="${esc(d.source)}" target="_blank" rel="noopener">${esc(d.source)}</a></li>`).join('');
    blocs.push(`<div class="arbitration"><div class="arbitration-head"><h3>Recherche adversariale</h3><span class="verdict ${verdictCss}">${esc(f.verdict)}</span></div>
      <p class="muted">Une étape dont la mission n’est pas d’auditer le document mais de le démentir, avec la recherche web dont l’auditeur ne dispose pas. Toute objection sans source a été écartée.</p>
      ${contradictions?`<div class="arbitration-list"><h4>Contradictions sourcées</h4><ul>${contradictions}</ul></div>`:''}
      ${recentes?`<div class="arbitration-list"><h4>Données plus récentes</h4><ul>${recentes}</ul></div>`:''}
      ${f.hypotheses_fragiles.length?`<div class="arbitration-list"><h4>Hypothèses fragiles</h4><ul>${f.hypotheses_fragiles.map(h=>`<li>${esc(h)}</li>`).join('')}</ul></div>`:''}
      ${f.perimetres_non_couverts.length?`<div class="arbitration-list"><h4>Périmètres non couverts</h4><ul>${f.perimetres_non_couverts.map(p=>`<li>${esc(p)}</li>`).join('')}</ul></div>`:''}</div>`);
  }

  if(data.arbitrationOverride){
    blocs.push(`<p class="stop-reason warn">Statut dégradé après arbitrage : ${esc(data.arbitrationOverride.raison)}. La décision de l’arbitre reste affichée telle qu’il l’a rendue.</p>`);
  }

  return blocs.length ? blocs.join('') : '<p>Aucune étape de contradiction supplémentaire n’a été déclenchée pour cette analyse : ni cadrage, ni second avis, ni réfutation.</p>';
}
// Même normalisation que côté serveur (lib/audit.js) : les modèles écrivent « élevée » là où le
// contrat demande « elevee ». U+0300..U+036F en échappements, les littéraux seraient invisibles.
function severityCss(gravite){
  const brut = String(gravite||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return /^(critique|elev)/.test(brut) ? 'bad' : 'warn';
}
function renderUsage(calls){ return `<div class="table-wrap"><table><thead><tr><th>Rôle</th><th>Modèle</th><th>Entrée</th><th>Sortie</th><th>Coût</th></tr></thead><tbody>${calls.map(c=>`<tr><td>${esc(c.role)}</td><td>${esc(c.model)}</td><td>${c.usage?.prompt_tokens||0}</td><td>${c.usage?.completion_tokens||0}</td><td>$${Number(c.usage?.cost||0).toFixed(4)}</td></tr>`).join('')}</tbody></table></div>`; }
function renderRunDetail(run){
  const last = run.audits?.at(-1);
  const exports = ['md','pdf','docx','xlsx'].map(f=>`<a href="/api/runs/${encodeURIComponent(run.id)}/export/${f}">${f.toUpperCase()}</a>`).join(' ');
  return `<div class="section-title"><div><p class="eyebrow">ANALYSE ENREGISTRÉE</p><h3>${esc(dateLabel(run.createdAt))} — ${esc(run.status)}</h3></div><button type="button" id="closeRunDetail" class="secondary">Fermer</button></div>
    <div class="metrics">
      <article><span>Score final</span><strong>${esc(String(last?.score_global ?? '—'))}</strong></article>
      <article><span>Cycles</span><strong>${esc(String(run.audits?.length ?? 0))}</strong></article>
      <article><span>Sources</span><strong>${esc(String((run.sources||[]).filter(x=>x.accessible===true).length))}/${esc(String((run.sources||[]).length))}</strong></article>
      <article><span>Coût</span><strong>$${Number(run.totalCost||0).toFixed(4)}</strong></article>
    </div>
    ${run.stopReason ? `<p class="stop-reason">${esc(run.stopReason)}</p>` : ''}
    <p class="request-summary">Demande : ${esc(summarizeRequest(run.request, 400))}</p>
    <div class="toolbar"><span>Exports :</span> ${exports}</div>
    <details open><summary>Document final</summary><pre>${esc(run.finalDocument||'')}</pre></details>
    <details><summary>Arbitrage</summary>${renderArbitration(run.arbitration)}</details>
    <details><summary>Scores par cycle</summary>${renderScores(run.audits||[])}</details>
    <details><summary>Sources contrôlées</summary>${renderSources(run.sources||[])}</details>
    <details><summary>Affirmations inventoriées</summary>${renderClaims(run.audits||[])}</details>
    <details><summary>Contradiction — cadrage, second avis, réfutation</summary>${renderContradiction(run)}</details>
    <details><summary>Consommation</summary>${renderUsage(run.calls||[])}</details>`;
}
async function showRunDetail(id){
  const panel = $('#runDetail');
  panel.hidden = false;
  panel.innerHTML = '<p>Chargement…</p>';
  try {
    const { run } = await json(`/api/runs/${encodeURIComponent(id)}`);
    panel.innerHTML = renderRunDetail(run);
    panel.scrollIntoView({ behavior:'smooth', block:'nearest' });
  } catch(error){
    panel.innerHTML = `<p class="error">Analyse indisponible : ${esc(error.message)}</p>`;
  }
}
$('#historyList').addEventListener('click', event => {
  const row = event.target.closest('.history-row');
  if (row) showRunDetail(row.dataset.runId);
});
$('#historyList').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const row = event.target.closest('.history-row');
  if (row) { event.preventDefault(); showRunDetail(row.dataset.runId); }
});
$('#runDetail').addEventListener('click', event => {
  if (event.target.id === 'closeRunDetail') { $('#runDetail').hidden = true; $('#runDetail').innerHTML = ''; }
});

async function loadHistory(){ const cached=readHistoryCache(); if(cached.length) $('#historyList').innerHTML=historyRows(cached); const {runs}=await json('/api/history'); const merged=[...(runs||[]),...cached.filter(c=>!(runs||[]).some(r=>r.id===c.id))].sort((a,b)=>new Date(b.created_at||b.createdAt||0)-new Date(a.created_at||a.createdAt||0)); writeHistoryCache(merged); $('#historyList').innerHTML=historyRows(merged); }
// ---------------------------------------------------------------------------
// Données historisées : agrégats sur l'ensemble des analyses enregistrées.
// ---------------------------------------------------------------------------
const nombre = value => Number(value ?? 0).toLocaleString('fr-FR');
const pourcent = (part, total) => (total ? `${Math.round((part / total) * 100)} %` : '—');
function table(colonnes, lignes, vide){
  if(!lignes.length) return `<p>${esc(vide)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${colonnes.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${
    lignes.map(l=>`<tr>${l.map(c=>`<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderAnalyticsOverview(a){
  const t = a.totals;
  return `<div class="metrics">
      <article><span>Analyses</span><strong>${nombre(t.runs)}</strong></article>
      <article><span>Validées</span><strong>${nombre(t.validated)}</strong></article>
      <article><span>Rejetées</span><strong>${nombre(t.rejected)}</strong></article>
      <article><span>En échec</span><strong>${nombre(t.errors)}</strong></article>
      <article><span>Score moyen</span><strong>${esc(String(t.avgScore ?? '—'))}</strong></article>
      <article><span>Cycles moyens</span><strong>${esc(String(t.avgCycles ?? '—'))}</strong></article>
      <article><span>Durée moyenne</span><strong>${t.avgDurationSec == null ? '—' : `${esc(String(t.avgDurationSec))} s`}</strong></article>
      <article><span>Coût total</span><strong>$${Number(t.cost||0).toFixed(4)}</strong></article>
    </div>
    <h3>Par type de tâche</h3>
    ${table(['Type','Analyses','Score moyen','Coût'], (a.byTaskType||[]).map(r=>[esc(r.taskType), nombre(r.runs), esc(String(r.avgScore ?? '—')), `$${Number(r.cost||0).toFixed(4)}`]), 'Aucune analyse enregistrée.')}`;
}
function renderAnalyticsSources(a){
  const s = a.sources;
  return `<div class="metrics">
      <article><span>Sources citées</span><strong>${nombre(s.total)}</strong></article>
      <article><span>Accessibles</span><strong>${nombre(s.accessible)} <small>(${pourcent(s.accessible, s.total)})</small></strong></article>
      <article><span>Inaccessibles</span><strong>${nombre(s.inaccessible)}</strong></article>
      <article><span>Non contrôlées</span><strong>${nombre(s.unchecked)}</strong></article>
    </div>
    <h3>Par catégorie de source</h3>
    ${table(['Catégorie','Occurrences','Accessibles','Taux'], (s.byClass||[]).map(r=>[esc(r.sourceClass), nombre(r.count), nombre(r.accessible), pourcent(r.accessible, r.count)]), 'Aucune source enregistrée.')}
    <h3>Domaines les plus cités</h3>
    ${table(['Domaine','Occurrences','Analyses','Accessibles','Taux'], (s.topHosts||[]).map(r=>[esc(r.host), nombre(r.count), nombre(r.runs), nombre(r.accessible), pourcent(r.accessible, r.count)]), 'Aucune source enregistrée.')}`;
}
function renderAnalyticsAudits(a){
  return `<h3>Progression par cycle</h3>
    ${table(['Cycle','Audits','Score moyen','Anomalies (moy.)','dont sévères'], (a.audits.byCycle||[]).map(r=>[esc(String(r.cycle)), nombre(r.audits), esc(String(r.avgScore ?? '—')), esc(String(r.avgAnomalies ?? '—')), esc(String(r.avgSevere ?? '—'))]), 'Aucun audit enregistré.')}
    <h3>Critères les plus faibles</h3>
    ${table(['Critère','Score moyen'], (a.audits.byCriterion||[]).map(r=>[esc(r.criterion.replaceAll('_',' ')), esc(String(r.avgScore ?? '—'))]), 'Aucun audit enregistré.')}`;
}
function renderAnalyticsUsage(a){
  const t = a.totals;
  return `<div class="metrics">
      <article><span>Tokens entrée</span><strong>${nombre(t.promptTokens)}</strong></article>
      <article><span>Tokens sortie</span><strong>${nombre(t.completionTokens)}</strong></article>
      <article><span>Caractères produits</span><strong>${nombre(t.documentChars)}</strong></article>
      <article><span>Coût total</span><strong>$${Number(t.cost||0).toFixed(4)}</strong></article>
    </div>
    <h3>Par modèle</h3>
    ${table(['Modèle','Appels','Tokens entrée','Tokens sortie','Coût'], (a.byModel||[]).map(r=>[esc(r.model), nombre(r.calls), nombre(r.promptTokens), nombre(r.completionTokens), `$${Number(r.cost||0).toFixed(4)}`]), 'Aucun appel enregistré.')}
    <h3>Par rôle</h3>
    ${table(['Rôle','Appels','Coût'], (a.byRole||[]).map(r=>[esc(r.role), nombre(r.calls), `$${Number(r.cost||0).toFixed(4)}`]), 'Aucun appel enregistré.')}`;
}
async function loadAnalytics(){
  const a = await json('/api/analytics');
  $('#analyticsOverview').innerHTML = renderAnalyticsOverview(a);
  $('#analyticsSources').innerHTML = renderAnalyticsSources(a);
  $('#analyticsAudits').innerHTML = renderAnalyticsAudits(a);
  $('#dashboard').innerHTML = renderAnalyticsUsage(a);
}
document.querySelectorAll('.atab').forEach(tab=>tab.onclick=()=>{
  document.querySelectorAll('.atab').forEach(x=>x.classList.toggle('active', x===tab));
  document.querySelectorAll('.atab-panel').forEach(x=>x.classList.toggle('active', x.id===tab.dataset.atab));
});
$('#refreshHistory').onclick=()=>Promise.allSettled([loadHistory(),loadAnalytics()]);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ loadHistory().catch(()=>{}); loadAnalytics().catch(()=>{}); if(currentRunId && (!currentEventSource || currentEventSource.readyState===EventSource.CLOSED)) watchJob(currentRunId); } });
window.addEventListener('online',()=>{ if(currentRunId && (!currentEventSource || currentEventSource.readyState===EventSource.CLOSED)) watchJob(currentRunId); });
$('#copy').onclick=()=>navigator.clipboard.writeText($('#finalDocument').textContent).catch(error=>showError(error));
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab)); document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active',x.id===tab.dataset.tab)); });
init().catch(showError);

window.addEventListener('unhandledrejection', event => { const message = event.reason?.message || String(event.reason || 'Erreur JavaScript inconnue'); console.error('[interface] promesse rejetée', event.reason); showError(new Error(message)); resetButton(); });
window.addEventListener('error', event => { if (!event.error) return; console.error('[interface] erreur', event.error); showError(new Error(event.error.message || 'Erreur JavaScript')); resetButton(); });
