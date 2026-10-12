from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, timedelta

from django.core.cache import caches

from . import providers

cache = caches['shared']
CHUNK = 50
TTL = 30 * 60


def _compact(series):
    """Store (wind, rain, snow) tuples: ~10x smaller than the full dicts in a shared cache."""
    return {h: (w['wind_mph'], w['rain_in_hr'], w['snow_in_hr']) for h, w in series.items()}


def _expand(compact):
    if compact is None:
        return None
    return {
        h: {'forecast_time': h.isoformat(), 'wind_mph': v[0], 'rain_in_hr': v[1], 'snow_in_hr': v[2]}
        for h, v in compact.items()
    }


def forecast_at(points, times):
    """points: [(lat, lon)], times: [aware datetime] -> list of weather dict | None.

    Each ETA is matched to the nearest forecast hour (UTC). None = no forecast
    for that hour (outside the horizon or missing values); callers must treat it
    as UNKNOWN. Series are cached 30 min per ~1 km grid cell and deduplicated, so
    a forecast-slider sweep over one trip costs one Open-Meteo call per cache window."""
    keys = [(round(lat, 2), round(lon, 2)) for lat, lon in points]
    hit = cache.get_many([f'wx:{k[0]}:{k[1]}' for k in set(keys)])  # one query, not one per point
    series = {k: _expand(hit.get(f'wx:{k[0]}:{k[1]}')) for k in set(keys)}
    missing = [k for k, v in series.items() if v is None]
    chunks = [missing[i:i + CHUNK] for i in range(0, len(missing), CHUNK)]
    # Long (intercontinental) routes need many points; fetch the chunks concurrently.
    fresh = {}
    with ThreadPoolExecutor(max_workers=min(4, max(1, len(chunks)))) as pool:
        for chunk, result in zip(chunks, pool.map(providers.fetch_hourly, chunks)):
            for k, s in zip(chunk, result):
                series[k] = s  # full dicts straight from the provider
                fresh[f'wx:{k[0]}:{k[1]}'] = _compact(s)
    if fresh:
        cache.set_many(fresh, TTL)

    out = []
    for k, t in zip(keys, times):
        hour = (t.astimezone(UTC) + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
        out.append(series[k].get(hour))
    return out
