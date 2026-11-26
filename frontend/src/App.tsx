import { useEffect, useState } from 'react'
import './App.css'
import { API_BASE, apiRequest } from './api'
import TrafficMap from './components/TrafficMap'
import type {
  BenchmarkMetrics,
  NetworkSnapshot,
  RouteComparison,
} from './types'

const TOTAL_STEPS = 288
const RUSH_HOUR_STEP = 84
const DEMO_ORIGIN = '400030'
const DEMO_DESTINATION = '409529'

interface SensorSelection {
  originId: string | null
  destinationId: string | null
}

function formatClock(step: number) {
  const totalMinutes = step * 5
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : 'An unexpected request error occurred.'
}

function App() {
  const [step, setStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [selection, setSelection] = useState<SensorSelection>({
    originId: null,
    destinationId: null,
  })
  const [comparison, setComparison] = useState<RouteComparison | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeRefresh, setRouteRefresh] = useState(0)
  const [metrics, setMetrics] = useState<BenchmarkMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const originId = selection.originId
  const destinationId = selection.destinationId

  useEffect(() => {
    const controller = new AbortController()

    const timeout = window.setTimeout(() => {
      setSnapshotLoading(true)
      setSnapshotError(null)
      void apiRequest<NetworkSnapshot>(
        `/network/snapshot?step=${step}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (controller.signal.aborted) return
          setSnapshot(result)
          setSnapshotError(null)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setSnapshotError(describeError(error))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSnapshotLoading(false)
          }
        })
    }, 140)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [step])

  useEffect(() => {
    const controller = new AbortController()
    void apiRequest<BenchmarkMetrics>(
      '/metrics/benchmark',
      { signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) return
        setMetrics(result)
        setMetricsError(null)
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMetricsError(describeError(error))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setMetricsLoading(false)
        }
      })

    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    if (!originId || !destinationId) {
      return () => controller.abort()
    }

    const timeout = window.setTimeout(() => {
      setRouteLoading(true)
      void apiRequest<RouteComparison>('/route/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin_id: originId,
          destination_id: destinationId,
          step,
        }),
        signal: controller.signal,
      })
        .then((result) => {
          if (controller.signal.aborted) return
          setComparison(result)
          setRouteError(null)
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            setComparison(null)
            setRouteError(describeError(error))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setRouteLoading(false)
          }
        })
    }, 110)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [originId, destinationId, step, routeRefresh])

  useEffect(() => {
    if (!isPlaying) return
    const interval = window.setInterval(() => {
      setSnapshotLoading(true)
      if (originId && destinationId) {
        setComparison(null)
        setRouteError(null)
        setRouteLoading(true)
      }
      setStep((current) => (current + 1) % TOTAL_STEPS)
    }, 1100)
    return () => window.clearInterval(interval)
  }, [isPlaying, originId, destinationId])

  function selectSensor(sensorId: string) {
    setComparison(null)
    setRouteError(null)
    setRouteLoading(Boolean(selection.originId && !selection.destinationId))
    setSelection((current) => {
      if (!current.originId || current.destinationId) {
        return { originId: sensorId, destinationId: null }
      }
      return { originId: current.originId, destinationId: sensorId }
    })
  }

  function clearRoute() {
    setSelection({ originId: null, destinationId: null })
    setComparison(null)
    setRouteError(null)
    setRouteLoading(false)
  }

  function loadRushHourDemo() {
    setIsPlaying(false)
    if (step !== RUSH_HOUR_STEP) {
      setSnapshotLoading(true)
      setStep(RUSH_HOUR_STEP)
    }
    setSelection({
      originId: DEMO_ORIGIN,
      destinationId: DEMO_DESTINATION,
    })
    setComparison(null)
    setRouteError(null)
    setRouteLoading(true)
    setRouteRefresh((current) => current + 1)
  }

  const routeReady = Boolean(originId && destinationId)
  const currentClock = formatClock(step)
  const snapshotBusy =
    snapshotLoading || (!snapshotError && snapshot?.step !== step)

  function changeStep(nextStep: number) {
    setSnapshotLoading(true)
    if (routeReady) {
      setComparison(null)
      setRouteError(null)
      setRouteLoading(true)
    }
    setStep(nextStep)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Bay Flow home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-copy">
            <strong>BAY / FLOW</strong>
            <small>TRAFFIC INTELLIGENCE</small>
          </span>
        </a>
        <div className="topbar-center">
          <span className={`service-indicator ${snapshotError ? 'is-error' : ''}`} />
          <span>{snapshotError ? 'API CONNECTION ISSUE' : 'NETWORK FEED'}</span>
          <span className="topbar-divider" />
          <code>{API_BASE}</code>
        </div>
        <div className="topbar-date">
          <span>REPLAY DATE</span>
          <strong>WED · JAN 04, 2017</strong>
        </div>
      </header>

      <section className="page-heading">
        <div>
          <p className="eyebrow">PEMS-BAY / SPATIO-TEMPORAL FORECAST</p>
          <h1>Traffic, in motion.</h1>
          <p className="page-subtitle">
            Explore network conditions and compare travel paths across the Bay Area.
          </p>
        </div>
        <div className="heading-stats" aria-label="Network overview">
          <div className="heading-stat">
            <strong>325</strong>
            <span>SENSORS</span>
          </div>
          <div className="heading-stat">
            <strong>15<span>MIN</span></strong>
            <span>FORECAST HORIZON</span>
          </div>
          <div className="heading-stat">
            <strong>05<span>MIN</span></strong>
            <span>REPLAY INTERVAL</span>
          </div>
        </div>
      </section>

      <section className="playback-panel" aria-label="Weekday replay controls">
        <div className="playback-title">
          <span className="section-index">01</span>
          <div>
            <p className="eyebrow">WEEKDAY REPLAY</p>
            <strong>{currentClock}</strong>
          </div>
        </div>
        <button
          className="play-button"
          type="button"
          onClick={() => setIsPlaying((playing) => !playing)}
          aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
        >
          <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
          {isPlaying ? 'PAUSE' : 'PLAY'}
        </button>
        <div className="slider-wrap">
          <div className="slider-labels">
            <span>00:00</span>
            <span>06:00</span>
            <span>12:00</span>
            <span>18:00</span>
            <span>23:55</span>
          </div>
          <input
            aria-label="Replay time"
            className="time-slider"
            type="range"
            min="0"
            max={TOTAL_STEPS - 1}
            step="1"
            value={step}
            style={{
              background: `linear-gradient(90deg, var(--green) ${(step / (TOTAL_STEPS - 1)) * 100}%, #d7dddc ${(step / (TOTAL_STEPS - 1)) * 100}%) center / 100% 3px no-repeat`,
            }}
            onChange={(event) => changeStep(Number(event.target.value))}
          />
        </div>
        <div className="playback-actions">
          <span className={`data-state ${snapshotBusy ? 'is-loading' : ''}`}>
            <span />
            {snapshotBusy ? 'UPDATING' : `${snapshot?.sensors.length ?? 0} NODES`}
          </span>
          <button className="demo-button" type="button" onClick={loadRushHourDemo}>
            <span aria-hidden="true">↗</span>
            Load Rush-Hour Demo <b>07:00</b>
          </button>
        </div>
      </section>

      {snapshotError && (
        <div className="alert-banner" role="alert">
          <strong>Network snapshot unavailable.</strong>
          <span>{snapshotError}</span>
        </div>
      )}

      <section className="dashboard-grid">
        <section className="panel map-panel" aria-labelledby="map-title">
          <div className="panel-heading map-heading">
            <div className="panel-heading-title">
              <span className="section-index">02</span>
              <div>
                <p className="eyebrow">LIVE NETWORK / STEP {String(step).padStart(3, '0')}</p>
                <h2 id="map-title">Bay Area sensor map</h2>
              </div>
            </div>
            <div className="speed-legend" aria-label="Predicted speed legend">
              <span><i className="legend-dot speed-green" />55+ mph</span>
              <span><i className="legend-dot speed-amber" />35–54 mph</span>
              <span><i className="legend-dot speed-red" />&lt;35 mph</span>
            </div>
          </div>
          <div className="map-frame">
            <TrafficMap
              sensors={snapshot?.sensors ?? []}
              comparison={comparison}
              originId={originId}
              destinationId={destinationId}
              onSensorSelect={selectSensor}
            />
            {snapshotBusy && snapshot && (
              <div className="map-refresh" role="status">Refreshing step {step}…</div>
            )}
            {!snapshot && snapshotBusy && (
              <div className="map-loading" role="status">Loading 325 sensor positions…</div>
            )}
            <div className="map-scale">BAY AREA · CALIFORNIA</div>
          </div>
          <div className="map-footer">
            <p>
              {routeReady
                ? 'Select another sensor to start a new origin–destination pair.'
                : 'Select a sensor on the map: first click sets origin, second sets destination.'}
            </p>
            <div className="route-line-legend">
              <span><i className="route-swatch shortest-swatch" />Shortest distance</span>
              <span><i className="route-swatch fastest-swatch" />Predicted fastest</span>
            </div>
          </div>
        </section>

        <aside className="sidebar">
          <section className="panel route-panel" aria-labelledby="route-title">
            <div className="panel-heading">
              <div className="panel-heading-title">
                <span className="section-index">03</span>
                <div>
                  <p className="eyebrow">LSTM ROUTE PLANNER</p>
                  <h2 id="route-title">Route comparison</h2>
                </div>
              </div>
              <button
                className="text-button"
                type="button"
                onClick={clearRoute}
                disabled={!originId && !destinationId}
              >
                Clear route
              </button>
            </div>

            <div className="route-selection">
              <div className={`selection-item ${originId ? 'is-selected origin-selected' : ''}`}>
                <span className="selection-symbol origin-symbol">A</span>
                <div>
                  <small>ORIGIN</small>
                  <strong>{originId ?? 'Choose a sensor'}</strong>
                </div>
                {originId && <span className="selection-check">SET</span>}
              </div>
              <div className="selection-connector" />
              <div className={`selection-item ${destinationId ? 'is-selected destination-selected' : ''}`}>
                <span className="selection-symbol destination-symbol">B</span>
                <div>
                  <small>DESTINATION</small>
                  <strong>{destinationId ?? 'Choose a sensor'}</strong>
                </div>
                {destinationId && <span className="selection-check">SET</span>}
              </div>
            </div>

            {routeError && (
              <div className="inline-alert" role="alert">
                <strong>Route unavailable</strong>
                <span>{routeError}</span>
              </div>
            )}
            {routeLoading && routeReady && (
              <div className="route-loading" role="status">
                <span className="loading-bar" />
                Recalculating for {currentClock}…
              </div>
            )}

            {comparison && !routeLoading ? (
              <div className="comparison-content">
                <div className="route-result-heading">
                  <span>RESULTS AT {currentClock}</span>
                  {comparison.routes_differ && (
                    <span className="difference-badge">ROUTES DIFFER</span>
                  )}
                </div>
                <div className="table-scroll">
                  <table className="route-table">
                    <thead>
                      <tr>
                        <th>ROUTE</th>
                        <th>DISTANCE</th>
                        <th>ETA</th>
                        <th>HOPS</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">
                          <span className="table-route-label shortest-label">
                            Shortest<br />distance
                          </span>
                        </th>
                        <td>{comparison.shortest_distance_route.total_distance_miles.toFixed(2)}<small> mi</small></td>
                        <td>{comparison.shortest_distance_route.total_eta_minutes.toFixed(2)}<small> min</small></td>
                        <td>{comparison.shortest_distance_route.hops}</td>
                      </tr>
                      <tr>
                        <th scope="row">
                          <span className="table-route-label fastest-label">
                            Predicted<br />fastest
                          </span>
                        </th>
                        <td>{comparison.predicted_fastest_route.total_distance_miles.toFixed(2)}<small> mi</small></td>
                        <td>{comparison.predicted_fastest_route.total_eta_minutes.toFixed(2)}<small> min</small></td>
                        <td>{comparison.predicted_fastest_route.hops}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="time-saved-row">
                  <span>TIME SAVED ON FASTEST ROUTE</span>
                  <strong>{comparison.time_saved_minutes > 0 ? '+' : ''}{comparison.time_saved_minutes.toFixed(2)} <small>min</small></strong>
                </div>
                <p className="selection-hint">A third map selection starts a new route pair.</p>
              </div>
            ) : !routeReady && !routeError ? (
              <div className="route-empty">
                <span className="empty-route-icon" aria-hidden="true">A ─── B</span>
                <p>Select two sensors or load the rush-hour demo to compare routes.</p>
              </div>
            ) : null}
          </section>

          <section className="panel benchmark-panel" aria-labelledby="benchmark-title">
            <div className="panel-heading">
              <div className="panel-heading-title">
                <span className="section-index">04</span>
                <div>
                  <p className="eyebrow">CHRONOLOGICAL VALIDATION</p>
                  <h2 id="benchmark-title">Model benchmark</h2>
                </div>
              </div>
              <span className="horizon-tag">{metrics?.horizon_minutes ?? 15} MIN</span>
            </div>

            {metricsError && (
              <div className="inline-alert metrics-alert" role="alert">
                <strong>Benchmark unavailable</strong>
                <span>{metricsError}</span>
              </div>
            )}
            {metricsLoading ? (
              <p className="benchmark-loading" role="status">Loading benchmark metrics…</p>
            ) : metrics ? (
              <>
                <div className="table-scroll">
                  <table className="benchmark-table">
                    <thead>
                      <tr>
                        <th>MODEL</th>
                        <th>MAE ({(metrics.unit ?? 'min').toUpperCase()})</th>
                        <th>RMSE ({(metrics.unit ?? 'min').toUpperCase()})</th>
                        <th>VS BASELINE</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Persistence</th>
                        <td>{metrics['Persistence Baseline'].mae.toFixed(4)}</td>
                        <td>{metrics['Persistence Baseline'].rmse.toFixed(4)}</td>
                        <td className="baseline-cell">REFERENCE</td>
                      </tr>
                      <tr>
                        <th scope="row">HistGradientBoosting</th>
                        <td>{metrics.HistGradientBoosting.mae.toFixed(4)}</td>
                        <td>{metrics.HistGradientBoosting.rmse.toFixed(4)}</td>
                        <td className="improvement-cell">
                          MAE −{metrics.improvement_pct.HistGradientBoosting.mae.toFixed(2)}%<br />
                          RMSE −{metrics.improvement_pct.HistGradientBoosting.rmse.toFixed(2)}%
                        </td>
                      </tr>
                      <tr className="lstm-row">
                        <th scope="row">Residual LSTM</th>
                        <td>{metrics.LSTM.mae.toFixed(4)}</td>
                        <td>{metrics.LSTM.rmse.toFixed(4)}</td>
                        <td className="improvement-cell">
                          MAE −{metrics.improvement_pct.LSTM.mae.toFixed(2)}%<br />
                          RMSE −{metrics.improvement_pct.LSTM.rmse.toFixed(2)}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="benchmark-meta">
                  <div><strong>{metrics.sensors_trained}</strong><span>SENSORS</span></div>
                  <div><strong>{metrics.validation_samples.toLocaleString()}</strong><span>VALIDATION WINDOWS</span></div>
                  <div><strong>{metrics.features.length}</strong><span>INPUT FEATURES</span></div>
                  <div><strong>{metrics.split === 'chronological_80_20' ? '80 / 20' : metrics.split}</strong><span>CHRONOLOGICAL SPLIT</span></div>
                </div>
                <div className="feature-list" aria-label="Model input features">
                  {metrics.features.map((feature) => (
                    <span key={feature}>{feature.replaceAll('_', ' ')}</span>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </aside>
      </section>

      <footer className="page-footer">
        <span>PEMS-BAY TRAFFIC FORECASTING</span>
        <span>12-STEP HISTORY · 5-MIN INTERVAL · 15-MIN FORECAST</span>
        <span>API {snapshotError ? 'DISCONNECTED' : 'CONNECTED'}</span>
      </footer>
    </main>
  )
}

export default App
