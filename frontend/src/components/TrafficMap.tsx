import {
  CircleMarker,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
} from 'react-leaflet'
import type { LatLngTuple, PathOptions } from 'leaflet'
import type { RouteComparison, Sensor } from '../types'

interface TrafficMapProps {
  sensors: Sensor[]
  comparison: RouteComparison | null
  originId: string | null
  destinationId: string | null
  onSensorSelect: (sensorId: string) => void
}

function speedColor(speed: number) {
  if (speed >= 55) return '#198754'
  if (speed >= 35) return '#c27b12'
  return '#c74740'
}

function routePositions(route: RouteComparison['shortest_distance_route']): LatLngTuple[] {
  return route.coordinates.map(({ lat, lng }) => [lat, lng] as LatLngTuple)
}

export default function TrafficMap({
  sensors,
  comparison,
  originId,
  destinationId,
  onSensorSelect,
}: TrafficMapProps) {
  return (
    <MapContainer
      className="traffic-map"
      center={[37.35, -121.95]}
      zoom={11}
      scrollWheelZoom
      zoomControl
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {comparison && (
        <>
          <Polyline
            positions={routePositions(comparison.shortest_distance_route)}
            pathOptions={{
              color: '#526174',
              weight: 3,
              opacity: 0.8,
              dashArray: '7 8',
              lineCap: 'butt',
            } satisfies PathOptions}
          />
          <Polyline
            positions={routePositions(comparison.predicted_fastest_route)}
            pathOptions={{
              color: '#087e70',
              weight: 4,
              opacity: 0.96,
              lineCap: 'butt',
            } satisfies PathOptions}
          />
        </>
      )}

      {sensors.map((sensor) => {
        const isOrigin = sensor.sensor_id === originId
        const isDestination = sensor.sensor_id === destinationId
        const selected = isOrigin || isDestination
        const selectedColor = isOrigin ? '#3158c8' : '#c36419'
        return (
          <CircleMarker
            key={sensor.sensor_id}
            center={[sensor.lat, sensor.lng]}
            radius={selected ? 9 : 5}
            pathOptions={{
              color: selected ? '#ffffff' : speedColor(sensor.predicted_speed),
              weight: selected ? 3 : 1,
              fillColor: selected ? selectedColor : speedColor(sensor.predicted_speed),
              fillOpacity: 0.95,
              opacity: 1,
            }}
            eventHandlers={{
              click: () => onSensorSelect(sensor.sensor_id),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={0.98}>
              <div className="sensor-tooltip">
                <strong>{sensor.sensor_id}</strong>
                <span>Current <b>{sensor.current_speed.toFixed(1)} mph</b></span>
                <span>Predicted <b>{sensor.predicted_speed.toFixed(1)} mph</b></span>
                {isOrigin && <em>ORIGIN · click marker again to reselect</em>}
                {isDestination && <em>DESTINATION</em>}
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
