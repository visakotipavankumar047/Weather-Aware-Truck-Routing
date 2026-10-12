from unittest.mock import patch

from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import ValidationError

from api.http import ProviderError

from . import providers
from .geometry import haversine_miles, sample_checkpoints

LINE = [(40.0, -105.0), (40.0, -104.0), (40.0, -103.0)]  # ~53 miles per degree of lon at 40N


class GeometryTests(SimpleTestCase):
    def test_includes_start_and_end_and_spacing(self):
        total = haversine_miles(LINE[0], LINE[-1])
        cps = sample_checkpoints(LINE, total, 7200, 25)
        self.assertEqual([c['distance_miles'] for c in cps], [0, 25, 50, 75, 100, round(total, 2)])
        self.assertEqual((cps[0]['lat'], cps[0]['lon']), LINE[0])
        self.assertAlmostEqual(cps[-1]['lon'], -103.0, places=6)
        self.assertAlmostEqual(cps[-1]['eta_seconds'], 7200)

    def test_eta_is_linear_in_distance(self):
        cps = sample_checkpoints(LINE, 100, 6000, 25)
        self.assertEqual([c['eta_seconds'] for c in cps], [0, 1500, 3000, 4500, 6000])

    def test_short_route_has_only_start_and_end(self):
        self.assertEqual(len(sample_checkpoints(LINE, 5, 300, 50)), 2)

    def test_intervals_10_25_50(self):
        for interval, n in [(10, 11), (25, 5), (50, 3)]:
            self.assertEqual(len(sample_checkpoints(LINE, 100, 6000, interval)), n)


def ors_feature(distance, duration):
    return {'properties': {'summary': {'distance': distance, 'duration': duration}},
            'geometry': {'coordinates': [[-105, 40], [-104, 40]]}}


@override_settings(OPENROUTESERVICE_API_KEY='k')
class ProviderTests(SimpleTestCase):
    O, D = {'lat': 40, 'lon': -105}, {'lat': 40, 'lon': -104}

    def test_duplicate_routes_are_dropped(self):
        data = {'features': [ors_feature(1000, 60), ors_feature(1000, 60), ors_feature(2000, 90)]}
        with patch.object(providers, 'request_json', return_value=data):
            routes, _ = providers.fetch_routes(self.O, self.D)
        self.assertEqual(len(routes), 2)

    def test_alternatives_400_falls_back_to_single_route_with_warning(self):
        calls = []

        def fake(method, url, **kw):
            calls.append('alternative_routes' in kw['json'])
            if calls[-1]:
                raise ProviderError('bad', upstream=400)
            return {'features': [ors_feature(1000, 60)]}

        with patch.object(providers, 'request_json', side_effect=fake):
            routes, warnings = providers.fetch_routes(self.O, self.D)
        self.assertEqual(calls[:2], [True, False])
        self.assertEqual(len(routes), 1)
        self.assertIn(providers.ALT_ROUTES_WARNING, warnings)

    def test_other_provider_errors_propagate(self):
        with patch.object(providers, 'request_json', side_effect=ProviderError('x', 503, upstream=429)):
            with self.assertRaises(ProviderError):
                providers.fetch_routes(self.O, self.D)

    def test_malformed_response(self):
        with patch.object(providers, 'request_json', return_value={'features': [{}]}):
            with self.assertRaises(ProviderError):
                providers.fetch_routes(self.O, self.D)

    @override_settings(OPENROUTESERVICE_API_KEY='')
    def test_missing_key(self):
        with self.assertRaises(ProviderError) as cm:
            providers.fetch_routes(self.O, self.D)
        self.assertEqual(cm.exception.status_code, 503)

    def test_resolve_place(self):
        resolved = {'label': 'x', 'lat': 1.0, 'lon': 2.0}
        self.assertEqual(providers.resolve_place(resolved, 'origin'), resolved)
        with patch.object(providers, 'geocode', return_value=[]):
            with self.assertRaises(ValidationError):
                providers.resolve_place({'query': 'nowhere'}, 'origin')
