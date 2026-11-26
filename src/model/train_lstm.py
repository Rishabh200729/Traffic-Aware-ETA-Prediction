import sys
from pathlib import Path

import numpy as np
import torch
from pytorch_lightning import Trainer
from pytorch_lightning.callbacks import ModelCheckpoint
from torch.utils.data import DataLoader, Dataset

sys.path.append(str(Path(__file__).resolve().parent.parent))

from model.lstm_model import LSTMETAModel


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = PROJECT_ROOT / "data" / "lstm_dataset.npz"
MODEL_DIR = PROJECT_ROOT / "models"
BATCH_SIZE = 512
EPOCHS = 18


class ETADataset(Dataset):
    def __init__(self, x_values, y_values):
        self.X = torch.from_numpy(np.asarray(x_values, dtype=np.float32))
        self.y = torch.from_numpy(np.asarray(y_values, dtype=np.float32)).reshape(-1, 1)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


def main() -> None:
    torch.manual_seed(42)
    with np.load(DATA_PATH) as data:
        train_ds = ETADataset(data["X_train"], data["y_train"])
        val_ds = ETADataset(data["X_val"], data["y_val"])
        speed_mean = float(data["speed_mean"])
        speed_std = float(data["speed_std"])

    train_loader = DataLoader(
        train_ds,
        batch_size=BATCH_SIZE,
        shuffle=True,
        num_workers=0,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=BATCH_SIZE,
        shuffle=False,
        num_workers=0,
    )

    model = LSTMETAModel(
        input_dim=5,
        hidden_dim=64,
        num_layers=2,
        dropout=0.1,
        lr=1e-3,
        speed_mean=speed_mean,
        speed_std=speed_std,
    )

    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    checkpoint = ModelCheckpoint(
        dirpath=MODEL_DIR,
        filename="lstm_eta_model_best",
        monitor="val_loss",
        mode="min",
        save_top_k=1,
        save_weights_only=True,
    )
    trainer = Trainer(
        max_epochs=EPOCHS,
        gradient_clip_val=1.0,
        accelerator="gpu" if torch.cuda.is_available() else "cpu",
        devices=1,
        callbacks=[checkpoint],
        logger=False,
        enable_progress_bar=True,
    )
    trainer.fit(model, train_loader, val_loader)

    if not checkpoint.best_model_path:
        raise RuntimeError("Training did not produce a best validation checkpoint")

    best_checkpoint = torch.load(
        checkpoint.best_model_path,
        map_location="cpu",
        weights_only=False,
    )
    model.load_state_dict(best_checkpoint["state_dict"])
    model_path = MODEL_DIR / "lstm_eta_model.pth"
    torch.save(model.state_dict(), model_path)
    print(f"Best checkpoint: {checkpoint.best_model_path}")
    print(f"Best validation loss: {checkpoint.best_model_score.item():.6f}")
    print(f"Saved best model weights to {model_path}")


if __name__ == "__main__":
    main()
