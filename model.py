import torch
import torch.nn as nn

FEATURES = ["Temperature", "Humidity", "Light", "CO2"]

class TinyAutoEncoder(nn.Module):
    """
    Modèle Edge très léger :
    4 -> 16 -> 3 -> 16 -> 4

    Il apprend à reconstruire les comportements normaux.
    Une grande erreur de reconstruction = anomalie probable.
    """
    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(
            nn.Linear(4, 16),
            nn.LeakyReLU(0.1),
            nn.Linear(16, 3),
            nn.LeakyReLU(0.1),
        )
        self.decoder = nn.Sequential(
            nn.Linear(3, 16),
            nn.LeakyReLU(0.1),
            nn.Linear(16, 4),
        )

    def forward(self, x):
        return self.decoder(self.encoder(x))
