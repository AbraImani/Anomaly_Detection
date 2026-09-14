import json
from pathlib import Path

import numpy as np
import torch

from model import TinyAutoEncoder, FEATURES
from anomaly_utils import robust_transform


ARTIFACTS = Path("artifacts")


def main():
    config = json.loads(
        (ARTIFACTS / "edge_config.json").read_text(
            encoding="utf-8"
        )
    )

    model = TinyAutoEncoder()
    model.load_state_dict(
        torch.load(
            ARTIFACTS / "autoencoder_state.pt",
            map_location="cpu",
            weights_only=True,
        )
    )
    model.eval()

    print("\n=== EDGE ANOMALY DETECTOR ===")
    print("Entrez les valeurs du capteur.\n")

    values = []

    for feature in FEATURES:
        value = float(input(f"{feature}: "))
        values.append(value)

    X = np.asarray([values], dtype=np.float32)

    X_s = robust_transform(
        X,
        config["scaler_center"],
        config["scaler_scale"],
    )

    with torch.no_grad():
        x = torch.tensor(X_s, dtype=torch.float32)
        recon = model(x).numpy()

    score = float(
        np.mean((X_s - recon) ** 2)
    )

    threshold = float(config["threshold"])
    is_anomaly = score > threshold

    print("\n-----------------------------")
    print(f"Anomaly score : {score:.6f}")
    print(f"Threshold     : {threshold:.6f}")

    if is_anomaly:
        print("Résultat      : ANOMALIE")
    else:
        print("Résultat      : NORMAL")

    print("-----------------------------")


if __name__ == "__main__":
    main()
