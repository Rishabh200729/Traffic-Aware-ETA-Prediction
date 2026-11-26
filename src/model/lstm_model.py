import torch
import torch.nn as nn
import pytorch_lightning as pl


class LSTMETAModel(pl.LightningModule):
    def __init__(
        self,
        input_dim=5,
        hidden_dim=64,
        num_layers=2,
        dropout=0.0,
        lr=1e-3,
        speed_mean=60.0,
        speed_std=15.0,
    ):
        super().__init__()
        self.save_hyperparameters()
        self.register_buffer("speed_mean", torch.tensor(float(speed_mean)))
        self.register_buffer("speed_std", torch.tensor(float(speed_std)))

        self.lstm = nn.LSTM(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            dropout=dropout if num_layers > 1 else 0.0,
            batch_first=True,
        )
        self.fc = nn.Linear(hidden_dim, 1)
        nn.init.zeros_(self.fc.weight)
        nn.init.zeros_(self.fc.bias)

        self.loss_fn = nn.SmoothL1Loss(beta=1.0)
        self.lr = lr

    def forward(self, x):
        raw_speed = x[:, :, 0:1]
        last_speed = torch.clamp(raw_speed[:, -1, 0], min=2.0, max=100.0)
        speed_norm = (raw_speed - self.speed_mean) / torch.clamp(
            self.speed_std,
            min=1e-6,
        )
        x_in = torch.cat([speed_norm, x[:, :, 1:]], dim=-1)
        out, _ = self.lstm(x_in)
        delta = self.fc(out[:, -1, :])
        return torch.clamp(
            last_speed + delta.squeeze(-1),
            min=2.0,
            max=100.0,
        ).unsqueeze(-1)

    def training_step(self, batch, batch_idx):
        x, y = batch
        loss = self.loss_fn(self(x), y)
        self.log("train_loss", loss)
        return loss

    def validation_step(self, batch, batch_idx):
        x, y = batch
        loss = self.loss_fn(self(x), y)
        self.log("val_loss", loss, prog_bar=True)
        return loss

    def configure_optimizers(self):
        optimizer = torch.optim.Adam(self.parameters(), lr=self.lr)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            optimizer,
            factor=0.5,
            patience=2,
        )
        return {
            "optimizer": optimizer,
            "lr_scheduler": {
                "scheduler": scheduler,
                "monitor": "val_loss",
            },
        }
