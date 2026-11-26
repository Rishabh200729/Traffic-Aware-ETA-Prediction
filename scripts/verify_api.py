import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

import numpy as np
from fastapi.testclient import TestClient

from src.api.app import (
    app,
    h5_sensor_to_index,
    h5_speeds,
    model,
    network_sensor_ids,
    replay_speeds,
    road_graph,
)


client = TestClient(app)
assert model.lstm.input_size == 5
print("PASS network model input: 5 features per time step")
sample_idx = h5_sensor_to_index["400001"]
assert np.isclose(replay_speeds[11, sample_idx], h5_speeds[0, sample_idx]), (
    "Replay history window does not end at h5_speeds[0]"
)
print("PASS replay horizon alignment: step 0 window ends at h5_speeds[0]")
sample_speeds = [
    71.4, 71.6, 71.6, 71.1, 71.7, 71.2,
    71.3, 70.5, 71.5, 70.7, 71.5, 70.9,
]


def check_status(label, response, expected=200):
    assert response.status_code == expected, (
        f"{label}: expected HTTP {expected}, got {response.status_code}: "
        f"{response.text}"
    )
    print(f"PASS {label}: HTTP {response.status_code}")
    return response


check_status("GET /", client.get("/"))
check_status(
    "POST /predict",
    client.post("/predict", json={"speeds": sample_speeds}),
)
check_status(
    "POST /predict invalid speeds (0.0)",
    client.post("/predict", json={"speeds": [0.0] * 12}),
    expected=422,
)
check_status(
    "POST /predict_route",
    client.post("/predict_route", json={"segments": [sample_speeds]}),
)
check_status(
    "POST /simulate_trip_eta",
    client.post(
        "/simulate_trip_eta",
        json={"route": ["400001", "400017", "409529"], "step": 84},
    ),
)

snapshot = check_status(
    "GET /network/snapshot?step=0",
    client.get("/network/snapshot", params={"step": 0}),
).json()
sensors = snapshot["sensors"]
assert len(sensors) == 325
assert all(
    all(
        np.isfinite(sensor[key])
        for key in ("lat", "lng", "current_speed", "predicted_speed")
    )
    for sensor in sensors
)
print("PASS snapshot contents: 325 sensors with finite coordinates and speeds")

reachable = check_status(
    "POST /route/compare reachable",
    client.post(
        "/route/compare",
        json={"origin_id": "400030", "destination_id": "409529", "step": 0},
    ),
).json()
for route_key in ("shortest_distance_route", "predicted_fastest_route"):
    route = reachable[route_key]
    assert route["hops"] > 0
    assert route["total_distance_miles"] > 0
    assert route["total_eta_minutes"] > 0
print(
    "PASS reachable route values: "
    f"{reachable['shortest_distance_route']['total_distance_miles']:.3f} mi, "
    f"{reachable['shortest_distance_route']['total_eta_minutes']:.2f} min"
)

sinks = [
    sensor_id
    for sensor_id, edges in road_graph.adjacency.items()
    if not edges and road_graph.shortest_path(sensor_id, "400030") is None
]
assert sinks, "Expected to find a directed sink unreachable to sensor 400030"
unreachable_origin = sinks[0]
unreachable = check_status(
    "POST /route/compare unreachable",
    client.post(
        "/route/compare",
        json={
            "origin_id": unreachable_origin,
            "destination_id": "400030",
            "step": 0,
        },
    ),
    expected=404,
)
assert "No reachable directed route" in unreachable.json()["detail"]
print(f"PASS unreachable route detail: {unreachable.json()['detail']}")

metrics = check_status(
    "GET /metrics/benchmark",
    client.get("/metrics/benchmark"),
).json()
assert "LSTM" in metrics and "Persistence Baseline" in metrics
assert "HistGradientBoosting" in metrics
assert "mae" in metrics["LSTM"] and "rmse" in metrics["LSTM"]
assert "mae" in metrics["Persistence Baseline"]
assert "rmse" in metrics["Persistence Baseline"]
assert "mae" in metrics["HistGradientBoosting"]
assert "rmse" in metrics["HistGradientBoosting"]
assert "HistGradientBoosting" in metrics["improvement_pct"]
assert "LSTM" in metrics["improvement_pct"]
print(
    "PASS benchmark response: "
    f"Persistence MAE={metrics['Persistence Baseline']['mae']:.6f}, "
    f"HistGradientBoosting MAE={metrics['HistGradientBoosting']['mae']:.6f}, "
    f"LSTM MAE={metrics['LSTM']['mae']:.6f}"
)

peak_steps = list(range(84, 121, 3)) + list(range(192, 229, 3))
candidate_ids = list(dict.fromkeys(
    ["400030", "409529"] + network_sensor_ids[::16]
))
found_peak_route = None
for step in peak_steps:
    for destination_id in candidate_ids:
        if destination_id == "400030":
            continue
        response = client.post(
            "/route/compare",
            json={
                "origin_id": "400030",
                "destination_id": destination_id,
                "step": step,
            },
        )
        if response.status_code == 200 and response.json()["routes_differ"]:
            found_peak_route = ("400030", destination_id, step)
            break
    if found_peak_route:
        break

assert found_peak_route, (
    "No routes_differ=True result found for candidate routes during peak hours"
)
print(
    "PASS peak-hour route divergence: "
    f"{found_peak_route[0]} -> {found_peak_route[1]} at step {found_peak_route[2]}"
)
print("API verification complete.")
