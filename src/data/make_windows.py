from pathlib import Path

import h5py
import numpy as np
import pandas as pd


INPUT_STEPS = 12
PREDICT_STEP = 3
STRIDE = 12
NUM_SENSORS = 325
FEATURE_NAMES = ("speed", "tod_sin", "tod_cos", "dow_sin", "dow_cos")
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"


def _resolve_hdf5_path() -> Path:
    for path in DATA_DIR.iterdir():
        if path.is_file() and path.name.lower() == "pems-bay.h5":
            return path
    raise FileNotFoundError(f"Could not find PEMS-BAY.h5 in {DATA_DIR}")


def _sensor_id(value) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8")
    sensor_id = str(value)
    return sensor_id[:-2] if sensor_id.endswith(".0") else sensor_id


def _clean_speeds(speeds: np.ndarray) -> np.ndarray:
    cleaned = np.asarray(speeds, dtype=np.float32).copy()
    row_indices = np.arange(cleaned.shape[0])

    for column in range(cleaned.shape[1]):
        values = cleaned[:, column]
        valid = np.isfinite(values) & (values != 0.0)
        if not np.any(valid):
            values.fill(60.0)
            continue
        values[~valid] = np.interp(
            row_indices[~valid],
            row_indices[valid],
            values[valid],
        )

    return cleaned


def _cyclical_time_features(timestamps: pd.DatetimeIndex) -> np.ndarray:
    minutes = timestamps.hour * 60 + timestamps.minute
    day_of_week = timestamps.dayofweek
    return np.column_stack(
        (
            np.sin(2.0 * np.pi * minutes / 1440.0),
            np.cos(2.0 * np.pi * minutes / 1440.0),
            np.sin(2.0 * np.pi * day_of_week / 7.0),
            np.cos(2.0 * np.pi * day_of_week / 7.0),
        )
    ).astype(np.float32)


def _window_starts(period_length: int) -> np.ndarray:
    required_samples = INPUT_STEPS + PREDICT_STEP
    return np.arange(
        0,
        period_length - required_samples + 1,
        STRIDE,
        dtype=np.int64,
    )


def _fill_sensor_windows(
    output_x: np.ndarray,
    output_y: np.ndarray,
    offset: int,
    speeds: np.ndarray,
    time_features: np.ndarray,
    starts: np.ndarray,
) -> int:
    target_indices = starts + INPUT_STEPS + PREDICT_STEP - 1
    future_speeds = speeds[target_indices]
    valid = (future_speeds >= 2.0) & (future_speeds <= 100.0)
    valid_starts = starts[valid]
    count = len(valid_starts)
    if count == 0:
        return 0

    window_indices = valid_starts[:, None] + np.arange(INPUT_STEPS)
    end = offset + count
    output_x[offset:end, :, 0] = speeds[window_indices]
    output_x[offset:end, :, 1:] = time_features[window_indices]
    output_y[offset:end] = future_speeds[valid]
    return count


def main() -> None:
    hdf5_path = _resolve_hdf5_path()
    with h5py.File(hdf5_path, "r") as h5:
        speed_group = h5["speed"]
        speed_data = speed_group["block0_values"]
        sensor_ids = [_sensor_id(value) for value in speed_group["block0_items"][:]]
        timestamps = pd.DatetimeIndex(
            pd.to_datetime(speed_group["axis1"][:])
        )

        if len(sensor_ids) != speed_data.shape[1]:
            raise ValueError("HDF5 sensor IDs do not match the speed matrix columns")
        if len(timestamps) != speed_data.shape[0]:
            raise ValueError("HDF5 timestamps do not match the speed matrix rows")
        if "400001" not in sensor_ids:
            raise ValueError("Required PeMS-BAY sensor 400001 was not found")

        selected_sensor_ids = sensor_ids
        raw_speeds = np.asarray(speed_data[:], dtype=np.float32)

    time_features = _cyclical_time_features(timestamps)
    timestamp_split = int(len(timestamps) * 0.8)
    train_speeds = _clean_speeds(raw_speeds[:timestamp_split])
    val_speeds = _clean_speeds(raw_speeds[timestamp_split:])
    train_starts = _window_starts(timestamp_split)
    val_starts = _window_starts(len(timestamps) - timestamp_split)
    num_sensors = len(selected_sensor_ids)
    max_train_windows = len(train_starts) * num_sensors
    max_val_windows = len(val_starts) * num_sensors

    X_train_storage = np.empty(
        (max_train_windows, INPUT_STEPS, len(FEATURE_NAMES)),
        dtype=np.float32,
    )
    y_train_storage = np.empty(max_train_windows, dtype=np.float32)
    X_val_storage = np.empty(
        (max_val_windows, INPUT_STEPS, len(FEATURE_NAMES)),
        dtype=np.float32,
    )
    y_val_storage = np.empty(max_val_windows, dtype=np.float32)
    train_count = 0
    val_count = 0

    for sensor_index in range(num_sensors):
        train_count += _fill_sensor_windows(
            X_train_storage,
            y_train_storage,
            train_count,
            train_speeds[:, sensor_index],
            time_features[:timestamp_split],
            train_starts,
        )
        val_count += _fill_sensor_windows(
            X_val_storage,
            y_val_storage,
            val_count,
            val_speeds[:, sensor_index],
            time_features[timestamp_split:],
            val_starts,
        )

    if not train_count or not val_count:
        raise ValueError("Dataset generation produced an empty train or validation set")

    X_train = X_train_storage[:train_count]
    y_train = y_train_storage[:train_count]
    X_val = X_val_storage[:val_count]
    y_val = y_val_storage[:val_count]
    speed_mean = np.asarray(
        X_train[:, :, 0].mean(dtype=np.float64),
        dtype=np.float32,
    )
    speed_std = np.asarray(
        X_train[:, :, 0].std(dtype=np.float64),
        dtype=np.float32,
    )

    output_path = DATA_DIR / "lstm_dataset.npz"
    np.savez_compressed(
        output_path,
        X_train=X_train,
        y_train=y_train,
        X_val=X_val,
        y_val=y_val,
        speed_mean=speed_mean,
        speed_std=speed_std,
        horizon_steps=np.asarray(PREDICT_STEP, dtype=np.float32),
        horizon_minutes=np.asarray(PREDICT_STEP * 5, dtype=np.float32),
        num_sensors=np.asarray(num_sensors, dtype=np.float32),
        input_dim=np.asarray(len(FEATURE_NAMES), dtype=np.float32),
        target_unit=np.asarray("mph"),
    )

    print(f"Loaded data: {hdf5_path}")
    print(f"Selected sensors ({len(selected_sensor_ids)}): {', '.join(selected_sensor_ids)}")
    print(
        f"Timestamp split: {timestamp_split}/{len(timestamps)} "
        "(chronological 80/20)"
    )
    print(f"Features: {', '.join(FEATURE_NAMES)}")
    print(f"X_train: {X_train.shape}, y_train: {y_train.shape}")
    print(f"X_val:   {X_val.shape}, y_val:   {y_val.shape}")
    print(f"Training-only speed mean/std: {float(speed_mean):.6f}/{float(speed_std):.6f}")
    print(f"Saved dataset to {output_path}")


if __name__ == "__main__":
    main()
