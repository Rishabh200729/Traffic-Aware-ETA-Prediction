import type { BenchmarkMetrics } from '../types'

interface BenchmarksPageProps {
  metrics: BenchmarkMetrics | null
  metricsLoading: boolean
  metricsError: string | null
}

export default function BenchmarksPage({
  metrics,
  metricsLoading,
  metricsError,
}: BenchmarksPageProps) {
  const metricUnit = (metrics?.unit ?? 'min').toUpperCase()
  const persistenceMae = metrics?.['Persistence Baseline'].mae ?? 1
  const persistenceRmse = metrics?.['Persistence Baseline'].rmse ?? 1

  return (
    <section className="benchmarks-page" aria-labelledby="benchmarks-page-title">
      <div className="benchmarks-header">
        <div>
          <p className="eyebrow">CHRONOLOGICAL VALIDATION</p>
          <h1 id="benchmarks-page-title">Model benchmarks</h1>
        </div>
        {metrics && (
          <span className="horizon-tag">UNIT · {metricUnit}</span>
        )}
      </div>

      {metricsError && (
        <div className="inline-alert metrics-alert" role="alert">
          <strong>Benchmark unavailable</strong>
          <span>{metricsError}</span>
        </div>
      )}

      {metricsLoading ? (
        <div className="panel benchmarks-card">
          <p className="benchmark-loading" role="status">
            Loading benchmark metrics…
          </p>
        </div>
      ) : metrics ? (
        <>
          <div className="benchmark-highlights">
            <div className="highlight-card is-primary">
              <span>TOP MODEL</span>
              <strong>Residual LSTM</strong>
              <small>MAE {metrics.LSTM.mae.toFixed(3)} {metricUnit.toLowerCase()}</small>
            </div>
            <div className="highlight-card">
              <span>MAE REDUCTION</span>
              <strong>−{metrics.improvement_pct.LSTM.mae.toFixed(2)}%</strong>
              <small>vs. Persistence Baseline</small>
            </div>
            <div className="highlight-card">
              <span>RMSE REDUCTION</span>
              <strong>−{metrics.improvement_pct.LSTM.rmse.toFixed(2)}%</strong>
              <small>vs. Persistence Baseline</small>
            </div>
            <div className="highlight-card">
              <span>VALIDATION WINDOWS</span>
              <strong>{metrics.validation_samples.toLocaleString()}</strong>
              <small>Across {metrics.sensors_trained} sensors</small>
            </div>
          </div>

          <section className="panel benchmarks-card" aria-label="Benchmark comparison table">
            <div className="panel-heading">
              <div className="panel-heading-title">
                <span className="section-index">01</span>
                <div>
                  <p className="eyebrow">EVALUATION SUMMARY</p>
                  <h2>Baseline vs. Deep Learning</h2>
                </div>
              </div>
              <span className="horizon-tag">{metricUnit}</span>
            </div>

            <div className="table-scroll">
              <table className="benchmark-table benchmarks-full-table">
                <thead>
                  <tr>
                    <th>MODEL</th>
                    <th>MAE ({metricUnit})</th>
                    <th>RMSE ({metricUnit})</th>
                    <th>VS BASELINE</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Persistence</th>
                    <td>
                      <span>
                        {metrics['Persistence Baseline'].mae.toFixed(3)}
                      </span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-baseline"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </td>
                    <td>
                      <span>
                        {metrics['Persistence Baseline'].rmse.toFixed(3)}
                      </span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-baseline"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </td>
                    <td className="baseline-cell">REFERENCE</td>
                  </tr>
                  <tr>
                    <th scope="row">HistGradientBoosting</th>
                    <td>
                      <span>{metrics.HistGradientBoosting.mae.toFixed(3)}</span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-gbdt"
                          style={{
                            width: `${Math.min(100, (metrics.HistGradientBoosting.mae / persistenceMae) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <span>{metrics.HistGradientBoosting.rmse.toFixed(3)}</span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-gbdt"
                          style={{
                            width: `${Math.min(100, (metrics.HistGradientBoosting.rmse / persistenceRmse) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="improvement-cell">
                      MAE −
                      {metrics.improvement_pct.HistGradientBoosting.mae.toFixed(
                        2,
                      )}
                      %
                      <br />
                      RMSE −
                      {metrics.improvement_pct.HistGradientBoosting.rmse.toFixed(
                        2,
                      )}
                      %
                    </td>
                  </tr>
                  <tr className="lstm-row">
                    <th scope="row">Residual LSTM</th>
                    <td>
                      <span>{metrics.LSTM.mae.toFixed(3)}</span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-lstm"
                          style={{
                            width: `${Math.min(100, (metrics.LSTM.mae / persistenceMae) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td>
                      <span>{metrics.LSTM.rmse.toFixed(3)}</span>
                      <div className="mae-bar-track is-wide" aria-hidden="true">
                        <div
                          className="mae-bar-fill is-lstm"
                          style={{
                            width: `${Math.min(100, (metrics.LSTM.rmse / persistenceRmse) * 100)}%`,
                          }}
                        />
                      </div>
                    </td>
                    <td className="improvement-cell">
                      MAE −{metrics.improvement_pct.LSTM.mae.toFixed(2)}%
                      <br />
                      RMSE −{metrics.improvement_pct.LSTM.rmse.toFixed(2)}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="benchmark-meta">
              <div>
                <strong>{metrics.sensors_trained}</strong>
                <span>SENSORS</span>
              </div>
              <div>
                <strong>{metrics.validation_samples.toLocaleString()}</strong>
                <span>VAL WINDOWS</span>
              </div>
              <div>
                <strong>{metrics.features.length}</strong>
                <span>FEATURES</span>
              </div>
              <div>
                <strong>
                  {metrics.split === 'chronological_80_20'
                    ? '80 / 20'
                    : metrics.split}
                </strong>
                <span>SPLIT</span>
              </div>
            </div>

            <div className="feature-list" aria-label="Model input features">
              {metrics.features.map((feature) => (
                <span key={feature}>{feature.replaceAll('_', ' ')}</span>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  )
}
