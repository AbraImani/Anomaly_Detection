"""
Prédiction d'anomalie en ligne de commande.
Usage :
    python predict.py --temp 20.4 --hum 26.2 --light 0 --co2 453.5
"""
import argparse
import json
import numpy as np
import torch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src")
from anomaly_utils import robust_transform

CONFIG_PATH = "artifacts/edge_config.json"
MODEL_PATH  = "artifacts/autoencoder_torchscript.pt"


def load_all():
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        cfg = json.load(f)
    model = torch.jit.load(MODEL_PATH, map_location="cpu")
    model.eval()
    return cfg, model


def predict(cfg, model, values):
    center = np.array(cfg["scaler_center"], dtype=np.float32)
    scale  = np.array(cfg["scaler_scale"],  dtype=np.float32)
    x = np.array([values], dtype=np.float32)
    x_norm = robust_transform(x, center, scale)
    with torch.no_grad():
        xt = torch.from_numpy(x_norm)
        rec = model(xt)
        mse = torch.mean((rec - xt) ** 2).item()
    is_anomaly = mse > cfg["threshold"]
    return mse, is_anomaly


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--temp",  type=float, required=True)
    p.add_argument("--hum",   type=float, required=True)
    p.add_argument("--light", type=float, required=True)
    p.add_argument("--co2",   type=float, required=True)
    args = p.parse_args()

    cfg, model = load_all()
    mse, is_anomaly = predict(cfg, model, [args.temp, args.hum, args.light, args.co2])

    print(f"Score MSE        : {mse:.6f}")
    print(f"Seuil            : {cfg['threshold']:.6f}")
    print(f"Résultat         : {'ANOMALIE' if is_anomaly else 'NORMAL'}")


if __name__ == "__main__":
    main()