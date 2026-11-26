# 🚦 Traffic-Aware-ETA-Prediction-Using-Temporal-Deep-Learning
End-to-end deep learning system that predicts Estimated Time of Arrival (ETA) using real-world freeway sensor data (PEMS-BAY), deployed via FastAPI and Docker. Includes multi-segment route ETA simulation inspired by Uber's dispatch infrastructure.

---

## ✨ Project Highlights

* 📅**Real-time ETA Prediction** using 5-min interval PEMS-BAY traffic speed data
* 🧠 Deep Learning with PyTorch Lightning: LSTM-based model
* 🌎 Production-ready API: FastAPI + Pydantic + Docker
* 📊 Evaluation: MAE ≈ 0.026 min, RMSE ≈ 0.068 min
* ⚖️ Multi-segment Routing: /predict_route returns ETA for full route across multiple segments
* 🛠️ Route Simulation Support: /simulate_trip_eta predicts ETA from real sensor IDs using sensor_speed_map
* 📊 W&B Integration: Track MAE, RMSE, and prediction curves live

---

## Step-by-Step Implementation

### 1. Environment Setup

```bash
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Data Sources & Setup

To keep the repository lightweight and under GitHub file size limits, large data files (`pems-bay.h5`, `lstm_dataset.npz`, `predictions.npz`) are excluded from git tracking.

* **Primary Dataset**: [PEMS-BAY.h5 on Zenodo](https://zenodo.org/records/4263971) (or direct mirror from the [DCRNN repository](https://github.com/liyaguang/DCRNN)).
  - Contains 5-minute interval average speeds across 325 freeway sensors in the California Bay Area (May–July 2017, shape: `52116 × 325`).
  - Download and place the file at: `data/pems-bay.h5`.
* **Sensor Graph & Distances**:
  - `data/graph_sensor_locations_bay.csv`: Sensor IDs and GPS coordinates (included in repo).
  - `data/distances_bay_2017.csv`: Pairwise directed road network distances in meters (included in repo).
* **Generating Training Data**:
  - Run `python src/data/make_windows.py` to generate `data/lstm_dataset.npz` locally.

### 3. Data Inspection

```bash
python src/data/load_and_inspect.py
```

* Inspects range, shape: (52116, 325)
* Detects missing/zero speed values

### 4. Cleaning and Normalization

```bash
python src/data/clean_pems.py
```

* Replaces 0 with NaN, interpolates
* Normalizes speed data (optional)

Data Note:
To save GitHub storage, `data/cleaned_pems_bay.csv` is not included.

### 5. Create Model Input Windows

```bash
python src/data/make_windows.py
```

* Sliding window of 12 steps (1 hour) as input
* Simulates ETA (in minutes) = (1/speed) \* 60
* Filters outliers (ETA > 30 min)

### 6. Train LSTM Model (with W&B logging)

```bash
python src/model/train_lstm.py
```

* Uses PyTorch Lightning
* Logs to Weights & Biases (W&B)
    https://wandb.ai/nainikas-california-state-university-northridge/Traffic-Aware-ETA-Prediction-Using-Temporal-Deep-Learning?nw=nwusernainikas
* Saves model to models/lstm\_eta\_model.pth

### 7. Evaluate on Validation Set

```bash
python src/model/eval_lstm.py
```

* Logs MAE, RMSE
* Saves predictions to data/predictions.npz

### 8. Serve Model via FastAPI

```bash
uvicorn src.api.app:app --reload --reload-dir src
```

* `/predict` for single sensor
* `/predict_route` for multi-segment input
* `/simulate_trip_eta` for sensor ID-based routing

#### Example:

```json
{
  "segments": [
    [71.4, 71.6, 71.6, ..., 70.9],
    [65.4, 64.1, ..., 63.9],
    [58.3, ..., 57.8]
  ]
}
```

Returns:

```json
{
  "segment_etas": [0.84, 1.2, 1.5],
  "total_eta": 3.54
}
```

### 9. Dockerize API

```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt .
COPY src ./src
COPY models ./models
COPY data ./data
RUN pip install --no-cache-dir -r requirements.txt
EXPOSE 8000
CMD ["uvicorn", "src.api.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t eta-api .
docker run -p 8000:8000 eta-api
```

---

## Deployment

* Hugging Face Spaces (via Docker image)
[Nainikas/Traffic-Aware-ETA-Prediction-Using-Temporal-Deep-Learning](https://huggingface.co/spaces/Nainikas/Traffic-Aware-ETA-Prediction-Using-Temporal-Deep-Learning)
---

## Evaluation Metrics

```json
MAE:  0.026 minutes
RMSE: 0.068 minutes
```

---

## Future Work

* Add support for dynamic segment lengths
* Integrate GNN-based road graphs
* Use OpenStreetMap or simulated GPS traces for route pathing

---

## Screenshots 

* Swagger UI (/docs)
  ![Screenshot 2025-07-01 013617](https://github.com/user-attachments/assets/e51787f8-bc91-4a83-8a84-5efd786884da)

* Route ETA JSON input/output
    * Predict ETA
  ![Screenshot 2025-06-30 234911](https://github.com/user-attachments/assets/cd0dafda-87ed-46fc-9fa2-663d87fe2c0b)
    * Predict Route ETA
  ![Screenshot 2025-07-01 012127](https://github.com/user-attachments/assets/351af1d2-68f1-4201-aa83-7a359e4b0595)
    * Simulate Trip ETA
  ![image](https://github.com/user-attachments/assets/d4b3256a-70d1-4e3c-8d49-37c0e4d9b832)


* Graphs from eval\_lstm.py
  ![image](https://github.com/user-attachments/assets/cb6862f9-49e5-45cf-b848-016f2b58c2a6)

---

> ⚡ Ready to deploy | 📈 Evaluated | 📆 Reproducible | 🚀 Scalable
