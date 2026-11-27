import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { apiRequest } from './api'
import BenchmarksPage from './components/BenchmarksPage'
import TrafficMap from './components/TrafficMap'
import type {
  BasemapTheme,
  BenchmarkMetrics,
  MapLayerMode,
  NetworkSnapshot,
  PlaybackSpeed,
  RouteComparison,
  RoutePreset,
} from './types'

type PageView = 'map' | 'benchmarks'

const TOTAL_STEPS = 288

const PLAYBACK_DELAYS: Record<PlaybackSpeed, number> = {
  1: 1100,
  2: 550,
  4: 275,
}

const TIME_JUMPS = [
  { label: '00:00', step: 0 },
  { label: '07:00', step: 84 },
  { label: '12:00', step: 144 },
  { label: '17:30', step: 210 },
]

const ROUTE_PRESETS: RoutePreset[] = [
  {
    id: 'am-rush',
    label: 'AM Rush',
    timeLabel: '07:00',
    step: 84,
    originId: '400065',
    destinationId: '400227',
  },
  {
    id: 'am-peak',
    label: 'AM Peak',
    timeLabel: '08:00',
    step: 96,
    originId: '400052',
    destinationId: '407186',
  },
  {
    id: 'pm-rush',
    label: 'PM Rush',
    timeLabel: '17:30',
    step: 210,
    originId: '400030',
    destinationId: '407186',
  },
]

interface SensorSelection {
  originId: string | null
  destinationId: string | null
}

function readHashPage(): PageView {
  return window.location.hash === '#/benchmarks' ? 'benchmarks' : 'map'
}

function formatClock(step: number) {
  const totalMinutes = step * 5
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function describeError(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'An unexpected request error occurred.'
}

function App() {
  const [activePage, setActivePage] = useState<PageView>(readHashPage)
  const [step, setStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1)
  const [layerMode, setLayerMode] = useState<MapLayerMode>('predicted')
  const [basemapTheme, setBasemapTheme] = useState<BasemapTheme>('light')
  const [fitRouteSignal, setFitRouteSignal] = useState(0)
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(true)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [selection, setSelection] = useState<SensorSelection>({
    originId: null,
    destinationId: null,
  })
  const [originDraft, setOriginDraft] = useState<string | null>(null)
  const [destinationDraft, setDestinationDraft] = useState<string | null>(null)
  const [comparison, setComparison] = useState<RouteComparison | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeRefresh, setRouteRefresh] = useState(0)
  const [metrics, setMetrics] = useState<BenchmarkMetrics | null>(null)
  const [metricsError, setMetricsError] = useState<string | null>(null)
  const [metricsLoading, setMetricsLoading] = useState(true)

  const pendingFitRef = useRef(false)
  const originId = selection.originId
  const destinationId = selection.destinationId

  useEffect(() => {
    function handleHashChange() {
      setActivePage(readHashPage())
    }
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  function navigateTo(page: PageView) {
    const targetHash = page === 'benchmarks' ? '#/benchmarks' : '#/'
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash
    }
    setActivePage(page)
  }

  useEffect(() => {
    const controller = new AbortController()

    const timeout = window.setTimeout(() => {
      setSnapshotLoading(true)
      setSnapshotError(null)
      void apiRequest<NetworkSnapshot>(`/network/snapshot?step=${step}`, {
        signal: controller.signal,
      })
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
    }, 120)

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [step])

  useEffect(() => {
    const controller = new AbortController()
    void apiRequest<BenchmarkMetrics>('/metrics/benchmark', {
      signal: controller.signal,
    })
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
          if (pendingFitRef.current) {
            pendingFitRef.current = false
            setFitRouteSignal((current) => current + 1)
          }
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            pendingFitRef.current = false
            setComparison(null)
            setRouteError(describeError(error))
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setRouteLoading(false)
          }
        })
    }, 90)

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
        setRouteError(null)
        setRouteLoading(true)
      }
      setStep((current) => (current + 1) % TOTAL_STEPS)
    }, PLAYBACK_DELAYS[playbackSpeed])
    return () => window.clearInterval(interval)
  }, [isPlaying, playbackSpeed, originId, destinationId])

  const sensorIdSet = useMemo(() => {
    return new Set((snapshot?.sensors ?? []).map((sensor) => sensor.sensor_id))
  }, [snapshot])

  const networkStats = useMemo(() => {
    const sensors = snapshot?.sensors ?? []
    if (sensors.length === 0) return null

    const useCurrent = layerMode === 'current'
    let sum = 0
    let congested = 0
    let slowestSensor = sensors[0]
    let slowestSpeed = useCurrent
      ? slowestSensor.current_speed
      : slowestSensor.predicted_speed

    for (const sensor of sensors) {
      const value = useCurrent ? sensor.current_speed : sensor.predicted_speed
      sum += value
      if (value < 35) congested += 1
      if (value < slowestSpeed) {
        slowestSpeed = value
        slowestSensor = sensor
      }
    }

    return {
      avgSpeed: sum / sensors.length,
      congestedCount: congested,
      slowestId: slowestSensor.sensor_id,
      slowestSpeed,
      metricLabel: useCurrent ? 'CURRENT' : '+15M FORECAST',
    }
  }, [snapshot, layerMode])

  function selectSensor(sensorId: string) {
    setRouteError(null)
    setOriginDraft(null)
    setDestinationDraft(null)
    setSelection((current) => {
      if (!current.originId || current.destinationId) {
        setComparison(null)
        setRouteLoading(false)
        return { originId: sensorId, destinationId: null }
      }
      if (sensorId === current.originId) {
        setComparison(null)
        setRouteLoading(false)
        return { originId: null, destinationId: null }
      }
      setRouteLoading(true)
      return { originId: current.originId, destinationId: sensorId }
    })
  }

  function commitSensorInput(kind: 'origin' | 'destination', rawValue: string) {
    const trimmed = rawValue.trim()
    if (kind === 'origin') setOriginDraft(null)
    else setDestinationDraft(null)

    if (!trimmed) {
      setComparison(null)
      setRouteError(null)
      setRouteLoading(false)
      setSelection((current) =>
        kind === 'origin'
          ? { originId: null, destinationId: current.destinationId }
          : { originId: current.originId, destinationId: null },
      )
      return
    }

    if (sensorIdSet.size > 0 && !sensorIdSet.has(trimmed)) {
      return
    }

    if (kind === 'origin' && trimmed === destinationId) {
      return
    }
    if (kind === 'destination' && trimmed === originId) {
      return
    }

    setRouteError(null)
    setSelection((current) => {
      const next =
        kind === 'origin'
          ? { originId: trimmed, destinationId: current.destinationId }
          : { originId: current.originId, destinationId: trimmed }
      if (next.originId && next.destinationId) {
        setRouteLoading(true)
        setRouteRefresh((n) => n + 1)
      }
      return next
    })
  }

  function swapRoute() {
    if (!originId && !destinationId) return
    setRouteError(null)
    setOriginDraft(null)
    setDestinationDraft(null)
    if (originId && destinationId) {
      setRouteLoading(true)
      setRouteRefresh((n) => n + 1)
    }
    setSelection({
      originId: destinationId,
      destinationId: originId,
    })
  }

  function clearRoute() {
    setSelection({ originId: null, destinationId: null })
    setOriginDraft(null)
    setDestinationDraft(null)
    setComparison(null)
    setRouteError(null)
    setRouteLoading(false)
  }

  function loadPreset(preset: RoutePreset) {
    setIsPlaying(false)
    if (step !== preset.step) {
      setSnapshotLoading(true)
      setStep(preset.step)
    }
    pendingFitRef.current = true
    setOriginDraft(null)
    setDestinationDraft(null)
    setSelection({
      originId: preset.originId,
      destinationId: preset.destinationId,
    })
    setRouteError(null)
    setRouteLoading(true)
    setRouteRefresh((current) => current + 1)
  }

  const routeReady = Boolean(originId && destinationId)
  const currentClock = formatClock(step)
  const snapshotBusy =
    snapshotLoading || (!snapshotError && snapshot?.step !== step)

  function changeStep(nextStep: number) {
    const normalized = ((nextStep % TOTAL_STEPS) + TOTAL_STEPS) % TOTAL_STEPS
    setSnapshotLoading(true)
    if (routeReady) {
      setRouteError(null)
      setRouteLoading(true)
    }
    setStep(normalized)
  }

  function cyclePlaybackSpeed() {
    setPlaybackSpeed((current) => (current === 1 ? 2 : current === 2 ? 4 : 1))
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#/"
          aria-label="Bay Flow home"
          onClick={(event) => {
            event.preventDefault()
            navigateTo('map')
          }}
        >
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

        <nav className="topbar-nav" aria-label="Primary navigation">
          <button
            type="button"
            className={`nav-tab ${activePage === 'map' ? 'is-active' : ''}`}
            onClick={() => navigateTo('map')}
          >
            Live Map
          </button>
          <button
            type="button"
            className={`nav-tab ${activePage === 'benchmarks' ? 'is-active' : ''}`}
            onClick={() => navigateTo('benchmarks')}
          >
            Model Benchmarks
          </button>
        </nav>

        <div className="topbar-date">
          <span>REPLAY DATE</span>
          <strong>WED · JAN 04, 2017</strong>
        </div>
      </header>

      {activePage === 'benchmarks' ? (
        <BenchmarksPage
          metrics={metrics}
          metricsLoading={metricsLoading}
          metricsError={metricsError}
        />
      ) : (
        <>
          <section className="page-heading">
            <div>
              <p className="eyebrow">BAY AREA TRAFFIC FORECAST</p>
              <h1>Traffic, in motion.</h1>
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

            <div className="step-controls">
              <button
                className="step-button"
                type="button"
                onClick={() => changeStep(step - 1)}
                aria-label="Step back 5 minutes"
                title="Step back 5 minutes"
              >
                −5m
              </button>
              <button
                className="play-button"
                type="button"
                onClick={() => setIsPlaying((playing) => !playing)}
                aria-label={isPlaying ? 'Pause playback' : 'Play playback'}
              >
                <span aria-hidden="true">{isPlaying ? 'Ⅱ' : '▶'}</span>
                {isPlaying ? 'PAUSE' : 'PLAY'}
              </button>
              <button
                className="step-button"
                type="button"
                onClick={() => changeStep(step + 1)}
                aria-label="Step forward 5 minutes"
                title="Step forward 5 minutes"
              >
                +5m
              </button>
              <button
                className="speed-toggle"
                type="button"
                onClick={cyclePlaybackSpeed}
                aria-label={`Playback speed ${playbackSpeed}x`}
                title="Cycle playback speed"
              >
                {playbackSpeed}×
              </button>
            </div>

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
              <div className="time-jumps" role="group" aria-label="Quick time jumps">
                {TIME_JUMPS.map((jump) => (
                  <button
                    key={jump.label}
                    type="button"
                    className={`jump-pill ${step === jump.step ? 'is-active' : ''}`}
                    onClick={() => changeStep(jump.step)}
                  >
                    {jump.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="playback-actions">
              <span className={`data-state ${snapshotBusy ? 'is-loading' : ''}`}>
                <span />
                {snapshotBusy ? 'UPDATING' : `${snapshot?.sensors.length ?? 0} NODES`}
              </span>
              <div className="preset-bar" role="group" aria-label="Rush-hour corridor presets">
                {ROUTE_PRESETS.map((preset) => {
                  const active =
                    step === preset.step &&
                    originId === preset.originId &&
                    destinationId === preset.destinationId
                  return (
                    <button
                      key={preset.id}
                      className={`demo-button ${active ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => loadPreset(preset)}
                    >
                      {preset.label} <b>{preset.timeLabel}</b>
                    </button>
                  )
                })}
              </div>
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
                    <p className="eyebrow">
                      LIVE NETWORK / STEP {String(step).padStart(3, '0')}
                    </p>
                    <h2 id="map-title">Bay Area sensor map</h2>
                  </div>
                </div>

                <div className="map-controls-bar">
                  <div
                    className="segmented-control"
                    role="group"
                    aria-label="Map speed layer"
                  >
                    <button
                      type="button"
                      className={layerMode === 'predicted' ? 'is-active' : ''}
                      onClick={() => setLayerMode('predicted')}
                    >
                      Predicted +15m
                    </button>
                    <button
                      type="button"
                      className={layerMode === 'current' ? 'is-active' : ''}
                      onClick={() => setLayerMode('current')}
                    >
                      Current
                    </button>
                    <button
                      type="button"
                      className={layerMode === 'delta' ? 'is-active' : ''}
                      onClick={() => setLayerMode('delta')}
                    >
                      Change Δ
                    </button>
                  </div>

                  <button
                    type="button"
                    className="theme-toggle"
                    onClick={() =>
                      setBasemapTheme((t) => (t === 'light' ? 'dark' : 'light'))
                    }
                    aria-label={`Switch to ${basemapTheme === 'light' ? 'dark' : 'light'} map`}
                  >
                    {basemapTheme === 'light' ? 'Dark map' : 'Light map'}
                  </button>
                </div>
              </div>

              {networkStats && (
                <div className="network-summary" aria-label="Active network summary">
                  <div className="summary-stat">
                    <span>AVG {networkStats.metricLabel}</span>
                    <strong>
                      {networkStats.avgSpeed.toFixed(1)} <small>mph</small>
                    </strong>
                  </div>
                  <div className="summary-stat">
                    <span>CONGESTED (&lt;35 MPH)</span>
                    <strong
                      className={
                        networkStats.congestedCount > 0 ? 'is-warn' : ''
                      }
                    >
                      {networkStats.congestedCount} <small>nodes</small>
                    </strong>
                  </div>
                  <div className="summary-stat">
                    <span>SLOWEST SENSOR</span>
                    <button
                      type="button"
                      className="slowest-link"
                      onClick={() => selectSensor(networkStats.slowestId)}
                      title="Click to select slowest sensor"
                    >
                      #{networkStats.slowestId} ·{' '}
                      {networkStats.slowestSpeed.toFixed(1)} mph
                    </button>
                  </div>
                  <div className="speed-legend" aria-label="Map marker legend">
                    {layerMode === 'delta' ? (
                      <>
                        <span>
                          <i className="legend-dot speed-green" />
                          +3+ mph
                        </span>
                        <span>
                          <i className="legend-dot speed-neutral" />
                          Steady
                        </span>
                        <span>
                          <i className="legend-dot speed-red" />
                          −3+ mph
                        </span>
                      </>
                    ) : (
                      <>
                        <span>
                          <i className="legend-dot speed-green" />
                          55+ mph
                        </span>
                        <span>
                          <i className="legend-dot speed-amber" />
                          35–54 mph
                        </span>
                        <span>
                          <i className="legend-dot speed-red" />
                          &lt;35 mph
                        </span>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="map-frame">
                <TrafficMap
                  sensors={snapshot?.sensors ?? []}
                  comparison={comparison}
                  originId={originId}
                  destinationId={destinationId}
                  layerMode={layerMode}
                  basemapTheme={basemapTheme}
                  fitRouteSignal={fitRouteSignal}
                  onSensorSelect={selectSensor}
                />
                {comparison && (
                  <button
                    type="button"
                    className="fit-route-button"
                    onClick={() => setFitRouteSignal((n) => n + 1)}
                  >
                    Fit Route
                  </button>
                )}
                {snapshotBusy && snapshot && (
                  <div className="map-refresh" role="status">
                    Refreshing step {step}…
                  </div>
                )}
                {!snapshot && snapshotBusy && (
                  <div className="map-loading" role="status">
                    Loading 325 sensor positions…
                  </div>
                )}
                <div className="map-scale">BAY AREA · CALIFORNIA</div>
              </div>

              <div className="map-footer">
                <p>
                  {routeReady
                    ? 'Select another sensor on the map or edit A / B IDs to compare a new route.'
                    : 'Click a sensor on the map (or type an ID): first sets Origin A, second sets Destination B.'}
                </p>
                <div className="route-line-legend">
                  <span>
                    <i className="route-swatch shortest-swatch" />
                    Shortest distance
                  </span>
                  <span>
                    <i className="route-swatch fastest-swatch" />
                    Predicted fastest
                  </span>
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

                <datalist id="bay-sensor-ids">
                  {(snapshot?.sensors ?? []).map((sensor) => (
                    <option key={sensor.sensor_id} value={sensor.sensor_id} />
                  ))}
                </datalist>

                <div className="route-selection">
                  <div
                    className={`selection-item ${originId ? 'is-selected origin-selected' : ''}`}
                  >
                    <span className="selection-symbol origin-symbol">A</span>
                    <div>
                      <label htmlFor="origin-sensor-input">ORIGIN</label>
                      <input
                        id="origin-sensor-input"
                        className="sensor-input"
                        list="bay-sensor-ids"
                        placeholder="Select or type ID"
                        value={originDraft ?? originId ?? ''}
                        onChange={(event) => {
                          const next = event.target.value
                          const trimmed = next.trim()
                          if (
                            trimmed &&
                            sensorIdSet.has(trimmed) &&
                            trimmed !== destinationId
                          ) {
                            commitSensorInput('origin', trimmed)
                          } else {
                            setOriginDraft(next)
                          }
                        }}
                        onBlur={(event) =>
                          commitSensorInput('origin', event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            commitSensorInput(
                              'origin',
                              (event.target as HTMLInputElement).value,
                            )
                          }
                        }}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    className="swap-button"
                    onClick={swapRoute}
                    disabled={!originId && !destinationId}
                    aria-label="Swap origin and destination"
                    title="Swap Origin A and Destination B"
                  >
                    ⇄
                  </button>

                  <div
                    className={`selection-item ${destinationId ? 'is-selected destination-selected' : ''}`}
                  >
                    <span className="selection-symbol destination-symbol">B</span>
                    <div>
                      <label htmlFor="destination-sensor-input">
                        DESTINATION
                      </label>
                      <input
                        id="destination-sensor-input"
                        className="sensor-input"
                        list="bay-sensor-ids"
                        placeholder="Select or type ID"
                        value={destinationDraft ?? destinationId ?? ''}
                        onChange={(event) => {
                          const next = event.target.value
                          const trimmed = next.trim()
                          if (
                            trimmed &&
                            sensorIdSet.has(trimmed) &&
                            trimmed !== originId
                          ) {
                            commitSensorInput('destination', trimmed)
                          } else {
                            setDestinationDraft(next)
                          }
                        }}
                        onBlur={(event) =>
                          commitSensorInput('destination', event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            commitSensorInput(
                              'destination',
                              (event.target as HTMLInputElement).value,
                            )
                          }
                        }}
                      />
                    </div>
                  </div>
                </div>

                {routeError && (
                  <div className="inline-alert" role="alert">
                    <strong>Route unavailable</strong>
                    <span>{routeError}</span>
                    {routeReady && (
                      <div className="alert-actions">
                        <small>
                          Freeway sensors are one-way; reversing A and B often
                          finds the opposite carriageway.
                        </small>
                        <button
                          type="button"
                          className="inline-swap-button"
                          onClick={swapRoute}
                        >
                          Swap A ⇄ B
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {comparison ? (
                  <div className="comparison-content">
                    <div className="route-result-heading">
                      <span>RESULTS AT {currentClock}</span>
                      <div className="result-badges">
                        {routeLoading && (
                          <span className="updating-pill" role="status">
                            Updating…
                          </span>
                        )}
                        {comparison.routes_differ && (
                          <span className="difference-badge">
                            ROUTES DIFFER
                          </span>
                        )}
                      </div>
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
                                Shortest
                                <br />
                                distance
                              </span>
                            </th>
                            <td>
                              {comparison.shortest_distance_route.total_distance_miles.toFixed(
                                2,
                              )}
                              <small> mi</small>
                            </td>
                            <td>
                              {comparison.shortest_distance_route.total_eta_minutes.toFixed(
                                2,
                              )}
                              <small> min</small>
                            </td>
                            <td>{comparison.shortest_distance_route.hops}</td>
                          </tr>
                          <tr>
                            <th scope="row">
                              <span className="table-route-label fastest-label">
                                Predicted
                                <br />
                                fastest
                              </span>
                            </th>
                            <td>
                              {comparison.predicted_fastest_route.total_distance_miles.toFixed(
                                2,
                              )}
                              <small> mi</small>
                            </td>
                            <td>
                              {comparison.predicted_fastest_route.total_eta_minutes.toFixed(
                                2,
                              )}
                              <small> min</small>
                            </td>
                            <td>{comparison.predicted_fastest_route.hops}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                    <div
                      className={`time-saved-row ${comparison.time_saved_minutes > 0 ? 'is-positive' : 'is-neutral'}`}
                    >
                      <span>TIME SAVED ON FASTEST ROUTE</span>
                      <strong>
                        {comparison.time_saved_minutes > 0 ? '+' : ''}
                        {comparison.time_saved_minutes.toFixed(2)}{' '}
                        <small>min</small>
                      </strong>
                    </div>
                  </div>
                ) : routeLoading && routeReady ? (
                  <div className="route-loading" role="status">
                    <span className="loading-bar" />
                    Calculating routes for {currentClock}…
                  </div>
                ) : !routeReady && !routeError ? (
                  <div className="route-empty">
                    <span className="empty-route-icon" aria-hidden="true">
                      A ─── B
                    </span>
                    <p>
                      Select two sensors on the map or pick a rush-hour preset
                      above to compare routes.
                    </p>
                  </div>
                ) : null}
              </section>
            </aside>
          </section>
        </>
      )}
    </main>
  )
}

export default App
