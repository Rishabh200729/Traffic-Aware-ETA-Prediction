"""
Lightweight road-graph loader for PeMS-BAY (DCRNN metadata).

Expected files in data/:
  - graph_sensor_locations_bay.csv : sensor_id, latitude, longitude (no header)
  - distances_bay_2017.csv         : from, to, cost_in_meters (header or no header)
"""

from __future__ import annotations

import csv
import heapq
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

METERS_PER_MILE = 1609.344
PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"


@dataclass(frozen=True)
class SensorNode:
    sensor_id: str
    lat: float
    lng: float


@dataclass(frozen=True)
class RoadEdge:
    to: str
    distance_m: float
    distance_miles: float


def _is_float(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False


def _normalize_id(raw_id: str) -> str:
    """Normalize sensor IDs like '400001.0' or ' 400001 ' -> '400001'."""
    cleaned = raw_id.strip()
    if cleaned.endswith(".0") and cleaned[:-2].isdigit():
        return cleaned[:-2]
    return cleaned


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two GPS points in meters."""
    r = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lng2 - lng1)
    a = (
        math.sin(dphi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    )
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


class RoadGraph:
    def __init__(
        self,
        locations_csv: str | Path | None = None,
        distances_csv: str | Path | None = None,
    ) -> None:
        self.locations_path = (
            Path(locations_csv)
            if locations_csv
            else DATA_DIR / "graph_sensor_locations_bay.csv"
        )
        self.distances_path = (
            Path(distances_csv)
            if distances_csv
            else DATA_DIR / "distances_bay_2017.csv"
        )

        self.sensors: Dict[str, SensorNode] = {}
        self.adjacency: Dict[str, List[RoadEdge]] = {}
        self.dropped_edges: int = 0

        self._load_locations()
        self._load_distances()
        
    def _load_locations(self) -> None:
        if not self.locations_path.exists():
            raise FileNotFoundError(f"Locations file not found: {self.locations_path}")

        with self.locations_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row_idx, row in enumerate(reader):
                if len(row) < 3:
                    continue
                # Skip header row if present
                if row_idx == 0 and not (_is_float(row[1]) and _is_float(row[2])):
                    continue

                sensor_id = _normalize_id(row[0])
                lat = float(row[1])
                lng = float(row[2])

                self.sensors[sensor_id] = SensorNode(
                    sensor_id=sensor_id, lat=lat, lng=lng
                )
                self.adjacency.setdefault(sensor_id, [])

    def _load_distances(self) -> None:
        if not self.distances_path.exists():
            raise FileNotFoundError(f"Distances file not found: {self.distances_path}")

        # Keep minimum cost if duplicate (from, to) rows exist
        best_edges: Dict[Tuple[str, str], float] = {}

        with self.distances_path.open("r", encoding="utf-8", newline="") as f:
            reader = csv.reader(f)
            for row_idx, row in enumerate(reader):
                if len(row) < 3:
                    continue
                # Skip header row if present
                if row_idx == 0 and not _is_float(row[2]):
                    continue

                src = _normalize_id(row[0])
                dst = _normalize_id(row[1])
                cost_m = float(row[2])

                # Filter out unknown sensors, self-loops, and non-positive distances
                if (
                    src not in self.sensors
                    or dst not in self.sensors
                    or src == dst
                    or cost_m <= 0
                ):
                    self.dropped_edges += 1
                    continue

                key = (src, dst)
                if key not in best_edges or cost_m < best_edges[key]:
                    best_edges[key] = cost_m

        for (src, dst), cost_m in best_edges.items():
            self.adjacency[src].append(
                RoadEdge(
                    to=dst,
                    distance_m=cost_m,
                    distance_miles=cost_m / METERS_PER_MILE,
                )
            )

    def get_sensor(self, sensor_id: str) -> Optional[SensorNode]:
        return self.sensors.get(_normalize_id(sensor_id))

    def get_neighbors(self, sensor_id: str) -> List[RoadEdge]:
        return self.adjacency.get(_normalize_id(sensor_id), [])

    def edge_count(self) -> int:
        return sum(len(edges) for edges in self.adjacency.values())

    @staticmethod
    def _edge_speed_mph(
        u: str,
        v: str,
        speed_map_mph: Dict[str, float],
        min_speed_mph: float,
    ) -> float:
        has_u = u in speed_map_mph
        has_v = v in speed_map_mph
        if has_u and has_v:
            raw_speed = 0.5 * (float(speed_map_mph[u]) + float(speed_map_mph[v]))
        elif has_v:
            raw_speed = float(speed_map_mph[v])
        elif has_u:
            raw_speed = float(speed_map_mph[u])
        else:
            raw_speed = 60.0
        return max(raw_speed, min_speed_mph)

    def route_eta(
        self,
        sensor_ids: List[str],
        speed_map_mph: Optional[Dict[str, float]] = None,
        speed_maps_by_step: Optional[List[Dict[str, float]]] = None,
        start_step: int = 0,
        min_speed_mph: float = 5.0,
    ) -> Optional[float]:
        """Compute total travel time (minutes) for a fixed sequence of sensor IDs."""
        if speed_maps_by_step is None and speed_map_mph is None:
            return None

        elapsed = 0.0
        for u, v in zip(sensor_ids, sensor_ids[1:]):
            edge = next((e for e in self.get_neighbors(u) if e.to == v), None)
            if edge is None:
                return None
            if speed_maps_by_step is not None:
                step_idx = min(
                    max(start_step, 0) + int(elapsed // 5),
                    len(speed_maps_by_step) - 1,
                )
                active_map = speed_maps_by_step[step_idx]
            else:
                active_map = speed_map_mph  # type: ignore[assignment]
            speed = self._edge_speed_mph(u, v, active_map, min_speed_mph)
            elapsed += (edge.distance_miles / speed) * 60.0
        return round(elapsed, 2)

    def shortest_path(
        self,
        origin_id: str,
        destination_id: str,
        speed_map_mph: Optional[Dict[str, float]] = None,
        speed_maps_by_step: Optional[List[Dict[str, float]]] = None,
        start_step: int = 0,
        min_speed_mph: float = 5.0,
    ) -> Optional[Dict]:
        """
        Run Dijkstra from origin_id to destination_id.
        - If speed_map_mph and speed_maps_by_step are None: minimizes distance (miles).
        - If speeds are provided: minimizes predicted travel time (minutes) using
          endpoint-averaged edge speeds and optional 5-min time-dependent step lookup.
        """
        start = _normalize_id(origin_id)
        goal = _normalize_id(destination_id)

        if start not in self.sensors or goal not in self.sensors:
            return None

        time_dependent = speed_maps_by_step is not None and len(speed_maps_by_step) > 0
        has_speeds = time_dependent or (speed_map_mph is not None)

        # Priority queue items: (cost, node_id)
        pq: List[Tuple[float, str]] = [(0.0, start)]
        best_cost: Dict[str, float] = {start: 0.0}
        prev: Dict[str, Tuple[str, RoadEdge]] = {}

        while pq:
            curr_cost, u = heapq.heappop(pq)
            if curr_cost > best_cost.get(u, float("inf")):
                continue
            if u == goal:
                break

            for edge in self.adjacency.get(u, []):
                if not has_speeds:
                    weight = edge.distance_miles
                else:
                    if time_dependent:
                        step_idx = min(
                            max(start_step, 0) + int(curr_cost // 5),
                            len(speed_maps_by_step) - 1,  # type: ignore[arg-type]
                        )
                        active_map = speed_maps_by_step[step_idx]  # type: ignore[index]
                    else:
                        active_map = speed_map_mph  # type: ignore[assignment]
                    speed = self._edge_speed_mph(u, edge.to, active_map, min_speed_mph)
                    weight = (edge.distance_miles / speed) * 60.0

                new_cost = curr_cost + weight
                if new_cost < best_cost.get(edge.to, float("inf")):
                    best_cost[edge.to] = new_cost
                    prev[edge.to] = (u, edge)
                    heapq.heappush(pq, (new_cost, edge.to))

        if goal not in best_cost:
            return None

        # Reconstruct path
        path_ids: List[str] = [goal]
        total_miles = 0.0

        curr = goal
        while curr != start:
            parent, edge = prev[curr]
            path_ids.append(parent)
            total_miles += edge.distance_miles
            curr = parent

        path_ids.reverse()
        coords = [
            {
                "sensor_id": sid,
                "lat": self.sensors[sid].lat,
                "lng": self.sensors[sid].lng,
            }
            for sid in path_ids
        ]

        return {
            "sensor_ids": path_ids,
            "coordinates": coords,
            "hops": len(path_ids) - 1,
            "total_distance_miles": round(total_miles, 3),
            "total_eta_minutes": round(best_cost[goal], 2) if has_speeds else None,
        }


def run_verification(graph: RoadGraph) -> None:
    """Self-test suite to verify coordinates, units, topology, and routing."""
    print("=== RoadGraph Verification ===")

    # 1. Sensor count check
    n_sensors = len(graph.sensors)
    print(f"[{'PASS' if n_sensors == 325 else 'WARN'}] Sensors loaded: {n_sensors} (expected 325 for PeMS-BAY)")

    # 2. Bay Area GPS bounding box check
    out_of_bounds = [
        s.sensor_id
        for s in graph.sensors.values()
        if not (36.5 <= s.lat <= 38.5 and -123.0 <= s.lng <= -121.0)
    ]
    print(
        f"[{'PASS' if not out_of_bounds else 'FAIL'}] Bay Area GPS bounds: "
        f"{len(out_of_bounds)} out-of-bounds sensors"
    )

    # 3. Edge integrity check
    n_edges = graph.edge_count()
    connected_nodes = sum(1 for edges in graph.adjacency.values() if edges)
    print(
        f"[{'PASS' if n_edges > 0 else 'FAIL'}] Directed edges loaded: {n_edges} "
        f"(dropped {graph.dropped_edges} self-loops/unknowns; {connected_nodes}/{n_sensors} nodes have outgoing edges)"
    )

    # 4. Unit sanity check (cost vs Haversine meters)
    ratios = []
    for src, edges in graph.adjacency.items():
        s1 = graph.sensors[src]
        for e in edges:
            s2 = graph.sensors[e.to]
            hav_m = haversine_meters(s1.lat, s1.lng, s2.lat, s2.lng)
            if hav_m > 100:  # ignore near-coincident sensors
                ratios.append(e.distance_m / hav_m)

    if ratios:
        median_ratio = sorted(ratios)[len(ratios) // 2]
        # Road distance in meters should be >= straight-line Haversine distance (~1.0x to 2.0x)
        unit_ok = 0.9 <= median_ratio <= 3.0
        print(
            f"[{'PASS' if unit_ok else 'WARN'}] Distance unit check (median cost / Haversine_m): "
            f"{median_ratio:.2f}x (expected ~1.0x–2.0x for meters)"
        )

    # 5. Dijkstra smoke test on a reachable pair
    sample_route = None
    sensor_list = list(graph.sensors.keys())
    for origin in sensor_list[:20]:
        for dest in reversed(sensor_list[-20:]):
            if origin != dest:
                route = graph.shortest_path(origin, dest)
                if route and route["hops"] >= 3:
                    sample_route = (origin, dest, route)
                    break
        if sample_route:
            break

    if sample_route:
        origin, dest, dist_route = sample_route
        uniform_speeds = {sid: 60.0 for sid in graph.sensors}
        eta_route = graph.shortest_path(origin, dest, speed_map_mph=uniform_speeds)
        print(
            f"[PASS] Dijkstra test ({origin} -> {dest}): "
            f"{dist_route['hops']} hops, {dist_route['total_distance_miles']} mi, "
            f"ETA @ 60 mph = {eta_route['total_eta_minutes']} min"
        )
    else:
        print("[FAIL] Dijkstra test: could not find a multi-hop path between sample sensors.")


if __name__ == "__main__":
    g = RoadGraph()
    run_verification(g)