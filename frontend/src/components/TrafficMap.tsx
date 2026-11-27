import { useEffect, useRef, useState } from 'react'
import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import { latLngBounds, type LatLngTuple, type PathOptions } from 'leaflet'
import type {
  BasemapTheme,
  MapLayerMode,
  RouteComparison,
  Sensor,
} from '../types'

interface TrafficMapProps {
  sensors: Sensor[]
  comparison: RouteComparison | null
  originId: string | null
  destinationId: string | null
  layerMode: MapLayerMode
  basemapTheme: BasemapTheme
  fitRouteSignal: number
  onSensorSelect: (sensorId: string) => void
}

function speedColor(speed: number) {
  if (speed >= 55) return '#198754'
  if (speed >= 35) return '#c27b12'
  return '#c74740'
}

function deltaColor(delta: number) {
  if (delta >= 3) return '#198754'
  if (delta <= -3) return '#c74740'
  return '#64748b'
}

function markerColor(sensor: Sensor, layerMode: MapLayerMode) {
  if (layerMode === 'current') return speedColor(sensor.current_speed)
  if (layerMode === 'delta') {
    return deltaColor(sensor.predicted_speed - sensor.current_speed)
  }
  return speedColor(sensor.predicted_speed)
}

function routePositions(
  route: RouteComparison['shortest_distance_route'],
): LatLngTuple[] {
  return route.coordinates.map(({ lat, lng }) => [lat, lng] as LatLngTuple)
}

function RouteBoundsController({
  comparison,
  fitRouteSignal,
}: {
  comparison: RouteComparison | null
  fitRouteSignal: number
}) {
  const map = useMap()
  const lastFittedRef = useRef(0)

  useEffect(() => {
    if (
      !comparison ||
      fitRouteSignal === 0 ||
      fitRouteSignal === lastFittedRef.current
    ) {
      return
    }
    const points = [
      ...comparison.shortest_distance_route.coordinates,
      ...comparison.predicted_fastest_route.coordinates,
    ]
    if (points.length === 0) return
    lastFittedRef.current = fitRouteSignal
    const bounds = latLngBounds(
      points.map(({ lat, lng }) => [lat, lng] as LatLngTuple),
    )
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 13, animate: true })
  }, [comparison, fitRouteSignal, map])

  return null
}

export default function TrafficMap({
  sensors,
  comparison,
  originId,
  destinationId,
  layerMode,
  basemapTheme,
  fitRouteSignal,
  onSensorSelect,
}: TrafficMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const casingColor = basemapTheme === 'dark' ? '#0f172a' : '#ffffff'
  const shortestColor = basemapTheme === 'dark' ? '#94a3b8' : '#475569'
  const fastestColor = basemapTheme === 'dark' ? '#14b8a6' : '#087e70'

  const shortestPositions = comparison
    ? routePositions(comparison.shortest_distance_route)
    : []
  const fastestPositions = comparison
    ? routePositions(comparison.predicted_fastest_route)
    : []

  return (
    <MapContainer
      className={`traffic-map ${basemapTheme === 'dark' ? 'is-dark' : 'is-light'}`}
      center={[37.35, -121.95]}
      zoom={11}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <RouteBoundsController
        comparison={comparison}
        fitRouteSignal={fitRouteSignal}
      />

      {comparison && (
        <>
          <Polyline
            positions={shortestPositions}
            pathOptions={{
              color: casingColor,
              weight: 6,
              opacity: 0.88,
              lineCap: 'round',
            } satisfies PathOptions}
          />
          <Polyline
            positions={shortestPositions}
            pathOptions={{
              color: shortestColor,
              weight: 3,
              opacity: 0.9,
              dashArray: '7 7',
              lineCap: 'butt',
            } satisfies PathOptions}
          />
          <Polyline
            positions={fastestPositions}
            pathOptions={{
              color: casingColor,
              weight: 7,
              opacity: 0.9,
              lineCap: 'round',
            } satisfies PathOptions}
          />
          <Polyline
            positions={fastestPositions}
            pathOptions={{
              color: fastestColor,
              weight: 4,
              opacity: 0.98,
              lineCap: 'round',
            } satisfies PathOptions}
          />
        </>
      )}

      {sensors.map((sensor) => {
        const isOrigin = sensor.sensor_id === originId
        const isDestination = sensor.sensor_id === destinationId
        const selected = isOrigin || isDestination
        const isHovered = hoveredId === sensor.sensor_id
        const selectedColor = isOrigin ? '#3158c8' : '#c36419'
        const fill = selected ? selectedColor : markerColor(sensor, layerMode)
        const delta = sensor.predicted_speed - sensor.current_speed
        const deltaClass =
          delta >= 3 ? 'is-up' : delta <= -3 ? 'is-down' : 'is-flat'

        return (
          <CircleMarker
            key={sensor.sensor_id}
            center={[sensor.lat, sensor.lng]}
            radius={selected ? 9 : isHovered ? 7.5 : 5}
            pathOptions={{
              color: selected
                ? '#ffffff'
                : isHovered
                  ? casingColor
                  : fill,
              weight: selected ? 3 : isHovered ? 2 : 1,
              fillColor: fill,
              fillOpacity: 0.95,
              opacity: 1,
            }}
            eventHandlers={{
              click: () => onSensorSelect(sensor.sensor_id),
              mouseover: () => setHoveredId(sensor.sensor_id),
              mouseout: () =>
                setHoveredId((current) =>
                  current === sensor.sensor_id ? null : current,
                ),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.98}>
              <div className="sensor-tooltip">
                <strong>Sensor {sensor.sensor_id}</strong>
                <span>
                  Current → +15m
                  <b>
                    {sensor.current_speed.toFixed(1)} →{' '}
                    {sensor.predicted_speed.toFixed(1)} mph
                  </b>
                </span>
                <span>
                  Forecast Δ
                  <b className={`tooltip-delta ${deltaClass}`}>
                    {delta >= 0 ? '+' : ''}
                    {delta.toFixed(1)} mph
                  </b>
                </span>
                {isOrigin && <em>ORIGIN · click again to deselect</em>}
                {isDestination && <em>DESTINATION</em>}
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
