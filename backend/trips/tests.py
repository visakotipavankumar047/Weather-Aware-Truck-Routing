from datetime import UTC, datetime
from unittest.mock import patch

from django.core.cache import caches
from django.test import TestCase, override_settings

from api.http import ProviderError
from trips.models import Trip

DEP = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)
LINE = [(40.0, -105.0), (40.0, -104.0)]


def fake_routes(origin, destination):
    # fast+windy route and slower+calm route
    return [
        {'distance_miles': 50.0, 'duration_s': 3000.0, 'coords': LINE},
        {'distance_miles': 60.0, 'duration_s': 4000.0, 'coords': LINE},
    ], []


def fake_weather(points, times):
    """Distance isn't visible here, so key off the ETA: the fast route reaches its
    checkpoints earlier. Simpler: give every checkpoint at index-order alternating weather."""
    calm = {'forecast_time': 'x', 'wind_mph': 5.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}
    windy = {'forecast_time': 'x', 'wind_mph': 40.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}
    # first route's checkpoints come first; make the first route windy (HIGH), the rest calm
    n_first = 3  # 50 miles @ 25 -> 0, 25, 50
    return [windy if i < n_first else calm for i in range(len(points))]


BODY = {
    'origin': {'label': 'A', 'lat': 40.0, 'lon': -105.0},
    'destination': 'B',
    'departure_at': '2026-10-20T08:00:00Z',
    'load_weight_lb': 32000,
    'checkpoint_interval_miles': 25,
}


@override_settings(OPENROUTESERVICE_API_KEY='k')
class TripApiTests(TestCase):
    def setUp(self):
        caches['shared'].clear()

    def post(self, **over):
        return self.client.post('/api/trips/', {**BODY, **over}, content_type='application/json')

    def create(self):
        with patch('trips.services.fetch_routes', fake_routes), \
                patch('trips.services.forecast_at', fake_weather), \
                patch('trips.views.resolve_place', lambda v, f: v if 'lat' in v else {'label': 'B', 'lat': 40.0, 'lon': -104.0}):
            return self.post()

    def test_health(self):
        d = self.client.get('/api/health/').json()
        self.assertEqual(d['status'], 'ok')
        self.assertTrue(d['connected'])
        self.assertTrue(d['persistent'])  # local SQLite file counts as persistent

    def test_validation(self):
        for over in [{'load_weight_lb': 0}, {'checkpoint_interval_miles': 30}, {'origin': ''},
                     {'departure_at': '2026-10-20T08:00:00'}, {'departure_at': 'nope'}]:
            self.assertEqual(self.post(**over).status_code, 400, over)

    def test_create_and_recommend_calm_route(self):
        r = self.create()
        self.assertEqual(r.status_code, 201, r.content)
        data = r.json()
        by_rank = sorted(data['routes'], key=lambda x: x['rank'])
        self.assertEqual(data['recommended_route_id'], by_rank[0]['id'])
        self.assertEqual(by_rank[0]['distance_miles'], 60.0)  # longer but calm beats shorter + 25 high miles
        self.assertEqual(by_rank[1]['risk_summary']['high_miles'], 50.0)
        self.assertEqual(by_rank[0]['checkpoints'][0]['risk'], 'LOW')
        self.assertEqual(by_rank[1]['checkpoints'][0]['risk'], 'HIGH')
        self.assertEqual(len(by_rank[0]['geometry']), 2)

    def test_read_endpoints(self):
        data = self.create().json()
        tid = data['trip_id']
        self.assertEqual(self.client.get(f'/api/trips/{tid}/').json()['recommended_route_id'],
                         data['recommended_route_id'])
        self.assertNotIn('geometry', self.client.get(f'/api/trips/{tid}/').json()['routes'][0])
        self.assertIn('geometry', self.client.get(f'/api/trips/{tid}/routes/').json()[0])
        cps = self.client.get(f'/api/trips/{tid}/checkpoints/').json()
        self.assertEqual(len(cps), 2)
        one = self.client.get(f'/api/trips/{tid}/checkpoints/?route_id={cps[0]["route_id"]}').json()
        self.assertEqual(len(one), 1)
        self.assertEqual(self.client.get('/api/trips/00000000-0000-0000-0000-000000000000/').status_code, 404)

    def test_forecast_offset_rescoring_and_validation(self):
        tid = self.create().json()['trip_id']

        def all_windy(points, times):
            return [{'forecast_time': 'x', 'wind_mph': 60.0, 'rain_in_hr': 0, 'snow_in_hr': 0}] * len(points)

        with patch('trips.services.forecast_at', all_windy):
            d = self.client.get(f'/api/trips/{tid}/forecast/?offset_hours=6').json()
        self.assertEqual(d['offset_hours'], 6)
        self.assertIsNone(d['recommended_route_id'])  # NO_TRAVEL everywhere -> nothing recommended
        self.assertTrue(all(not r['eligible'] for r in d['routes']))
        for bad in ('49', '-1', 'x'):
            self.assertEqual(self.client.get(f'/api/trips/{tid}/forecast/?offset_hours={bad}').status_code, 400)

    def test_missing_forecast_is_unknown_and_warned(self):
        with patch('trips.services.fetch_routes', fake_routes), \
                patch('trips.services.forecast_at', lambda p, t: [None] * len(p)):
            r = self.post(destination={'label': 'B', 'lat': 40.0, 'lon': -104.0})
        data = r.json()
        self.assertEqual({c['risk'] for rt in data['routes'] for c in rt['checkpoints']}, {'UNKNOWN'})
        self.assertTrue(any('UNKNOWN' in w for w in data['warnings']))
        self.assertGreater(data['routes'][0]['risk_summary']['unknown_miles'], 0)

    def test_provider_failure_returns_error_and_leaves_no_trip(self):
        def boom(*a):
            raise ProviderError('OpenRouteService timed out.', 504)

        with patch('trips.services.fetch_routes', boom):
            r = self.post(destination={'label': 'B', 'lat': 40.0, 'lon': -104.0})
        self.assertEqual(r.status_code, 504)
        self.assertEqual(Trip.objects.count(), 0)

    def test_reanalyze_replaces_routes(self):
        tid = self.create().json()['trip_id']
        with patch('trips.services.fetch_routes', lambda o, d: ([fake_routes(o, d)[0][0]], [])), \
                patch('trips.services.forecast_at', fake_weather):
            r = self.client.post(f'/api/trips/{tid}/reanalyze/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()['routes']), 1)
