"""Traffic-aware ETA and congested sections for a stored trip (TomTom Routing API).

TomTom computes its own route, so each of our stored routes is matched to the TomTom
route that follows the same roads; congestion is only reported for a confident match,
never drawn on a route that takes a different road."""
from datetime import timedelta

from django.conf import settings
from django.core.cache import caches
from django.utils import timezone

from api.http import ProviderError, request_json
from routing.geometry import mean_gap_miles

MATCH_MILES = 0.6  # mean distance between the two polylines for them to be "the same route"
CACHE_SECONDS = 5 * 60
cache = caches['shared']


def _fetch(origin, destination, depart_at):
    params = {
        'key': settings.TOMTOM_API_KEY,
        'traffic': 'true',
        'sectionType': 'traffic',
        'travelMode': 'truck',
        'maxAlternatives': 2,
        'routeRepresentation': 'polyline',
        'computeTravelTimeFor': 'all',
    }
    if depart_at:
        params['departAt'] = depart_at.isoformat(timespec='seconds')
    path = f'{origin[0]},{origin[1]}:{destination[0]},{destination[1]}'
    return request_json(
        'GET', f'{settings.TOMTOM_BASE_URL}/routing/1/calculateRoute/{path}/json',
        provider='TomTom routing', params=params,
    )


def parse_routes(data):
    """TomTom response -> [{points, travel_s, typical_s, delay_s, sections}]."""
    out = []
    try:
        for r in data['routes']:
            pts = [(p['latitude'], p['longitude']) for leg in r['legs'] for p in leg['points']]
            s = r['summary']
            sections = []
            for sec in r.get('sections', []):
                if sec.get('sectionType') != 'TRAFFIC':
                    continue
                delay = sec.get('delayInSeconds', 0)
                mag = sec.get('magnitudeOfDelay', 0)
                if delay <= 0 and mag <= 0:
                    continue
                a, b = sec['startPointIndex'], sec['endPointIndex']
                sections.append({
                    'magnitude': mag,
                    'delay_s': delay,
                    'category': sec.get('simpleCategory', 'JAM'),
                    'points': [[lat, lon] for lat, lon in pts[a:b + 1]],
                })
            out.append({
                'points': pts,
                'travel_s': s['travelTimeInSeconds'],
                'delay_s': s.get('trafficDelayInSeconds', 0),
                'typical_s': s.get('noTrafficTravelTimeInSeconds', s['travelTimeInSeconds']),
                'sections': sections,
            })
    except (KeyError, TypeError, IndexError):
        raise ProviderError('TomTom routing returned an unexpected response.')
    return out


def match_routes(stored, tomtom):
    """stored: [(route_id, geometry)]. -> {route_id: tomtom_route | None}."""
    result = {}
    for route_id, geometry in stored:
        best, best_gap = None, MATCH_MILES
        for t in tomtom:
            gap = mean_gap_miles(geometry, t['points'])
            if gap < best_gap:
                best, best_gap = t, gap
        result[route_id] = best
    return result


def traffic_for_routes(origin, dest, departure_at, offset_hours, routes, cache_key):
    """origin/dest: (lat, lon); routes: [(route_id, geometry)]. Cached 5 minutes under cache_key."""
    if not settings.TOMTOM_API_KEY:
        return {'enabled': False, 'offset_hours': offset_hours, 'routes': []}
    hit = cache.get(cache_key)
    if hit is not None:
        return hit

    depart = departure_at + timedelta(hours=offset_hours)
    now = timezone.now()
    depart_at = depart if depart > now + timedelta(minutes=2) else None  # past times mean "now"
    try:
        data = _fetch(origin, dest, depart_at)
    except ProviderError as e:
        if depart_at is None or e.upstream not in (400, 422):
            raise
        data = _fetch(origin, dest, None)  # departure too far ahead for predictive traffic
    tomtom = parse_routes(data)

    matches = match_routes(routes, tomtom)
    out = []
    for route_id, _geometry in routes:
        t = matches[route_id]
        if t is None:
            out.append({'route_id': route_id, 'matched': False})
            continue
        out.append({
            'route_id': route_id,
            'matched': True,
            'travel_minutes': round(t['travel_s'] / 60, 1),
            'typical_minutes': round(t['typical_s'] / 60, 1),
            'delay_minutes': round(t['delay_s'] / 60, 1),
            'sections': t['sections'],
        })
    result = {'enabled': True, 'offset_hours': offset_hours, 'routes': out}
    cache.set(cache_key, result, CACHE_SECONDS)
    return result


def trip_traffic(trip, offset_hours=0):
    """Traffic for a stored trip (DB-backed endpoint)."""
    return traffic_for_routes(
        (trip.origin.lat, trip.origin.lon), (trip.destination.lat, trip.destination.lon),
        trip.departure_at, offset_hours, [(r.id, r.geometry) for r in trip.routes.all()],
        f'traffic:{trip.pk}:{offset_hours}',
    )
