const $ = s => document.querySelector(s);
let currentRunId = localStorage.getItem('currentRunId');
let currentEventSource = null;
const HISTORY_CACHE_KEY = 'boucleHistoryCache';
function readHistoryCache(){ try { return JSON.parse(localStorage.getItem(HISTORY_CACHE_KEY) || '[]'); } catch { return []; } }
function writeHistoryCache(runs){ try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify((runs || []).slice(0,100))); } catch {} }
function rememberRun(run){ const cached=readHistoryCache(); const merged=[run,...cached.filter(item=>item.id!==run.id)]; writeHistoryCache(merged); }
function historyRows(runs){ return runs.length?`<div class="table-wrap"><table><thead><tr><th>Date</th><th>Demande</th><th>Type</th><th>Statut</th><th>Coût</th></tr></thead><tbody>${runs.map(r=>`<tr><td>${new Date(r.created_at||r.createdAt||Date.now()).toLocaleString()}</td><td>${esc((r.request||'').slice(0,90))}</td><td>${esc(r.task_type||r.taskType||'')}</td><td>${esc(r.status)}</td><td>${Number(r.total_cost||r.totalCost||0).toFixed(4)}</td></tr>`).join('')}</tbody></table></div>`:'<p>Aucun historique.</p>'; }
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
  const items = [
    ['#openrouterServerStatus', Boolean(health.hasOpenRouterKey)],
    ['#firecrawlServerStatus', Boolean(health.hasFirecrawlKey)]
  ];
  for (const [selector, configured] of items) {
    const node = $(selector);
    if (!node) continue;
    node.textContent = configured ? 'Configurée sur Render' : 'Non configurée';
    node.className = `service-status ${configured ? 'configured' : 'missing'}`;
  }
  const details = $('#temporaryKeys');
  if (details && (!health.hasOpenRouterKey || !health.hasFirecrawlKey)) details.open = true;
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
  const [historyResult, dashboardResult] = await Promise.allSettled([loadHistory(), loadDashboard()]);
  if (currentRunId) { $('#empty').hidden=true; $('#results').hidden=true; $('#progressPanel').hidden=false; $('#analysisPanel').hidden=false; setProgress(1,'Reconnexion au traitement…'); watchJob(currentRunId); }
  if (historyResult.status === 'rejected') $('#history').innerHTML = `<p class="error">Historique indisponible : ${esc(historyResult.reason.message)}</p>`;
  if (dashboardResult.status === 'rejected') $('#dashboard').innerHTML = `<p class="error">Tableau de bord indisponible : ${esc(dashboardResult.reason.message)}</p>`;
}

$('#autoModel')?.addEventListener('change', e => $('#models')?.classList.toggle('disabled', Boolean(e.target?.checked)));
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
  $('#empty').hidden=true; $('#progressPanel').hidden=false; $('#analysisPanel').hidden=false; $('#timeline').innerHTML=''; $('#analysisFeed').innerHTML=''; addTimeline('Analyse demandée au serveur', 'start'); setProgress(1,'Envoi de la demande…');
  const formData = new FormData();
  formData.append('request',$('#request').value);
  formData.append('autoModel',String(isChecked('#autoModel')));
  formData.append('firecrawl',String(isChecked('#firecrawl')));
  formData.append('writerModel',$('#writerModel').value.trim());
  formData.append('auditorModel',$('#auditorModel').value.trim());
  formData.append('arbiterModel',$('#arbiterModel').value.trim());
  formData.append('maxCycles',$('#maxCycles').value);
  formData.append('minScore',$('#minScore').value);
  formData.append('apiKey',$('#apiKey').value.trim());
  formData.append('firecrawlApiKey',$('#firecrawlApiKey').value.trim());
  [...$('#files').files].forEach(file=>formData.append('files',file));
  try {
    const { id } = await json('/api/jobs',{method:'POST',body:formData}); currentRunId=id;
    $('#results').hidden=true; addTimeline('Tâche créée', 'start'); setProgress(2,'Initialisation de l’analyse'); watchJob(id);
  } catch(error) { addTimeline(`Échec du lancement : ${error.message}`, 'error'); showError(error); resetButton(); }
});
function watchJob(id) {
  if (currentEventSource) currentEventSource.close();
  const es = new EventSource(`/api/jobs/${id}/events`);
  currentEventSource = es;
  const add = e => { const d=JSON.parse(e.data); addTimeline(d.message || d.type, d.type); if (d.percent != null) setProgress(d.percent,d.message); };
  ['progress','models','source','audit'].forEach(type=>es.addEventListener(type,add));
  es.addEventListener('insight', e=>{ const d=JSON.parse(e.data); addAnalysis(d); });
  es.addEventListener('complete', e=>{ es.close(); const d=JSON.parse(e.data); addTimeline('Analyse terminée', 'complete'); renderResult(d.result); setProgress(100,'Terminé'); resetButton(); loadHistory().catch(showError); loadDashboard().catch(showError); });
  es.addEventListener('error', e=>{ if(e.data){ const d=JSON.parse(e.data); showError(new Error(d.message)); addTimeline(d.message, 'error'); addAnalysis({category:'error',message:d.message}); } es.close(); resetButton(); });
}
function setProgress(p,t){ const value=Math.min(100,Math.max(0,Number(p)||0)); $('#progressBar').style.width=`${value}%`; $('#progressText').textContent=t||''; $('#progressPercent').textContent=`${Math.round(value)} %`; $('.progress').setAttribute('aria-valuenow',String(value)); }
function scrollFeedToLatest(feed){
  requestAnimationFrame(()=>{
    feed.scrollTo({top:feed.scrollHeight,behavior:'smooth'});
  });
}
function addTimeline(text,type='progress'){
  const feed=$('#timeline');
  const li=document.createElement('li');
  li.className=`feed-item ${type}`;
  const time=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  li.innerHTML=`<span class="feed-marker" aria-hidden="true"></span><div><time>${esc(time)}</time><p>${esc(text)}</p></div>`;
  feed.append(li);
  scrollFeedToLatest(feed);
}
function addAnalysis(data){
  const feed=$('#analysisFeed');
  const article=document.createElement('article');
  article.className=`analysis-entry ${data.category||'general'}`;
  const time=new Date(data.at||Date.now()).toLocaleTimeString();
  article.innerHTML=`<div><span>${esc(data.category||'analyse')}</span><time>${esc(time)}</time></div><p>${esc(data.message||'')}</p>${data.details?`<details><summary>Détails</summary><pre>${esc(JSON.stringify(data.details,null,2))}</pre></details>`:''}`;
  feed.append(article);
  scrollFeedToLatest(feed);
}
function resetButton(){ $('#submitButton').disabled=false; $('#submitButton').textContent='Lancer la boucle'; }
function showError(error){ $('#error').textContent=error.message; $('#error').hidden=false; $('#error').scrollIntoView({block:'nearest'}); }
function renderResult(data){ $('#progressPanel').hidden=true; $('#results').hidden=false; currentRunId=data.id; $('#status').textContent=data.status; const last=data.audits?.at(-1); $('#score').textContent=last?.score_global??'—'; $('#calls').textContent=data.calls?.length||0; $('#cost').textContent=`$${Number(data.totalCost||0).toFixed(4)}`; $('#finalDocument').textContent=data.finalDocument||''; $('#arbitration').innerHTML=`<h3>Arbitrage Grok</h3><pre>${esc(JSON.stringify(data.arbitration,null,2))}</pre>`; $('#audits').innerHTML=(data.audits||[]).map(a=>`<article class="audit-card"><h3>Cycle ${a.cycle} — ${a.score_global}/100</h3><p>${esc(a.resume||'')}</p>${(a.anomalies||[]).map(x=>`<div class="issue ${esc(x.gravite)}"><b>${esc(x.categorie)} · ${esc(x.gravite)}</b><p>${esc(x.probleme)}</p><small>${esc(x.correction_attendue)}</small></div>`).join('')}</article>`).join(''); $('#scores').innerHTML=renderScores(data.audits||[]); $('#sources').innerHTML=renderSources(data.sources||[]); $('#usage').innerHTML=renderUsage(data.calls||[]); document.querySelectorAll('[data-export]').forEach(a=>{ a.href=`/api/runs/${data.id}/export/${a.dataset.export}`; }); }
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
function renderUsage(calls){ return `<div class="table-wrap"><table><thead><tr><th>Rôle</th><th>Modèle</th><th>Entrée</th><th>Sortie</th><th>Coût</th></tr></thead><tbody>${calls.map(c=>`<tr><td>${esc(c.role)}</td><td>${esc(c.model)}</td><td>${c.usage?.prompt_tokens||0}</td><td>${c.usage?.completion_tokens||0}</td><td>$${Number(c.usage?.cost||0).toFixed(4)}</td></tr>`).join('')}</tbody></table></div>`; }
async function loadHistory(){ const cached=readHistoryCache(); if(cached.length) $('#history').innerHTML=historyRows(cached); const {runs}=await json('/api/history'); const merged=[...(runs||[]),...cached.filter(c=>!(runs||[]).some(r=>r.id===c.id))].sort((a,b)=>new Date(b.created_at||b.createdAt||0)-new Date(a.created_at||a.createdAt||0)); writeHistoryCache(merged); $('#history').innerHTML=historyRows(merged); }
async function loadDashboard(){ const d=await json('/api/dashboard'); $('#dashboard').innerHTML=`<div class="metrics"><article><span>Exécutions</span><strong>${d.totals.runs}</strong></article><article><span>Validées</span><strong>${d.totals.validated}</strong></article><article><span>Coût total</span><strong>$${Number(d.totals.cost).toFixed(4)}</strong></article><article><span>Tokens</span><strong>${(d.totals.promptTokens+d.totals.completionTokens).toLocaleString()}</strong></article></div>${renderUsage(d.byModel.map(m=>({role:`${m.calls} appels`,model:m.model,usage:{prompt_tokens:m.promptTokens,completion_tokens:m.completionTokens,cost:m.cost}})))}`; }
$('#refreshHistory').onclick=()=>Promise.allSettled([loadHistory(),loadDashboard()]);
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'){ loadHistory().catch(()=>{}); loadDashboard().catch(()=>{}); if(currentRunId && (!currentEventSource || currentEventSource.readyState===EventSource.CLOSED)) watchJob(currentRunId); } });
window.addEventListener('online',()=>{ if(currentRunId && (!currentEventSource || currentEventSource.readyState===EventSource.CLOSED)) watchJob(currentRunId); });
$('#copy').onclick=()=>navigator.clipboard.writeText($('#finalDocument').textContent).catch(error=>showError(error));
document.querySelectorAll('.tab').forEach(tab=>tab.onclick=()=>{ document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===tab)); document.querySelectorAll('.tab-panel').forEach(x=>x.classList.toggle('active',x.id===tab.dataset.tab)); });
init().catch(showError);

window.addEventListener('unhandledrejection', event => { const message = event.reason?.message || String(event.reason || 'Erreur JavaScript inconnue'); console.error('[interface] promesse rejetée', event.reason); showError(new Error(message)); resetButton(); });
window.addEventListener('error', event => { if (!event.error) return; console.error('[interface] erreur', event.error); showError(new Error(event.error.message || 'Erreur JavaScript')); resetButton(); });
