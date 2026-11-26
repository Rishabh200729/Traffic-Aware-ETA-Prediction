from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_PATH = PROJECT_ROOT / "data" / "predictions.npz"
OUTPUT_DIR = PROJECT_ROOT / "outputs"


def main() -> None:
    with np.load(PREDICTIONS_PATH) as data:
        y_true = data["targets"]
        y_pred = data["lstm_predictions"]
        y_pers = (
            data["persistence_predictions"]
            if "persistence_predictions" in data
            else None
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_DIR / "eta_vs_truth.png"

    plt.figure(figsize=(10, 5))
    plt.plot(y_true[:200], label="Ground Truth", linewidth=2)
    plt.plot(y_pred[:200], label="LSTM Prediction", linestyle="--")
    if y_pers is not None:
        plt.plot(y_pers[:200], label="Persistence Baseline", linestyle=":", alpha=0.8)
    plt.title("Predicted Speed vs Ground Truth (First 200 Samples)")
    plt.xlabel("Sample")
    plt.ylabel("Speed (mph)")
    plt.legend()
    plt.grid(True)
    plt.tight_layout()
    plt.savefig(output_path)
    print(f"Plot saved to {output_path}")


if __name__ == "__main__":
    main()
