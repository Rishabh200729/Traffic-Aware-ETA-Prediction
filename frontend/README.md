# Bay / Flow

React + Vite traffic dashboard for the PeMS-BAY weekday replay and ETA route API.

## Run locally

Start the FastAPI backend from the repository root:

```powershell
.\venv\Scripts\python.exe -m uvicorn src.api.app:app --reload --host 127.0.0.1 --port 8000
```

In another terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The frontend defaults to
`http://localhost:8000`; set `VITE_API_BASE_URL` in a local `.env` file to
override it. The API must allow the frontend origin through CORS.

## Production build

```powershell
npm run build
```
