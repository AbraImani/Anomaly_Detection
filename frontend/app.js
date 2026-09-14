import { loadModel, infer } from './model.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const NAMES = ['Température', 'Humidité', 'Lumière', 'CO₂'];
const INPUTS = ['temperature', 'humidity', 'light', 'co2'];
const KEY = 'edgepulse-history-v1'; // Preserve the previous application's history.
const sessionStart = Date.now();
let model, items = [], range = 'recent', memoryOnly = false;
const number = (value, digits = 6) => Number.isFinite(value) ? (Math.abs(value) >= 1e6 || (value !== 0 && Math.abs(value) < 1e-6) ? value.toExponential(5) : value.toFixed(digits)) : '—';
const percent = value => `${(value * 100).toFixed(2)} %`;
const shortNumber = value => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(value);
const dominant = result => result.contributions.reduce((best, value, i, values) => value > values[best] ? i : best, 0);
function node(tag, className, content) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (content !== undefined) el.textContent = content;
  return el;
}
function storageMessage(message) {
  $('#storageWarning').textContent = message;
  $('#storageWarning').hidden = false;
}
function validRecord(x) {
  return x && Array.isArray(x.values) && x.values.length === 4 && x.values.every(Number.isFinite)
    && Number.isFinite(x.score) && x.score >= 0 && Number.isFinite(x.threshold) && x.threshold > 0
    && typeof x.isAnomaly === 'boolean' && x.isAnomaly === (x.score > x.threshold) && Number.isFinite(Date.parse(x.time))
    && Array.isArray(x.contributions) && x.contributions.length === 4 && x.contributions.every(v => Number.isFinite(v) && v >= 0 && v <= 1);
}
function readHistory() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) throw new Error('format');
    const valid = data.filter(validRecord).slice(0, 100);
    if (valid.length !== Math.min(data.length, 100)) storageMessage('Certaines anciennes analyses sont illisibles et ne sont pas affichées.');
    return valid;
  } catch {
    memoryOnly = true;
    storageMessage('Historique indisponible ou illisible. Les nouvelles analyses resteront en mémoire pour cette session.');
    return [];
  }
}
function saveHistory() {
  items = items.slice(0, 100);
  if (!memoryOnly) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); }
    catch { memoryOnly = true; storageMessage('Le navigateur refuse l’enregistrement. Les résultats restent disponibles pendant cette session ; vous pouvez les exporter.'); }
  }
  renderAll();
}
window.addEventListener('edgepulse:viewchange', event => { if (event.detail.view === 'dashboard') renderChart(); });
function resetResult() {
  $('#resultState').className = 'result-state idle';
  $('#resultMarker').textContent = '—';
  $('#resultHeading').textContent = 'En attente d’une mesure';
  $('#resultExplanation').textContent = 'Le score sera comparé au seuil du modèle entraîné.';
  $('#resultScore').textContent = '—';
  $('#scoreComparison').hidden = $('#featureErrors').hidden = $('#contributionNote').hidden = true;
  $('#latencyText').textContent = 'Aucune analyse exécutée';
  $('#formError').hidden = $('#inputWarning').hidden = true;
}
function setValues(values) { INPUTS.forEach((id, i) => { $(`#${id}`).value = values[i]; }); resetResult(); }
$('#fillNormal').addEventListener('click', () => setValues([21.7, 32, 439, 1200]));
$('#fillAnomaly').addEventListener('click', () => setValues([75, 30, 430, 800]));
$('#sensorForm').addEventListener('reset', resetResult);
// Do not leave a previous verdict attached to edited inputs.
$('#sensorForm').addEventListener('input', resetResult);

function contributionBars(container, result, withErrors = false) {
  container.replaceChildren();
  const maxIndex = dominant(result);
  result.contributions.forEach((value, i) => {
    const row = node('div', `contribution-row${i === maxIndex ? ' dominant' : ''}`);
    const label = node('div'); label.append(node('span', '', NAMES[i]), node('strong', '', `${(value * 100).toFixed(1)} %`));
    const bar = node('div', 'bar'); const fill = node('span'); fill.style.width = `${value * 100}%`; bar.append(fill);
    row.append(label, bar);
    if (withErrors) row.append(node('small', '', `Erreur quadratique : ${number(result.errors[i])}`));
    container.append(row);
  });
}
function renderResult(result, latency) {
  $('#resultState').className = `result-state ${result.isAnomaly ? 'anomaly' : 'normal'}`;
  $('#resultMarker').textContent = result.isAnomaly ? '!' : '✓';
  $('#resultHeading').textContent = result.isAnomaly ? 'ANOMALIE' : 'NORMAL';
  $('#resultExplanation').textContent = result.isAnomaly ? 'L’erreur de reconstruction dépasse le seuil calibré.' : 'L’erreur de reconstruction ne dépasse pas le seuil calibré.';
  $('#resultScore').textContent = number(result.score);
  $('#resultScore').title = String(result.score);
  $('#resultThreshold').textContent = number(result.threshold);
  const maximum = Math.max(result.threshold * 2, result.score * 1.15);
  $('#scoreComparison').hidden = false;
  $('#scoreFill').style.width = `${result.score / maximum * 100}%`;
  $('#thresholdMarker').style.left = `${result.threshold / maximum * 100}%`;
  $('#scoreGauge').className = `comparison-track${result.isAnomaly ? ' anomaly' : ''}`;
  $('#scoreGauge').setAttribute('aria-label', `Score ${result.score}, seuil ${result.threshold}`);
  $('#scoreRatio').textContent = `${shortNumber(result.score / result.threshold)} × le seuil`;
  $('#gaugeMax').textContent = number(maximum, 3);
  const difference = result.score - result.threshold;
  $('#comparisonText').textContent = `Marge par rapport au seuil : ${difference >= 0 ? '+' : ''}${difference.toExponential(3)}. Repère jaune : seuil calibré.`;
  contributionBars($('#featureErrors'), result, true);
  $('#featureErrors').hidden = $('#contributionNote').hidden = false;
  $('#latencyText').textContent = `${latency.toFixed(2)} ms · mesure locale`;
  $('#resultHeading').focus({ preventScroll: true });
  $('#resultPanel').scrollIntoView({ block: 'nearest', behavior: 'auto' });
}
$('#sensorForm').addEventListener('submit', event => {
  event.preventDefault();
  $('#formError').hidden = true;
  try {
    const values = INPUTS.map(id => $(`#${id}`).valueAsNumber);
    const unusual = values[0] < -273.15 || values[1] < 0 || values[1] > 100 || values[2] < 0 || values[3] < 0;
    $('#inputWarning').hidden = !unusual;
    $('#inputWarning').textContent = 'Certaines valeurs sortent des domaines physiques usuels. Le modèle les analyse sans les corriger.';
    const start = performance.now();
    const result = infer(model, values);
    const latency = performance.now() - start;
    const item = { ...result, values, time: new Date().toISOString(), modelId: model.model_id, latency };
    items.unshift(item); saveHistory(); renderResult(result, latency);
  } catch (error) { $('#formError').textContent = error.message; $('#formError').hidden = false; }
});
function retest(item) { setValues(item.values); location.hash = 'tester'; }
function renderEvents() {
  const container = $('#recentCards'); container.replaceChildren();
  if (!items.length) { container.append(node('p', 'muted', 'Vos résultats apparaîtront ici.')); return; }
  items.slice(0, 3).forEach(item => {
    const row = node('div', 'event-card'); const details = node('div');
    details.append(node('strong', item.isAnomaly ? 'anomaly-text' : 'normal-text', item.isAnomaly ? 'Anomalie détectée' : 'Mesure normale'));
    details.append(node('small', '', `Score ${number(item.score)} · ${new Date(item.time).toLocaleString('fr-FR')}`));
    const button = node('button', '', 'Retester ↗'); button.type = 'button'; button.setAttribute('aria-label', `Retester la mesure du ${new Date(item.time).toLocaleString('fr-FR')}`); button.onclick = () => retest(item);
    row.append(details, button); container.append(row);
  });
}
function renderAnomalies() {
  const anomalies = items.filter(item => item.isAnomaly);
  $('#navCount').textContent = $('#anomalyTotal').textContent = String(anomalies.length);
  $('#anomalyEmpty').hidden = anomalies.length > 0;
  $('#anomalyTable').replaceChildren();
  for (const item of anomalies) {
    const row = node('tr'); const dateCell = node('td'); const time = node('time', '', new Date(item.time).toLocaleString('fr-FR')); time.dateTime = item.time; dateCell.append(time);
    const measures = node('td'); const values = node('div', 'measure-values');
    values.append(node('span', '', `T ${shortNumber(item.values[0])} °C · H ${shortNumber(item.values[1])} %`), node('span', '', `L ${shortNumber(item.values[2])} lux · CO₂ ${shortNumber(item.values[3])} ppm`)); measures.append(values);
    const status = node('td'); status.append(node('span', 'chip anomaly', 'Anomalie'));
    const action = node('td'); const button = node('button', 'button quiet', 'Retester'); button.type = 'button'; button.onclick = () => retest(item); action.append(button);
    row.append(dateCell, measures, node('td', '', number(item.score)), node('td', '', NAMES[dominant(item)]), status, action); $('#anomalyTable').append(row);
  }
}
function svgNode(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
  if (text !== undefined) element.textContent = text;
  return element;
}
function renderChart() {
  const selected = (range === 'session' ? items.filter(item => Date.parse(item.time) >= sessionStart) : items.slice(0, 12)).slice().reverse();
  $('#chartEmpty').hidden = selected.length > 0;
  $('#chartGrid').replaceChildren(); $('#scorePoints').replaceChildren();
  $('#scoreLine').setAttribute('points', ''); $('#thresholdLine').setAttribute('visibility', selected.length ? 'visible' : 'hidden');
  if (!selected.length || !model) return;
  const width = Math.max(260, $('#scoreChart').clientWidth || 700);
  const right = width - 10;
  $('#scoreChart').setAttribute('viewBox', `0 0 ${width} 248`);
  $('#scoreChart').querySelector('text:last-child').setAttribute('x', right);
  $('#thresholdLine').setAttribute('x2', right);
  const maximum = Math.max(model.threshold * 2, ...selected.map(item => item.score * 1.12));
  const posY = score => 213 - score / maximum * 190;
  for (let i = 0; i < 5; i++) {
    const value = maximum * i / 4, y = posY(value);
    const label = maximum > 9999 ? value.toExponential(1) : number(value, maximum > 1 ? 1 : 3);
    $('#chartGrid').append(svgNode('line', { x1: 54, x2: right, y1: y, y2: y, class: 'grid-line' }), svgNode('text', { x: 46, y: y + 4, 'text-anchor': 'end', class: 'axis-text' }, label));
  }
  const points = selected.map((item, i) => [selected.length === 1 ? (54 + right) / 2 : 54 + i * (right - 54) / (selected.length - 1), posY(item.score)]);
  $('#scoreLine').setAttribute('points', points.map(point => point.join(',')).join(' '));
  points.forEach(([x, y], i) => {
    const circle = svgNode('circle', { cx: x, cy: y, r: 4, class: `score-dot${selected[i].isAnomaly ? ' anomaly' : ''}` });
    circle.append(svgNode('title', {}, `${new Date(selected[i].time).toLocaleString('fr-FR')} : ${number(selected[i].score)}`)); $('#scorePoints').append(circle);
  });
  $('#thresholdLine').setAttribute('y1', posY(model.threshold)); $('#thresholdLine').setAttribute('y2', posY(model.threshold));
  $('#chartDesc').textContent = `${selected.length} analyses, de la plus ancienne à la plus récente. Seuil actuel : ${model.threshold}. Dernier score : ${selected.at(-1).score}. Les statuts historiques conservent le seuil de leur analyse.`;
}
$$('[data-range]').forEach(button => button.addEventListener('click', () => { range = button.dataset.range; $$('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item === button))); renderChart(); }));
function renderAll() {
  $('#lastScore').textContent = items.length ? number(items[0].score) : '—';
  $('#lastVerdict').textContent = items.length ? (items[0].isAnomaly ? 'Anomalie détectée' : 'Mesure normale') : 'Aucune mesure analysée';
  $('#lastVerdict').className = items.length ? (items[0].isAnomaly ? 'anomaly-text' : 'normal-text') : '';
  $('#testCount').textContent = String(items.length);
  const count = items.filter(item => item.isAnomaly).length;
  $('#anomalyCount').textContent = `${count} anomalie${count > 1 ? 's' : ''} · sur cet appareil`;
  $('#diagEmpty').hidden = items.length > 0; $('#diagContent').hidden = items.length === 0;
  if (items.length) {
    contributionBars($('#diagnosticBars'), items[0]);
    const index = dominant(items[0]);
    $('#diagnosticText').textContent = `${NAMES[index]} : ${(items[0].contributions[index] * 100).toFixed(1)} % de l’erreur totale. Cette contribution n’est pas une preuve de causalité.`;
  }
  renderEvents(); renderAnomalies(); renderChart();
  $('#clearHistory').disabled = $('#exportHistory').disabled = items.length === 0;
}
$('#clearHistory').addEventListener('click', () => $('#clearDialog').showModal());
$('#cancelClear').addEventListener('click', () => $('#clearDialog').close());
$('#confirmClear').addEventListener('click', () => {
  try { localStorage.removeItem(KEY); memoryOnly = false; } catch { /* Session-only state remains available. */ }
  items = []; saveHistory(); resetResult(); $('#clearDialog').close(); $('#heading-anomalies').focus();
});
$('#exportHistory').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ application: 'EdgePulse', exportedAt: new Date().toISOString(), analyses: items }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const link = node('a'); link.href = url; link.download = `edgepulse-historique-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('storage', event => { if (event.key === KEY && !memoryOnly) { items = readHistory(); renderAll(); } });
function networkBadge() { $('#offlineBadge').textContent = navigator.onLine ? 'En ligne' : 'Hors ligne'; $('#offlineBadge').className = `chip ${navigator.onLine ? '' : 'warning'}`; }
window.addEventListener('online', networkBadge); window.addEventListener('offline', networkBadge);
function modelDetails() {
  $$('[data-threshold]').forEach(element => { element.textContent = number(model.threshold); element.title = String(model.threshold); });
  $$('[data-metric]').forEach(element => { const key = element.dataset.metric, value = model.metrics?.[key]; element.textContent = Number.isFinite(value) ? (['mae', 'rmse', 'r2'].includes(key) ? number(value, 4) : percent(value)) : 'Non disponible'; });
  const parameterCount = Object.values(model.weights).reduce((total, value) => total + value.flat().length, 0);
  $('#parameterCount').textContent = String(parameterCount);
  $('#weightsSize').textContent = `${parameterCount * 4} octets`;
  $('#modelSize').textContent = `${model.fileSizeBytes.toLocaleString('fr-FR')} octets`;
  $('#modelVersion').textContent = `v${model.version}`;
  $('#modelMeta').textContent = `${parameterCount} paramètres · local`;
  $('#evaluationNote').textContent = model.training_note;
  if (model.confusion_matrix) { const [tn, fp] = model.confusion_matrix[0]; $('#falsePositiveNote').textContent = `${percent(fp / (tn + fp))} de faux positifs sur les observations de référence du test. Interprétez les alertes dans ce contexte.`; $('#falsePositiveNote').hidden = false; }
  $('#scalerDetails').replaceChildren();
  NAMES.forEach((name, i) => { const card = node('div'); card.append(node('strong', '', name), node('span', '', `Médiane : ${shortNumber(model.scaler.center[i])}`), node('span', '', `Échelle : ${shortNumber(model.scaler.scale[i])}`)); $('#scalerDetails').append(card); });
}
items = readHistory(); networkBadge(); renderAll();
if ('ResizeObserver' in window) new ResizeObserver(() => { if (!$('#view-dashboard').hidden) renderChart(); }).observe($('#scoreChart'));
loadModel().then(loaded => {
  model = loaded; modelDetails(); $('#analyzeButton').disabled = false;
  $('#modelReadyMessage').textContent = 'Modèle prêt · les calculs sont exécutés sur votre appareil.';
  $('#modelStatus').textContent = 'Opérationnel'; $('#modelStatus').classList.add('normal-text');
  $('#sideModelStatus').textContent = 'Modèle chargé'; $('#sideModelDetail').textContent = '263 paramètres · inférence locale'; renderAll();
}).catch(error => {
  $('#analyzeButton').disabled = true;
  $('#modelStatus').textContent = 'Indisponible'; $('#modelStatus').classList.add('anomaly-text');
  $('#sideModelStatus').textContent = 'Chargement impossible'; $('#modelMeta').textContent = 'Inférence désactivée';
  $('#modelError').textContent = `${error.message} Vérifiez model/model.json et rechargez la page.`; $('#modelError').hidden = false;
  $('#modelReadyMessage').textContent = 'Modèle indisponible. Consultez le message en haut de la page.';
  $('#retryStartup').hidden = false;
});
