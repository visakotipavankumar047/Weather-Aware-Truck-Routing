"""Provider adapters: OpenRouteService (routing + geocoding) and Nominatim (geocoding fallback)."""
import hashlib
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import caches
from rest_framework.exceptions import ValidationError

from api.http import ProviderError, request_json
from routing.geometry import haversine_miles, mean_gap_miles

METERS_PER_MILE = 1609.344
cache = caches['shared']
ALT_ROUTES_WARNING = (
    'The routing provider returned no alternatives for this trip '
    '(OpenRouteService limits alternative routes to shorter trips); showing a single route.'
)


def _geocode_ors(query, limit):
    """OpenRouteService geocoder (Pelias). Uses the routing key, so no extra signup."""
    data = request_json(
        'GET', f'{settings.OPENROUTESERVICE_BASE_URL}/geocode/search',
        provider='OpenRouteService geocoding',
        params={'api_key': settings.OPENROUTESERVICE_API_KEY, 'text': query, 'size': limit},
    )
    try:
        return [
            {
                'label': f['properties']['label'],
                'lon': float(f['geometry']['coordinates'][0]),
                'lat': float(f['geometry']['coordinates'][1]),
            }
            for f in data['features']
        ]
    except (TypeError, KeyError, ValueError, IndexError):
        raise ProviderError('OpenRouteService geocoding returned an unexpected response.')


def _geocode_nominatim(query, limit):
    data = request_json(
        'GET', f'{settings.NOMINATIM_BASE_URL}/search',
        provider='Nominatim',
        params={'q': query, 'format': 'jsonv2', 'limit': limit},
        headers={'User-Agent': settings.NOMINATIM_USER_AGENT},
    )
    try:
        return [{'label': p['display_name'], 'lat': float(p['lat']), 'lon': float(p['lon'])} for p in data]
    except (TypeError, KeyError, ValueError):
        raise ProviderError('Nominatim returned an unexpected response.')


def _nominatim_configured():
    # Nominatim blocks anonymous/placeholder User-Agents, so only use it with a real contact.
    ua = settings.NOMINATIM_USER_AGENT
    return bool(ua) and 'example.com' not in ua and 'your-email' not in ua


def geocode(query, limit=5):
    """-> [{label, lat, lon}]. Cached 24h. OpenRouteService first (uses the existing key);
    Nominatim is the fallback when a real User-Agent contact is configured."""
    key = f'geocode:{limit}:{hashlib.sha1(query.strip().lower().encode()).hexdigest()}'
    hit = cache.get(key)
    if hit is not None:
        return hit
    providers = []
    if settings.OPENROUTESERVICE_API_KEY:
        providers.append(_geocode_ors)
    if _nominatim_configured():
        providers.append(_geocode_nominatim)
    if not providers:
        raise ProviderError(
            'No geocoder configured: set OPENROUTESERVICE_API_KEY or a real NOMINATIM_USER_AGENT.', 503
        )
    error = None
    for fn in providers:
        try:
            places = fn(query, limit)
        except ProviderError as e:
            error = e
            continue
        cache.set(key, places, 24 * 3600)
        return places
    raise error


def resolve_place(value, field):
    """Accept the validated place from the serializer: a resolved {label, lat, lon}
    passes through; a free-text query is geocoded (best match)."""
    if 'lat' in value:
        return value
    results = geocode(value['query'], limit=1)
    if not results:
        raise ValidationError({field: f"Could not find a location for '{value['query']}'."})
    return results[0]


# Extra requests used to find real alternatives when the provider's built-in alternatives are
# unavailable (it only offers them on shorter trips). Each is a genuine, separate routing call.
VARIANTS = [
    ('Shortest', {'preference': 'shortest'}),
    ('Avoids highways', {'options': {'avoid_features': ['highways']}}),
    ('Avoids tolls', {'options': {'avoid_features': ['tollways']}}),
]
DISTINCT_MILES = 0.75  # two routes closer than this on average count as the same route
MAX_ROUTES = 3
VARIANTS_WARNING = (
    'Built-in alternatives are only offered on shorter trips, so the other options come from separate '
    'routing requests (shortest, avoiding highways or tolls, or a map-provider alternative). Each is a real, '
    'distinct route.'
)


def _ors_request(origin, destination, alternatives=False, extra=None, via=()):
    if not settings.OPENROUTESERVICE_API_KEY:
        raise ProviderError('OPENROUTESERVICE_API_KEY is not configured.', 503)
    coords = [[origin['lon'], origin['lat']], *([lon, lat] for lat, lon in via), [destination['lon'], destination['lat']]]
    body = {
        'coordinates': coords,
        'radiuses': [-1] * len(coords),  # snap to the nearest road at any distance, so remote places still route
    }
    if alternatives:
        body['alternative_routes'] = {'target_count': 3, 'share_factor': 0.6, 'weight_factor': 1.4}
    body.update(extra or {})
    return request_json(
        'POST', f'{settings.OPENROUTESERVICE_BASE_URL}/v2/directions/driving-hgv/geojson',
        provider='OpenRouteService', json=body,
        headers={'Authorization': settings.OPENROUTESERVICE_API_KEY},
    )


def _parse_routes(data, label=''):
    out, seen = [], set()
    try:
        for f in data['features']:
            summary = f['properties']['summary']
            coords = [(lat, lon) for lon, lat, *_ in f['geometry']['coordinates']]
            sig = (round(summary['distance']), round(summary['duration']))
            if len(coords) < 2 or sig in seen:
                continue
            seen.add(sig)
            out.append({
                'distance_miles': summary['distance'] / METERS_PER_MILE,
                'duration_s': float(summary['duration']),
                'coords': coords,
                'label': label,
            })
    except (TypeError, KeyError, ValueError):
        raise ProviderError('OpenRouteService returned an unexpected response.')
    return out


def _is_distinct(route, existing):
    return all(mean_gap_miles(route['coords'], e['coords']) >= DISTINCT_MILES for e in existing)


def _tomtom_alternatives(origin, destination):
    """Polylines of TomTom's alternative routes; [] without a key or on any failure.
    Only used as a *guide*: the route is re-planned by OpenRouteService through points taken from
    it, so every route shares one vehicle profile and one timing model."""
    if not settings.TOMTOM_API_KEY:
        return []
    path = f"{origin['lat']},{origin['lon']}:{destination['lat']},{destination['lon']}"
    try:
        data = request_json(
            'GET', f'{settings.TOMTOM_BASE_URL}/routing/1/calculateRoute/{path}/json',
            provider='TomTom routing',
            params={'key': settings.TOMTOM_API_KEY, 'travelMode': 'truck', 'maxAlternatives': 3,
                    'routeRepresentation': 'polyline'},
        )
        return [
            [(p['latitude'], p['longitude']) for leg in r['legs'] for p in leg['points']]
            for r in data['routes']
        ]
    except (ProviderError, KeyError, TypeError):
        return []


def _via_points(alt, existing, min_miles=1.0):
    """Up to 3 points along `alt` that are far from every route already chosen."""
    far = []
    for f in (0.2, 0.35, 0.5, 0.65, 0.8):
        p = alt[int((len(alt) - 1) * f)]
        if all(
            min(haversine_miles(p, tuple(q)) for q in e['coords'][::max(1, len(e['coords']) // 400)]) > min_miles
            for e in existing
        ):
            far.append(p)
    return far if len(far) <= 3 else [far[0], far[len(far) // 2], far[-1]]


def fetch_routes(origin, destination):
    """-> (routes, warnings). route = {distance_miles, duration_s, coords[(lat, lon)], label}.

    Up to three genuinely distinct routes: the provider's built-in alternatives first; if that
    yields fewer than three, separate requests (shortest / avoid highways / avoid tolls) fill in.
    Routes that follow the same roads are dropped; nothing is ever fabricated."""
    warnings = []
    fell_back = False
    try:
        data = _ors_request(origin, destination, alternatives=True)
    except ProviderError as e:
        if e.upstream != 400:
            raise
        data = _ors_request(origin, destination)  # raises again if the 400 was real
        fell_back = True

    routes = _parse_routes(data)
    if not routes:
        raise ProviderError('OpenRouteService returned no routes.')

    added = False
    if len(routes) < MAX_ROUTES:
        def attempt(variant):
            label, extra = variant
            try:
                return _parse_routes(_ors_request(origin, destination, extra=extra), label)
            except ProviderError:
                return []  # a variant failing must never break the trip; it just adds nothing

        with ThreadPoolExecutor(max_workers=len(VARIANTS)) as pool:
            results = list(pool.map(attempt, VARIANTS))
        for found in results:
            for r in found[:1]:
                if len(routes) < MAX_ROUTES and _is_distinct(r, routes):
                    routes.append(r)
                    added = True

    if len(routes) < MAX_ROUTES:
        for alt in _tomtom_alternatives(origin, destination):
            if len(routes) >= MAX_ROUTES:
                break
            if not all(mean_gap_miles(alt, e['coords']) >= DISTINCT_MILES for e in routes):
                continue
            vias = _via_points(alt, routes)
            if not vias:
                continue
            try:
                n = sum(r['label'].startswith('Alternative') for r in routes) + 1
                found = _parse_routes(_ors_request(origin, destination, via=vias), f'Alternative {n}')
            except ProviderError:
                continue
            if found and _is_distinct(found[0], routes):
                routes.append(found[0])
                added = True

    if added:
        warnings.append(VARIANTS_WARNING)
    elif fell_back:
        warnings.append(ALT_ROUTES_WARNING)
    elif len(routes) == 1:
        warnings.append('Only one distinct route exists between these points for this vehicle profile.')
    return routes, warnings
