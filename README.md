# Détection d'anomalies IoT avec Edge AI
## Dataset fourni par le professeur

### Variables utilisées

Le modèle utilise uniquement les quatre mesures directement compréhensibles comme capteurs :

- Temperature
- Humidity
- Light
- CO2

`Occupancy` n'est PAS utilisé comme label d'anomalie.

`HumidityRatio` est laissé de côté dans le prototype car il est dérivé principalement de la température et de l'humidité, et l'application de démonstration doit permettre une saisie simple.

---

## Méthode

Le dataset ne fournit pas de colonne `Anomaly`.

La méthode retenue est donc :

1. apprendre le comportement réel fourni par le professeur avec un Autoencoder ;
2. ne modifier aucune donnée d'entraînement ;
3. créer des anomalies contrôlées uniquement pour la validation et le test ;
4. utiliser la validation pour choisir le seuil d'anomalie ;
5. conserver `datatest2.txt` comme test final.

### Découpage

```text
datatraining.txt
    -> entraînement du comportement normal

datatest.txt
    -> validation
    -> choix du seuil

datatest2.txt
    -> test final
    -> Accuracy / Precision / Recall / F1 / ROC-AUC
```

---

## Pourquoi un Autoencoder ?

Entrée :

```text
Temperature
Humidity
Light
CO2
```

Architecture :

```text
4 -> 16 -> 3 -> 16 -> 4
```

Le réseau essaie de reconstruire les valeurs normales.

```text
faible erreur de reconstruction
        -> NORMAL

forte erreur de reconstruction
        -> ANOMALIE
```

Le modèle ne contient que quelques centaines de paramètres : il est volontairement petit pour le futur déploiement Edge.

---

## Installation

Placez dans ce dossier :

```text
datatraining.txt
datatest.txt
datatest2.txt
```

Puis :

```bash
python -m venv .venv
```

Windows :

```bash
.venv\Scripts\activate
```

Puis :

```bash
pip install -r requirements.txt
```

---

## 1. Entraîner le modèle

```bash
python train_model.py
```

Cela crée :

```mermaid
graph LR
    artifacts[(artifacts/)] --- autoencoder_state[📄 autoencoder_state.pt]
    artifacts --- autoencoder_torchscript[📄 autoencoder_torchscript.pt]
    artifacts --- edge_config[📄 edge_config.json]
    artifacts --- validation_metrics[📄 validation_metrics.json]
    artifacts --- training_history[📄 training_history.csv]
```

Si ONNX est installé, vous aurez aussi :

```text
autoencoder.onnx
```

C'est ce fichier qui sera pratique pour une future PWA JavaScript avec ONNX Runtime Web.

---

## 2. Tester le modèle

```bash
python test_model.py
```

Le script donne :

- Accuracy
- Precision
- Recall
- F1-score
- ROC-AUC
- PR-AUC
- matrice de confusion

et produit :

```text
artifacts/
├── test_metrics.json
├── test_predictions.csv
├── confusion_matrix.png
├── roc_curve.png
└── precision_recall_curve.png
```

---

## 3. Tester manuellement

```bash
python predict_manual.py
```

Exemple :

```text
Temperature: 22.4
Humidity: 30
Light: 430
CO2: 800
```

Le programme répond :

```text
Anomaly score : ...
Threshold     : ...
Résultat      : NORMAL / ANOMALIE
```

C'est exactement le comportement à reprendre ensuite dans l'application.

---

# Quelles métriques présenter ?

Pour la DÉTECTION D'ANOMALIES :

1. Accuracy
2. Precision
3. Recall
4. F1-score
5. ROC-AUC
6. PR-AUC
7. Confusion Matrix

Pour l'Autoencoder, on peut aussi donner :

- MAE
- RMSE
- R²

mais ils mesurent la qualité de reconstruction et ne remplacent pas Precision/Recall/F1.

---

# Formulation importante dans le rapport

> Le jeu de données fourni ne contient pas d'étiquette explicite d'anomalie. Les observations originales sont donc utilisées pour modéliser le comportement de référence. Des anomalies contrôlées sont introduites exclusivement dans les ensembles de validation et de test afin de mesurer objectivement la capacité du modèle à détecter des valeurs aberrantes. Les données d'entraînement originales ne sont pas modifiées.

---

# Edge AI

Le modèle est volontairement très léger.

Pour la démonstration :

```text
Utilisateur saisit les valeurs
        ->
application locale
        ->
modèle Edge
        ->
score d'anomalie
        ->
NORMAL / ANOMALIE
```

Dans un vrai système :

```text
capteurs
        ->
Raspberry Pi / passerelle Edge
        ->
même modèle
        ->
NORMAL / ANOMALIE
```

La source des nombres change, mais le modèle reste le même.
