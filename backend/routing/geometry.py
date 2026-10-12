"""Pure geometry: distance-based checkpoint sampling and ETA interpolation."""
from bisect import bisect_right
from math import asin, cos, radians, sin, sqrt

EARTH_RADIUS_MILES = 3958.8


def haversine_miles(a, b):
    (lat1, lon1), (lat2, lon2) = a, b
    dlat, dlon = radians(lat2 - lat1), radians(lon2 - lon1)
    h = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * asin(sqrt(h))


def sample_checkpoints(coords, total_miles, duration_s, interval_miles):
    """coords: [(lat, lon)], len >= 2. Returns [{distance_miles, lat, lon, eta_seconds}]
    every `interval_miles` plus the exact start and end.

    The provider's distance/duration are authoritative; the geometry only decides
    *where* a given fraction of the route falls. ETA is linear in distance
    (approximation: ignores speed changes along the route)."""
    cum = [0.0]
    for a, b in zip(coords, coords[1:]):
        cum.append(cum[-1] + haversine_miles(a, b))
    geo_total = cum[-1]

    targets = []
    t = 0.0
    while t < total_miles:
        targets.append(t)
        t += interval_miles
    targets.append(total_miles)

    out = []
    for t in targets:
        frac = t / total_miles if total_miles else 0.0
        g = frac * geo_total
        i = min(max(bisect_right(cum, g) - 1, 0), len(coords) - 2)
        seg = cum[i + 1] - cum[i]
        f = (g - cum[i]) / seg if seg else 0.0
        (lat1, lon1), (lat2, lon2) = coords[i], coords[i + 1]
        out.append({
            'distance_miles': round(t, 2),
            'lat': lat1 + (lat2 - lat1) * f,
            'lon': lon1 + (lon2 - lon1) * f,
            'eta_seconds': duration_s * frac,
        })
    return out


def mean_gap_miles(geometry, other):
    """Mean distance from ~25 evenly spaced points of `geometry` to the nearest point of `other`
    (both lists of (lat, lon)). Small values mean the two polylines follow the same roads."""
    if not geometry or not other:
        return float('inf')
    sample = geometry[::max(1, len(geometry) // 25)]
    ref = other[::max(1, len(other) // 600)]
    return sum(min(haversine_miles(tuple(p), tuple(q)) for q in ref) for p in sample) / len(sample)
