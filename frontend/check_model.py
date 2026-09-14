import json
import numpy as np
import torch
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
from anomaly_utils import robust_transform

with open("artifacts/edge_config.json", "r", encoding="utf-8") as f:
    cfg = json.load(f)

model = torch.jit.load("artifacts/autoencoder_torchscript.pt", map_location="cpu")
model.eval()

center = np.array(cfg["scaler_center"], dtype=np.float32)
scale  = np.array(cfg["scaler_scale"],  dtype=np.float32)
threshold = cfg["threshold"]
print("Seuil :", threshold)

def score(values):
    x = np.array([values], dtype=np.float32)
    x_norm = robust_transform(x, center, scale)
    with torch.no_grad():
        xt = torch.from_numpy(x_norm)
        rec = model(xt)
        return torch.mean((rec - xt) ** 2).item()

# Ligne normale (approche de la moyenne du training set)
normal = [20.39, 26.22, 0.0, 453.5]
anomal  = [95.0, 98.0, 0.0, 5000.0]

print("Normale :", score(normal))
print("Anormale:", score(anomal))