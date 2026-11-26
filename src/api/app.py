import json
import math
import sys
from pathlib import Path
from typing import List, Optional

import h5py
import numpy as np
import pandas as pd
import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, conlist, field_validator

# Add src/ to sys.path for model imports
sys.path.append(str(Path(__file__).resolve().parent.parent))

from model.lstm_model import LSTMETAModel
from src.data.road_graph import RoadGraph


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _resolve_hdf5_path() -> Path:
    data_dir = PROJECT_ROOT / "data"
    for path in data_dir.iterdir():
        if path.is_file() and path.name.lower() == "pems-bay.h5":
            return path
    raise FileNotFoundError(f"Could not find PEMS-BAY.h5 in {data_dir}")


def _clean_speed_matrix(speeds: np.ndarray) -> np.ndarray:
    """Causally forward-fill missing/zero entries without peeking at future steps."""
    cleaned = np.asarray(speeds, dtype=np.float32).copy()
    for column in range(cleaned.shape[1]):
        values = cleaned[:, column]
        valid = np.isfinite(values) & (values != 0.0)
        if not np.any(valid):
            values.fill(60.0)
            continue
        last_valid = float(values[np.argmax(valid)])
        for row in range(cleaned.shape[0]):
            if valid[row]:
                last_valid = float(values[row])
            else:
                values[row] = last_valid
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


def _legacy_input(speeds, timestamp: Optional[str] = None) -> torch.Tensor:
    end_ts = pd.to_datetime(timestamp) if timestamp else pd.Timestamp("2017-01-04T08:00:00")
    window_ts = pd.date_range(end=end_ts, periods=NETWORK_HISTORY_STEPS, freq="5min")
    x = np.empty((1, NETWORK_HISTORY_STEPS, 5), dtype=np.float32)
    x[0, :, 0] = np.asarray(speeds, dtype=np.float32)
    x[0, :, 1:] = _cyclical_time_features(window_ts)
    return torch.from_numpy(x)


# Load trained LSTM model
model = LSTMETAModel(input_dim=5)
model.load_state_dict(
    torch.load(
        PROJECT_ROOT / "models" / "lstm_eta_model.pth",
        map_location=torch.device("cpu"),
        weights_only=True,
    )
)
model.eval()

# Create FastAPI app
app = FastAPI(
    title="Traffic-Aware ETA Prediction API",
    version="1.0",
    description="Predicts ETA using LSTM on historical traffic speed data",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

road_graph = RoadGraph()
NETWORK_TOTAL_STEPS = 288
NETWORK_HISTORY_STEPS = 12

with h5py.File(_resolve_hdf5_path(), "r") as h5:
    speed_group = h5["speed"]
    replay_start = 864 - (NETWORK_HISTORY_STEPS - 1)
    replay_end = 864 + NETWORK_TOTAL_STEPS
    replay_speeds = _clean_speed_matrix(
        speed_group["block0_values"][replay_start:replay_end]
    )
    replay_timestamps = pd.DatetimeIndex(
        pd.to_datetime(speed_group["axis1"][replay_start:replay_end])
    )
    h5_speeds = replay_speeds[NETWORK_HISTORY_STEPS - 1:]
    replay_time_features = _cyclical_time_features(replay_timestamps)
    h5_sensor_ids = [
        str(raw_id.decode("utf-8") if isinstance(raw_id, bytes) else raw_id)
        for raw_id in speed_group["block0_items"][:]
    ]

h5_sensor_to_index = {
    sensor_id: idx for idx, sensor_id in enumerate(h5_sensor_ids)
}
network_sensor_ids = [
    sensor_id for sensor_id in road_graph.sensors
    if sensor_id in h5_sensor_to_index
]

if len(network_sensor_ids) != len(road_graph.sensors):
    missing_count = len(road_graph.sensors) - len(network_sensor_ids)
    raise RuntimeError(
        f"Sensor alignment failed: {missing_count} graph sensors missing from HDF5"
    )

predicted_speeds_by_step = {}
with torch.no_grad():
    for step in range(NETWORK_TOTAL_STEPS):
        input_values = np.empty(
            (len(network_sensor_ids), NETWORK_HISTORY_STEPS, 5),
            dtype=np.float32,
        )
        input_values[:, :, 0] = replay_speeds[
            step:step + NETWORK_HISTORY_STEPS,
            [h5_sensor_to_index[sensor_id] for sensor_id in network_sensor_ids],
        ].T
        input_values[:, :, 1:] = replay_time_features[
            step:step + NETWORK_HISTORY_STEPS
        ][None, :, :]
        x = torch.from_numpy(input_values)
        predicted_mph = np.clip(
            model(x).detach().cpu().numpy().reshape(-1),
            2.0,
            100.0,
        )
        predicted_speeds_by_step[step] = {
            sensor_id: float(predicted_mph[idx])
            for idx, sensor_id in enumerate(network_sensor_ids)
        }

predicted_speeds_list = [
    predicted_speeds_by_step[step] for step in range(NETWORK_TOTAL_STEPS)
]


# ==== Schemas ====

def _check_speed_list(values: List[float]) -> None:
    for v in values:
        if not math.isfinite(v) or v < 1.0 or v > 120.0:
            raise ValueError(
                "All speeds must be finite numbers between 1.0 and 120.0 mph"
            )


class SpeedSequence(BaseModel):
    speeds: conlist(float, min_length=12, max_length=12)
    timestamp: Optional[str] = None

    @field_validator("speeds")
    @classmethod
    def validate_speeds(cls, values: List[float]) -> List[float]:
        _check_speed_list(values)
        return values


class MultiSegmentInput(BaseModel):
    segments: List[conlist(float, min_length=12, max_length=12)]
    timestamp: Optional[str] = None

    @field_validator("segments")
    @classmethod
    def validate_segments(cls, segments: List[List[float]]) -> List[List[float]]:
        for segment in segments:
            _check_speed_list(segment)
        return segments


class RouteCompareInput(BaseModel):
    origin_id: str
    destination_id: str
    step: int


class TripPathInput(BaseModel):
    route: List[str]
    step: int = 0


# ==== Existing routes ====

@app.get("/")
def health_check():
    return {"status": "ok", "message": "ETA predictor is running."}


@app.post("/predict")
def predict_eta(data: SpeedSequence):
    try:
        x_tensor = _legacy_input(data.speeds, timestamp=data.timestamp)

        with torch.no_grad():
            predicted_mph = model(x_tensor).item()

        eta_minutes = 60.0 / max(predicted_mph, 2.0)
        return {"predicted_eta_minutes": round(eta_minutes, 2)}

    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid input: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Prediction failed: {str(e)}")


@app.post("/predict_route")
def predict_route_eta(data: MultiSegmentInput):
    try:
        segment_etas = []

        for speeds in data.segments:
            x_tensor = _legacy_input(speeds, timestamp=data.timestamp)

            with torch.no_grad():
                predicted_mph = model(x_tensor).item()
                eta = 60.0 / max(predicted_mph, 2.0)
                segment_etas.append(round(eta, 2))

        total_eta = round(sum(segment_etas), 2)
        return {
            "segment_etas": segment_etas,
            "total_eta": total_eta,
        }

    except ValueError as e:
        raise HTTPException(status_code=422, detail=f"Invalid input: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Route prediction failed: {str(e)}")


@app.post("/simulate_trip_eta")
def simulate_trip(data: TripPathInput):
    if data.step < 0 or data.step >= NETWORK_TOTAL_STEPS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid step {data.step}; step must be between 0 and {NETWORK_TOTAL_STEPS - 1}",
        )

    try:
        total_eta = 0.0
        segment_etas = []
        predicted_speeds = predicted_speeds_by_step[data.step]

        for sensor_id in data.route:
            sid = str(sensor_id).strip()
            if sid not in predicted_speeds:
                raise HTTPException(
                    status_code=400,
                    detail=f"Sensor {sensor_id} is missing from the road network",
                )

            eta = 60.0 / max(predicted_speeds[sid], 2.0)
            segment_etas.append(round(eta, 2))
            total_eta += eta

        return {
            "segment_etas": segment_etas,
            "total_eta": round(total_eta, 2),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Trip simulation failed: {str(e)}")


# ==== New network routes ====

@app.get("/network/snapshot")
def network_snapshot(step: int):
    if step < 0 or step >= NETWORK_TOTAL_STEPS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid step {step}; step must be between 0 and {NETWORK_TOTAL_STEPS - 1}",
        )

    predicted_speeds = predicted_speeds_by_step[step]
    sensors = []
    for sensor_id in network_sensor_ids:
        sensor = road_graph.sensors[sensor_id]
        source_idx = h5_sensor_to_index[sensor_id]
        sensors.append(
            {
                "sensor_id": sensor_id,
                "lat": sensor.lat,
                "lng": sensor.lng,
                "current_speed": round(float(h5_speeds[step, source_idx]), 3),
                "predicted_speed": round(predicted_speeds[sensor_id], 3),
            }
        )

    return {
        "step": step,
        "total_steps": NETWORK_TOTAL_STEPS,
        "sensors": sensors,
    }


@app.post("/route/compare")
def route_compare(data: RouteCompareInput):
    origin_id = str(data.origin_id).strip()
    destination_id = str(data.destination_id).strip()

    if road_graph.get_sensor(origin_id) is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown origin sensor ID: {origin_id}",
        )
    if road_graph.get_sensor(destination_id) is None:
        raise HTTPException(
            status_code=404,
            detail=f"Unknown destination sensor ID: {destination_id}",
        )
    if data.step < 0 or data.step >= NETWORK_TOTAL_STEPS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid step {data.step}; step must be between 0 and {NETWORK_TOTAL_STEPS - 1}",
        )

    shortest_distance_route = road_graph.shortest_path(
        origin_id,
        destination_id,
    )
    if shortest_distance_route is None:
        raise HTTPException(
            status_code=404,
            detail=f"No reachable directed route from {origin_id} to {destination_id}",
        )

    predicted_fastest_route = road_graph.shortest_path(
        origin_id,
        destination_id,
        speed_maps_by_step=predicted_speeds_list,
        start_step=data.step,
    )
    if predicted_fastest_route is None:
        raise HTTPException(
            status_code=404,
            detail=f"No reachable directed route from {origin_id} to {destination_id}",
        )

    distance_eta = road_graph.route_eta(
        shortest_distance_route["sensor_ids"],
        speed_maps_by_step=predicted_speeds_list,
        start_step=data.step,
    )
    if distance_eta is None:
        raise HTTPException(
            status_code=404,
            detail="Route contained an unavailable road segment",
        )

    shortest_distance_route["total_eta_minutes"] = distance_eta
    predicted_eta = float(predicted_fastest_route["total_eta_minutes"])
    time_saved = round(distance_eta - predicted_eta, 2)

    return {
        "shortest_distance_route": shortest_distance_route,
        "predicted_fastest_route": predicted_fastest_route,
        "time_saved_minutes": time_saved,
        "routes_differ": (
            shortest_distance_route["sensor_ids"]
            != predicted_fastest_route["sensor_ids"]
        ),
    }


@app.get("/metrics/benchmark")
def benchmark_metrics():
    metrics_path = PROJECT_ROOT / "data" / "benchmark_metrics.json"
    if not metrics_path.exists():
        raise HTTPException(
            status_code=404,
            detail="Benchmark metrics have not been generated yet",
        )
    with metrics_path.open("r", encoding="utf-8") as f:
        return json.load(f)
