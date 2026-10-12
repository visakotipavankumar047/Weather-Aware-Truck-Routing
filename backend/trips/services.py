"""Analysis pipeline. External I/O happens in `analyze`/`score_routes`; `save` is the only DB writer."""
from datetime import timedelta

from django.db import transaction

from risk_engine.classifiers import classify
from risk_engine.ranking import rank_key, summarize
from routing.geometry import sample_checkpoints
from routing.providers import fetch_routes
from weather.services import forecast_at

from .models import Checkpoint, Route


def score_routes(routes, load_lb):
    """Attach weather/risk to checkpoints and rank routes, in place.

    routes: [{distance_miles, duration_minutes, checkpoints: [{distance_miles, lat, lon, eta}]}]
    Adds per-checkpoint weather/risk/reasons and per-route risk_summary/eligible/rank.
    Returns the index of the recommended route, or None if every route has a NO_TRAVEL
    checkpoint (we never recommend a route the rules forbid travelling)."""
    cps = [c for r in routes for c in r['checkpoints']]
    wx = forecast_at([(c['lat'], c['lon']) for c in cps], [c['eta'] for c in cps])
    for c, w in zip(cps, wx):
        c['weather'] = w
        w = w or {}
        c['risk'], c['reasons'] = classify(
            w.get('wind_mph'), w.get('rain_in_hr'), w.get('snow_in_hr'), load_lb
        )
    for r in routes:
        r['risk_summary'] = summarize([(c['distance_miles'], c['risk']) for c in r['checkpoints']])
        r['eligible'] = not r['risk_summary']['has_no_travel']
    order = sorted(range(len(routes)), key=lambda i: rank_key(routes[i]['risk_summary'], routes[i]['duration_minutes']))
    for rank, i in enumerate(order, 1):
        routes[i]['rank'] = rank
    best = order[0]
    return best if routes[best]['eligible'] else None


def analyze(origin, destination, departure_at, load_lb, interval_miles):
    """-> {routes: [...scored...], recommended: index | None, warnings: [...]}. No DB access."""
    raw, warnings = fetch_routes(origin, destination)
    routes = []
    for r in raw:
        cps = sample_checkpoints(r['coords'], r['distance_miles'], r['duration_s'], interval_miles)
        for c in cps:
            c['eta'] = departure_at + timedelta(seconds=c.pop('eta_seconds'))
        routes.append({
            'distance_miles': round(r['distance_miles'], 2),
            'duration_minutes': round(r['duration_s'] / 60, 1),
            'label': r.get('label', ''),
            'geometry': [[lat, lon] for lat, lon in r['coords']],
            'checkpoints': cps,
        })
    recommended = score_routes(routes, load_lb)
    unknown = sum(c['risk'] == 'UNKNOWN' for r in routes for c in r['checkpoints'])
    if unknown:
        warnings.append(
            f'{unknown} checkpoint(s) have no forecast (outside the forecast horizon or missing data); '
            'they are reported as UNKNOWN, not safe, and counted pessimistically in ranking.'
        )
    if recommended is None:
        warnings.append('Every route contains a NO_TRAVEL checkpoint; no route is recommended.')
    return {'routes': routes, 'recommended': recommended, 'warnings': warnings}


@transaction.atomic
def save(trip, result):
    """Replace the trip's routes/checkpoints with `result` and update the recommendation."""
    trip.routes.all().delete()
    recommended_id = None
    for i, r in enumerate(result['routes']):
        route = Route.objects.create(
            trip=trip, label=r.get('label', ''), rank=r['rank'], eligible=r['eligible'], distance_miles=r['distance_miles'],
            duration_minutes=r['duration_minutes'], geometry=r['geometry'], risk_summary=r['risk_summary'],
        )
        Checkpoint.objects.bulk_create(
            Checkpoint(
                route=route, sequence=n, distance_miles=c['distance_miles'], lat=c['lat'], lon=c['lon'],
                eta=c['eta'], weather=c['weather'], risk=c['risk'], reasons=c['reasons'],
            )
            for n, c in enumerate(r['checkpoints'])
        )
        if i == result['recommended']:
            recommended_id = route.id
    trip.recommended_route_id = recommended_id
    trip.warnings = result['warnings']
    trip.save()
    return trip


def rescore(routes, load_lb, offset_hours):
    """Re-score plain route dicts with every ETA shifted by `offset_hours` (a delayed departure).
    No database access: the caller supplies the checkpoints. Input dicts are not modified."""
    shifted = [
        {**r, 'checkpoints': [{**c, 'eta': c['eta'] + timedelta(hours=offset_hours)} for c in r['checkpoints']]}
        for r in routes
    ]
    best = score_routes(shifted, load_lb)
    return {'routes': shifted, 'recommended_route_id': None if best is None else shifted[best]['id']}


def forecast(trip, offset_hours):
    """Re-score the stored routes of a trip for a delayed departure."""
    routes = []
    for route in trip.routes.prefetch_related('checkpoints'):
        routes.append({
            'id': route.id,
            'distance_miles': route.distance_miles,
            'duration_minutes': route.duration_minutes,
            'checkpoints': [
                {'sequence': c.sequence, 'distance_miles': c.distance_miles, 'lat': c.lat, 'lon': c.lon, 'eta': c.eta}
                for c in route.checkpoints.all()
            ],
        })
    return rescore(routes, trip.load_weight_lb, offset_hours)
