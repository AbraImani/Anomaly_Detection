// Port of model.py: real learned network, four normalized inputs, MSE > threshold.
export const FEATURES = Object.freeze(['Temperature', 'Humidity', 'Light', 'CO2']);
const f32 = Math.fround;
let cachedModel;

export function validateModel(model) {
  const fail = message => { throw new Error(`Modèle invalide : ${message}`); };
  const vector = (x, n) => Array.isArray(x) && x.length === n && x.every(Number.isFinite);
  if (!model || JSON.stringify(model.features) !== JSON.stringify(FEATURES)) fail('ordre des variables');
  if (model.architecture !== '4-16-3-16-4' || model.activation !== 'leaky_relu_0.1') fail('architecture / activation');
  if (!Number.isFinite(model.threshold) || model.threshold <= 0) fail('seuil');
  if (!vector(model.scaler?.center, 4) || !vector(model.scaler?.scale, 4) || model.scaler.scale.some(x => x < 0)) fail('RobustScaler');
  for (const [key, input, output] of [['encoder.0', 4, 16], ['encoder.2', 16, 3], ['decoder.0', 3, 16], ['decoder.2', 16, 4]]) {
    const w = model.weights?.[`${key}.weight`];
    if (!Array.isArray(w) || w.length !== output || !w.every(row => vector(row, input)) || !vector(model.weights[`${key}.bias`], output)) fail(`poids ${key}`);
  }
  return model;
}

export async function loadModel() {
  if (cachedModel) return cachedModel;
  // Resolve against this module, including under /frontend/ or a repository prefix.
  const response = await fetch(new URL('./model/model.json', import.meta.url));
  if (!response.ok) throw new Error(`Chargement du modèle : HTTP ${response.status}`);
  let parsed;
  const text = await response.text();
  try { parsed = JSON.parse(text); }
  catch { throw new Error('Le fichier model/model.json ne contient pas un JSON valide.'); }
  cachedModel = validateModel(parsed);
  Object.defineProperty(cachedModel, 'fileSizeBytes', { value: new TextEncoder().encode(text).byteLength });
  return cachedModel;
}

function linear(x, weights, bias) {
  // Float32 activations. Reduction order can differ from PyTorch/BLAS:
  // the test suite verifies tolerances rather than promising bitwise equality.
  return weights.map((row, i) => f32(row.reduce((sum, w, j) => sum + w * x[j], bias[i])));
}
const leakyReLU = x => x >= 0 ? x : f32(x * f32(0.1));

export function infer(model, raw) {
  if (!model) throw new Error('Le modèle n’est pas encore chargé.');
  if (!Array.isArray(raw) || raw.length !== 4 || !raw.every(v => typeof v === 'number' && Number.isFinite(v))) throw new Error('Saisissez quatre nombres finis.');
  const x = raw.map((v, i) => f32(f32(f32(v) - f32(model.scaler.center[i])) / (f32(model.scaler.scale[i]) || 1)));
  const w = model.weights;
  let y = linear(x, w['encoder.0.weight'], w['encoder.0.bias']).map(leakyReLU);
  y = linear(y, w['encoder.2.weight'], w['encoder.2.bias']).map(leakyReLU);
  y = linear(y, w['decoder.0.weight'], w['decoder.0.bias']).map(leakyReLU);
  y = linear(y, w['decoder.2.weight'], w['decoder.2.bias']);
  const errors = x.map((v, i) => { const delta = f32(v - y[i]); return f32(delta * delta); });
  const sum32 = errors.reduce((sum, value) => f32(sum + value), 0);
  const score = f32(sum32 / 4);
  if (![...x, ...y, ...errors, score].every(Number.isFinite)) throw new Error('Valeurs trop grandes pour le calcul float32.');
  const total = errors.reduce((sum, value) => sum + value, 0);
  return {score, threshold: model.threshold, isAnomaly: score > model.threshold, normalized: x, reconstruction: y, errors, contributions: errors.map(value => total === 0 ? 0 : value / total)};
}
