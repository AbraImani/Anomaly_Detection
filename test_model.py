import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch

from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
    ConfusionMatrixDisplay,
    RocCurveDisplay,
    PrecisionRecallDisplay,
)

from model import TinyAutoEncoder, FEATURES
from anomaly_utils import (
    inject_controlled_anomalies,
    robust_transform,
)


def scores_and_reconstruction(model, X_scaled):
    model.eval()

    with torch.no_grad():
        x = torch.tensor(X_scaled, dtype=torch.float32)
        recon = model(x).cpu().numpy()

    score = np.mean(
        (X_scaled - recon) ** 2,
        axis=1,
    )

    return score, recon


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", default="datatest2.txt")
    parser.add_argument("--artifacts", default="artifacts")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    artifacts = Path(args.artifacts)

    config = json.loads(
        (artifacts / "edge_config.json").read_text(
            encoding="utf-8"
        )
    )

    threshold = float(config["threshold"])

    test_df = pd.read_csv(args.test)
    X_normal = test_df[FEATURES].astype(float).to_numpy()

    # Une copie anormale est fabriquée uniquement pour le TEST.
    # Seed différent de la validation.
    X_anomaly = inject_controlled_anomalies(
        X_normal,
        seed=args.seed + 200,
    )

    center = config["scaler_center"]
    scale = config["scaler_scale"]

    X_normal_s = robust_transform(
        X_normal, center, scale
    )
    X_anomaly_s = robust_transform(
        X_anomaly, center, scale
    )

    model = TinyAutoEncoder()
    model.load_state_dict(
        torch.load(
            artifacts / "autoencoder_state.pt",
            map_location="cpu",
            weights_only=True,
        )
    )

    normal_scores, normal_recon = scores_and_reconstruction(
        model, X_normal_s
    )

    anomaly_scores, _ = scores_and_reconstruction(
        model, X_anomaly_s
    )

    y_true = np.concatenate([
        np.zeros(len(normal_scores), dtype=int),
        np.ones(len(anomaly_scores), dtype=int),
    ])

    scores = np.concatenate([
        normal_scores, anomaly_scores
    ])

    y_pred = (scores > threshold).astype(int)

    cm = confusion_matrix(
        y_true, y_pred, labels=[0, 1]
    )

    metrics = {
        "accuracy": float(
            accuracy_score(y_true, y_pred)
        ),
        "precision": float(
            precision_score(
                y_true, y_pred, zero_division=0
            )
        ),
        "recall": float(
            recall_score(
                y_true, y_pred, zero_division=0
            )
        ),
        "f1_score": float(
            f1_score(
                y_true, y_pred, zero_division=0
            )
        ),
        "roc_auc": float(
            roc_auc_score(y_true, scores)
        ),
        "pr_auc": float(
            average_precision_score(y_true, scores)
        ),
        "confusion_matrix": cm.tolist(),
        "threshold": threshold,
    }

    # Ces trois métriques sont uniquement des diagnostics
    # de RECONSTRUCTION de l'Autoencoder.
    metrics["reconstruction_mae_normal"] = float(
        mean_absolute_error(
            X_normal_s, normal_recon
        )
    )

    metrics["reconstruction_rmse_normal"] = float(
        np.sqrt(
            mean_squared_error(
                X_normal_s, normal_recon
            )
        )
    )

    metrics["reconstruction_r2_normal"] = float(
        r2_score(
            X_normal_s, normal_recon
        )
    )

    print("\n========== TEST FINAL ==========")
    print(f"Accuracy  : {metrics['accuracy']:.4f}")
    print(f"Precision : {metrics['precision']:.4f}")
    print(f"Recall    : {metrics['recall']:.4f}")
    print(f"F1-score  : {metrics['f1_score']:.4f}")
    print(f"ROC-AUC   : {metrics['roc_auc']:.4f}")
    print(f"PR-AUC    : {metrics['pr_auc']:.4f}")

    print("\nConfusion Matrix [[TN, FP], [FN, TP]]")
    print(cm)

    print("\nDiagnostics de reconstruction :")
    print(
        f"MAE  : "
        f"{metrics['reconstruction_mae_normal']:.6f}"
    )
    print(
        f"RMSE : "
        f"{metrics['reconstruction_rmse_normal']:.6f}"
    )
    print(
        f"R²   : "
        f"{metrics['reconstruction_r2_normal']:.6f}"
    )

    (artifacts / "test_metrics.json").write_text(
        json.dumps(metrics, indent=2),
        encoding="utf-8",
    )

    pd.DataFrame({
        "truth_anomaly": y_true,
        "anomaly_score": scores,
        "prediction": y_pred,
    }).to_csv(
        artifacts / "test_predictions.csv",
        index=False,
    )

    # Matrice de confusion
    fig, ax = plt.subplots(figsize=(6, 5))
    ConfusionMatrixDisplay(
        confusion_matrix=cm,
        display_labels=["Normal", "Anomalie"],
    ).plot(ax=ax, values_format="d")
    ax.set_title("Matrice de confusion - Test final")
    fig.tight_layout()
    fig.savefig(
        artifacts / "confusion_matrix.png",
        dpi=160,
    )
    plt.close(fig)

    # ROC
    fig, ax = plt.subplots(figsize=(6, 5))
    RocCurveDisplay.from_predictions(
        y_true, scores, ax=ax
    )
    ax.set_title("ROC - Détection d'anomalies")
    fig.tight_layout()
    fig.savefig(
        artifacts / "roc_curve.png",
        dpi=160,
    )
    plt.close(fig)

    # Precision / Recall
    fig, ax = plt.subplots(figsize=(6, 5))
    PrecisionRecallDisplay.from_predictions(
        y_true, scores, ax=ax
    )
    ax.set_title("Precision-Recall")
    fig.tight_layout()
    fig.savefig(
        artifacts / "precision_recall_curve.png",
        dpi=160,
    )
    plt.close(fig)

    print("\nRésultats enregistrés dans :", artifacts)


if __name__ == "__main__":
    main()
