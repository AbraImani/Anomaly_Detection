import argparse
import json
import random
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.preprocessing import RobustScaler
from sklearn.metrics import f1_score, precision_score, recall_score

from model import TinyAutoEncoder, FEATURES
from anomaly_utils import inject_controlled_anomalies


def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def reconstruction_scores(model, X_scaled):
    model.eval()
    with torch.no_grad():
        x = torch.tensor(X_scaled, dtype=torch.float32)
        recon = model(x).cpu().numpy()
    scores = np.mean((X_scaled - recon) ** 2, axis=1)
    return scores, recon


def choose_threshold(y_true, scores):
    """
    Le seuil est choisi UNIQUEMENT sur les données de validation.
    On choisit le seuil qui maximise le F1-score.
    """
    candidates = np.unique(
        np.quantile(scores, np.linspace(0.001, 0.999, 1500))
    )

    best = None

    for threshold in candidates:
        pred = (scores > threshold).astype(int)

        row = {
            "threshold": float(threshold),
            "f1": float(f1_score(y_true, pred, zero_division=0)),
            "precision": float(precision_score(y_true, pred, zero_division=0)),
            "recall": float(recall_score(y_true, pred, zero_division=0)),
        }

        if best is None or row["f1"] > best["f1"]:
            best = row

    return best


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--train", default="datatraining.txt")
    parser.add_argument("--validation", default="datatest.txt")
    parser.add_argument("--out", default="artifacts")
    parser.add_argument("--epochs", type=int, default=150)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    set_seed(args.seed)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    train_df = pd.read_csv(args.train)
    val_df = pd.read_csv(args.validation)

    print("Variables utilisées :", FEATURES)
    print("Occupancy n'est PAS utilisé comme label d'anomalie.")

    X_train = train_df[FEATURES].astype(float).to_numpy()
    X_val_normal = val_df[FEATURES].astype(float).to_numpy()

    # Les données du professeur servent de comportement réel de référence.
    # Les anomalies synthétiques sont créées seulement dans la validation.
    X_val_anomaly = inject_controlled_anomalies(
        X_val_normal, seed=args.seed + 100
    )

    scaler = RobustScaler()
    X_train_s = scaler.fit_transform(X_train).astype(np.float32)
    X_val_normal_s = scaler.transform(X_val_normal).astype(np.float32)
    X_val_anomaly_s = scaler.transform(X_val_anomaly).astype(np.float32)

    model = TinyAutoEncoder()
    optimizer = torch.optim.Adam(
        model.parameters(), lr=1e-3, weight_decay=1e-5
    )
    criterion = torch.nn.MSELoss()

    train_tensor = torch.tensor(X_train_s, dtype=torch.float32)

    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(train_tensor, train_tensor),
        batch_size=128,
        shuffle=True,
    )

    # Early stopping évalué uniquement sur les observations normales
    # de validation.
    val_normal_tensor = torch.tensor(
        X_val_normal_s, dtype=torch.float32
    )

    best_val_loss = float("inf")
    best_state = None
    patience = 20
    left = patience
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        epoch_losses = []

        for xb, target in loader:
            optimizer.zero_grad()
            recon = model(xb)
            loss = criterion(recon, target)
            loss.backward()
            optimizer.step()
            epoch_losses.append(loss.item())

        model.eval()
        with torch.no_grad():
            val_recon = model(val_normal_tensor)
            val_loss = criterion(
                val_recon, val_normal_tensor
            ).item()

        train_loss = float(np.mean(epoch_losses))

        history.append({
            "epoch": epoch,
            "train_mse": train_loss,
            "validation_normal_mse": val_loss,
        })

        if epoch == 1 or epoch % 10 == 0:
            print(
                f"Epoch {epoch:03d} | "
                f"train MSE={train_loss:.6f} | "
                f"val normal MSE={val_loss:.6f}"
            )

        if val_loss < best_val_loss - 1e-6:
            best_val_loss = val_loss
            best_state = {
                k: v.detach().cpu().clone()
                for k, v in model.state_dict().items()
            }
            left = patience
        else:
            left -= 1
            if left <= 0:
                print("Early stopping.")
                break

    model.load_state_dict(best_state)

    # --------- Choix du seuil sur VALIDATION ----------
    normal_scores, _ = reconstruction_scores(
        model, X_val_normal_s
    )
    anomaly_scores, _ = reconstruction_scores(
        model, X_val_anomaly_s
    )

    y_val = np.concatenate([
        np.zeros(len(normal_scores), dtype=int),
        np.ones(len(anomaly_scores), dtype=int),
    ])

    val_scores = np.concatenate([
        normal_scores, anomaly_scores
    ])

    threshold_info = choose_threshold(y_val, val_scores)

    print("\nSeuil choisi sur validation :")
    print(json.dumps(threshold_info, indent=2))

    # ---------- Sauvegardes ----------
    torch.save(
        model.state_dict(),
        out / "autoencoder_state.pt"
    )

    # TorchScript : directement exploitable en Python/C++ sur
    # certains Edge devices, notamment Raspberry Pi.
    scripted = torch.jit.script(model.eval())
    scripted.save(str(out / "autoencoder_torchscript.pt"))

    config = {
        "features": FEATURES,
        "scaler_center": scaler.center_.tolist(),
        "scaler_scale": scaler.scale_.tolist(),
        "threshold": threshold_info["threshold"],
        "model_architecture": "4-16-3-16-4 Autoencoder",
        "anomaly_rule": "reconstruction_mse > threshold",
        "important_note": (
            "Occupancy is not an anomaly label. "
            "Controlled anomalies are injected only for validation/test."
        ),
    }

    (out / "edge_config.json").write_text(
        json.dumps(config, indent=2),
        encoding="utf-8",
    )

    (out / "validation_metrics.json").write_text(
        json.dumps(threshold_info, indent=2),
        encoding="utf-8",
    )

    pd.DataFrame(history).to_csv(
        out / "training_history.csv", index=False
    )

    # ONNX : recommandé pour la future application JavaScript/PWA.
    try:
        import onnx  # noqa
        dummy = torch.randn(1, 4, dtype=torch.float32)
        torch.onnx.export(
            model.eval(),
            dummy,
            out / "autoencoder.onnx",
            input_names=["input"],
            output_names=["reconstruction"],
            dynamic_axes={
                "input": {0: "batch"},
                "reconstruction": {0: "batch"},
            },
            opset_version=17,
        )
        print("ONNX exporté :", out / "autoencoder.onnx")
    except Exception as e:
        print(
            "\nONNX non exporté dans cet environnement."
            "\nInstallez `onnx` puis relancez le script."
            f"\nRaison : {e}"
        )

    n_params = sum(p.numel() for p in model.parameters())
    print(f"\nNombre de paramètres du modèle : {n_params}")
    print("Artifacts enregistrés dans :", out)


if __name__ == "__main__":
    main()
