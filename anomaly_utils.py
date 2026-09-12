import numpy as np

FEATURES = ["Temperature", "Humidity", "Light", "CO2"]

def inject_controlled_anomalies(X, seed=42):
    """
    Crée UNE COPIE anormale de chaque observation uniquement pour
    la validation/test.

    Les données d'entraînement originales ne sont jamais modifiées.

    Types d'anomalies simulées :
    - température : dérive/pic de +/- 3 à 7 °C
    - humidité    : dérive/pic de +/- 12 à 30 points
    - lumière     : excès de +400 à +1200 lux
    - CO2         : excès de +700 à +2500 ppm

    70 % : un seul capteur perturbé
    30 % : deux capteurs perturbés
    """
    rng = np.random.default_rng(seed)
    A = np.asarray(X, dtype=np.float64).copy()

    for i in range(len(A)):
        n_bad = 1 if rng.random() < 0.70 else 2
        cols = rng.choice(4, size=n_bad, replace=False)

        for j in cols:
            if j == 0:  # Temperature
                A[i, j] += rng.choice([-1, 1]) * rng.uniform(3.0, 7.0)

            elif j == 1:  # Humidity
                A[i, j] += rng.choice([-1, 1]) * rng.uniform(12.0, 30.0)

            elif j == 2:  # Light
                A[i, j] += rng.uniform(400.0, 1200.0)

            elif j == 3:  # CO2
                A[i, j] += rng.uniform(700.0, 2500.0)

    return A


def robust_transform(X, center, scale):
    X = np.asarray(X, dtype=np.float32)
    center = np.asarray(center, dtype=np.float32)
    scale = np.asarray(scale, dtype=np.float32)
    scale = np.where(scale == 0, 1.0, scale)
    return (X - center) / scale
