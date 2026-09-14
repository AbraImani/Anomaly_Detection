import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

import json
import numpy as np
import pandas as pd
import torch
import streamlit as st
from anomaly_utils import robust_transform

CONFIG_PATH = "artifacts/edge_config.json"
MODEL_PATH  = "artifacts/autoencoder_torchscript.pt"
HISTORY_MAX = 50

st.set_page_config(page_title="IoT Anomaly Detection — Edge AI", layout="wide")


@st.cache_resource
def load_model():
    model = torch.jit.load(MODEL_PATH, map_location="cpu")
    model.eval()
    return model


@st.cache_data
def load_config():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def run_inference(cfg, model, values):
    center = np.array(cfg["scaler_center"], dtype=np.float32)
    scale  = np.array(cfg["scaler_scale"],  dtype=np.float32)
    x = np.array([values], dtype=np.float32)
    x_norm = robust_transform(x, center, scale)
    with torch.no_grad():
        xt = torch.from_numpy(x_norm)
        rec = model(xt)
        mse = torch.mean((rec - xt) ** 2).item()
    return mse, mse > cfg["threshold"]


cfg = load_config()
model = load_model()
FEATURES = cfg["features"]
THRESHOLD = cfg["threshold"]

st.title("🛰️ Détection d'anomalies IoT — Edge AI")
st.caption(f"Autoencoder PyTorch • Architecture : {cfg['model_architecture']} • Seuil : {THRESHOLD:.6f}")

# --- Sidebar ---
with st.sidebar:
    st.header("⚙️ Paramètres")
    st.metric("Seuil d'anomalie", f"{THRESHOLD:.6f}")
    st.markdown("**Features utilisées** :")
    for f in FEATURES:
        st.markdown(f"- {f}")
    st.markdown("---")
    st.markdown("**Scénarios de démo**")
    st.markdown("- 🟢 **Normal** : `20.4 / 26.2 / 0 / 453.5`")
    st.markdown("- 🔴 **Anomalie** : `95 / 98 / 0 / 5000`")

# --- Formulaire ---
st.subheader("📡 Simulation d'un capteur IoT")

defaults = {
    "Temperature": 20.39,
    "Humidity": 26.22,
    "Light": 0.0,
    "CO2": 453.5,
}

col1, col2 = st.columns(2)
values = []
with col1:
    for feat in FEATURES[:2]:
        values.append(st.number_input(feat, value=defaults.get(feat, 0.0), format="%.4f", key=f"in_{feat}"))
with col2:
    for feat in FEATURES[2:]:
        values.append(st.number_input(feat, value=defaults.get(feat, 0.0), format="%.4f", key=f"in_{feat}"))

if st.button("🔎 ANALYSER", use_container_width=True):
    mse, is_anomaly = run_inference(cfg, model, values)

    st.markdown("---")
    st.subheader("📊 Résultat de l'analyse")

    c1, c2, c3 = st.columns(3)
    c1.metric("Score MSE", f"{mse:.6f}")
    c2.metric("Seuil", f"{THRESHOLD:.6f}")
    c3.metric("Règle", "MSE > seuil")

    if is_anomaly:
        st.error(f"🚨 **ANOMALIE DÉTECTÉE** — score `{mse:.6f}` > seuil `{THRESHOLD:.6f}`")
    else:
        st.success(f"✅ **COMPORTEMENT NORMAL** — score `{mse:.6f}` ≤ seuil `{THRESHOLD:.6f}`")

    # Historique en session
    if "history" not in st.session_state:
        st.session_state.history = []
    st.session_state.history.append({
        **{f: v for f, v in zip(FEATURES, values)},
        "score": mse,
        "seuil": THRESHOLD,
        "résultat": "ANOMALIE" if is_anomaly else "NORMAL",
    })
    st.session_state.history = st.session_state.history[-HISTORY_MAX:]

# --- Historique ---
if "history" in st.session_state and st.session_state.history:
    st.markdown("---")
    st.subheader("🕓 Historique des prédictions")
    df = pd.DataFrame(st.session_state.history)
    st.dataframe(df, use_container_width=True)
    st.line_chart(df[["score"]])