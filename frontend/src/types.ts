export interface Sensor {
  sensor_id: string
  lat: number
  lng: number
  current_speed: number
  predicted_speed: number
}

export interface NetworkSnapshot {
  step: number
  total_steps: number
  sensors: Sensor[]
}

export interface RouteCoordinate {
  sensor_id: string
  lat: number
  lng: number
}

export interface RouteResult {
  sensor_ids: string[]
  coordinates: RouteCoordinate[]
  hops: number
  total_distance_miles: number
  total_eta_minutes: number
}

export interface RouteComparison {
  shortest_distance_route: RouteResult
  predicted_fastest_route: RouteResult
  time_saved_minutes: number
  routes_differ: boolean
}

export interface ModelMetrics {
  mae: number
  rmse: number
}

export interface BenchmarkMetrics {
  'Persistence Baseline': ModelMetrics
  HistGradientBoosting: ModelMetrics
  LSTM: ModelMetrics
  improvement_pct: {
    HistGradientBoosting: ModelMetrics
    LSTM: ModelMetrics
  }
  horizon_minutes: number
  sensors_trained: number
  features: string[]
  split: string
  unit?: string
  validation_samples: number
}
