import json
import sys
from pathlib import Path

import numpy as np
import torch
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from torch.utils.data import DataLoader, Dataset

sys.path.append(str(Path(__file__).resolve().parent.parent))

from model.lstm_model import LSTMETAModel


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = PROJECT_ROOT / "data" / "lstm_dataset.npz"
MODEL_PATH = PROJECT_ROOT / "models" / "lstm_eta_model.pth"
FEATURE_NAMES = ["speed", "tod_sin", "tod_cos", "dow_sin", "dow_cos"]


class ETADataset(Dataset):
    def __init__(self, x_values, y_values):
        self.X = torch.from_numpy(np.asarray(x_values, dtype=np.float32))
        self.y = torch.from_numpy(np.asarray(y_values, dtype=np.float32)).reshape(-1, 1)

    def __len__(self):
        return len(self.X)

    def __getitem__(self, idx):
        return self.X[idx], self.y[idx]


def _tabular_features(x_values: np.ndarray) -> np.ndarray:
    return np.concatenate(
        (x_values[:, :, 0], x_values[:, -1, 1:]),
        axis=1,
    ).astype(np.float32, copy=False)


def _metrics(targets, predictions):
    return {
        "mae": float(mean_absolute_error(targets, predictions)),
        "rmse": float(np.sqrt(mean_squared_error(targets, predictions))),
    }


def main() -> None:
    with np.load(DATA_PATH) as data:
        X_train = np.asarray(data["X_train"], dtype=np.float32)
        y_train = np.asarray(data["y_train"], dtype=np.float32)
        X_val = np.asarray(data["X_val"], dtype=np.float32)
        y_val = np.asarray(data["y_val"], dtype=np.float32)
        speed_mean = float(data["speed_mean"])
        speed_std = float(data["speed_std"])
        horizon_minutes = int(data["horizon_minutes"])
        num_sensors = int(data["num_sensors"])

    persistence_predictions = np.clip(
        X_val[:, -1, 0],
        2.0,
        100.0,
    ).astype(np.float32, copy=False)

    gradient_boosting = HistGradientBoostingRegressor(
        max_iter=200,
        max_depth=8,
        learning_rate=0.05,
        random_state=42,
    )
    gradient_boosting.fit(_tabular_features(X_train), y_train)
    gradient_boosting_predictions = gradient_boosting.predict(
        _tabular_features(X_val)
    ).astype(np.float32, copy=False)

    model = LSTMETAModel(
        input_dim=5,
        speed_mean=speed_mean,
        speed_std=speed_std,
    )
    state_dict = torch.load(MODEL_PATH, map_location="cpu", weights_only=True)
    model.load_state_dict(state_dict)
    model.eval()

    val_loader = DataLoader(
        ETADataset(X_val, y_val),
        batch_size=512,
        shuffle=False,
        num_workers=0,
    )
    lstm_parts = []
    with torch.no_grad():
        for x, _ in val_loader:
            lstm_parts.append(model(x).cpu().numpy().reshape(-1))
    lstm_predictions = np.concatenate(lstm_parts).astype(np.float32, copy=False)

    valid = (
        np.isfinite(y_val)
        & np.isfinite(persistence_predictions)
        & np.isfinite(gradient_boosting_predictions)
        & np.isfinite(lstm_predictions)
    )
    if not np.any(valid):
        raise ValueError("The chronological validation set contains no valid predictions")

    targets = y_val[valid]
    predictions = {
        "Persistence Baseline": persistence_predictions[valid],
        "HistGradientBoosting": gradient_boosting_predictions[valid],
        "LSTM": lstm_predictions[valid],
    }
    results = {
        model_name: _metrics(targets, model_predictions)
        for model_name, model_predictions in predictions.items()
    }
    baseline = results["Persistence Baseline"]
    improvement = {
        model_name: {
            metric: float(
                (baseline[metric] - results[model_name][metric])
                / baseline[metric]
                * 100.0
            )
            for metric in ("mae", "rmse")
        }
        for model_name in ("HistGradientBoosting", "LSTM")
    }

    print("Chronological Validation Benchmark (15-minute horizon)")
    print(
        f"{'Model':<24}{'MAE (mph)':>16}{'RMSE (mph)':>17}"
        f"{'MAE vs persist.':>17}{'RMSE vs persist.':>18}"
    )
    print(
        f"{'Persistence Baseline':<24}{baseline['mae']:>16.6f}"
        f"{baseline['rmse']:>17.6f}{'baseline':>17}{'baseline':>18}"
    )
    for model_name in ("HistGradientBoosting", "LSTM"):
        print(
            f"{model_name:<24}{results[model_name]['mae']:>16.6f}"
            f"{results[model_name]['rmse']:>17.6f}"
            f"{improvement[model_name]['mae']:>16.2f}%"
            f"{improvement[model_name]['rmse']:>17.2f}%"
        )
    print(f"Validation samples: {int(np.count_nonzero(valid))}")

    metrics = {
        "Persistence Baseline": {
            key: round(value, 6)
            for key, value in results["Persistence Baseline"].items()
        },
        "HistGradientBoosting": {
            key: round(value, 6)
            for key, value in results["HistGradientBoosting"].items()
        },
        "LSTM": {
            key: round(value, 6)
            for key, value in results["LSTM"].items()
        },
        "improvement_pct": {
            model_name: {
                metric: round(value, 4)
                for metric, value in model_improvement.items()
            }
            for model_name, model_improvement in improvement.items()
        },
        "horizon_minutes": horizon_minutes,
        "sensors_trained": num_sensors,
        "features": FEATURE_NAMES,
        "split": "chronological_80_20",
        "unit": "mph",
        "validation_samples": int(np.count_nonzero(valid)),
    }
    metrics_path = PROJECT_ROOT / "data" / "benchmark_metrics.json"
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    np.savez(
        PROJECT_ROOT / "data" / "predictions.npz",
        persistence_predictions=predictions["Persistence Baseline"],
        gradient_boosting_predictions=predictions["HistGradientBoosting"],
        lstm_predictions=predictions["LSTM"],
        targets=targets,
    )
    print(f"Benchmark metrics saved to {metrics_path}")


if __name__ == "__main__":
    main()
