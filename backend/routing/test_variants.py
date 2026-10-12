from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from . import providers


def feature(distance, duration, lat0):
    # two-point line; different lat0 gives a physically different road
    return {'properties': {'summary': {'distance': distance, 'duration': duration}},
            'geometry': {'coordinates': [[-105.0, lat0], [-104.0, lat0]]}}


O, D = {'lat': 40, 'lon': -105}, {'lat': 40, 'lon': -104}


@override_settings(OPENROUTESERVICE_API_KEY='k', TOMTOM_API_KEY='')
class VariantTests(SimpleTestCase):
    def fake(self, by_variant):
        def _fake(method, url, **kw):
            body = kw['json']
            if 'alternative_routes' in body:
                return {'features': [feature(100000, 3600, 40.0)]}
            if body.get('preference') == 'shortest':
                return {'features': [by_variant['shortest']]}
            if 'highways' in body.get('options', {}).get('avoid_features', []):
                return {'features': [by_variant['highways']]}
            return {'features': [by_variant['tolls']]}
        return _fake

    def test_variants_fill_up_to_three_distinct_routes(self):
        data = {'shortest': feature(90000, 3900, 41.0),      # different road
                'highways': feature(120000, 4500, 42.0),     # different road
                'tolls': feature(100000, 3600, 40.0)}        # same road as the first: dropped
        with patch.object(providers, 'request_json', side_effect=self.fake(data)):
            routes, warnings = providers.fetch_routes(O, D)
        self.assertEqual(len(routes), 3)
        self.assertEqual({r['label'] for r in routes}, {'', 'Shortest', 'Avoids highways'})
        self.assertIn(providers.VARIANTS_WARNING, warnings)

    def test_same_road_is_never_returned_twice(self):
        same = feature(100000, 3600, 40.0)
        data = {'shortest': same, 'highways': feature(100500, 3650, 40.0), 'tolls': same}
        with patch.object(providers, 'request_json', side_effect=self.fake(data)):
            routes, warnings = providers.fetch_routes(O, D)
        self.assertEqual(len(routes), 1)
        self.assertNotIn(providers.VARIANTS_WARNING, warnings)

    def test_failing_variant_does_not_break_the_trip(self):
        from api.http import ProviderError

        def fake(method, url, **kw):
            if 'alternative_routes' in kw['json']:
                return {'features': [feature(100000, 3600, 40.0)]}
            raise ProviderError('boom', 502)

        with patch.object(providers, 'request_json', side_effect=fake):
            routes, _ = providers.fetch_routes(O, D)
        self.assertEqual(len(routes), 1)


@override_settings(OPENROUTESERVICE_API_KEY='k', TOMTOM_API_KEY='t')
class TomTomGuideTests(SimpleTestCase):
    def test_tomtom_alternative_is_replanned_through_ors_with_via_points(self):
        guide = [(40.0 + 1.0 + i * 0.001, -105.0 + i * 0.01) for i in range(101)]  # ~69 mi north of the base
        sent = []

        def fake(method, url, **kw):
            if 'tomtom' in url or 'calculateRoute' in url:
                return {'routes': [{'legs': [{'points': [{'latitude': a, 'longitude': b} for a, b in guide]}]}]}
            body = kw['json']
            sent.append(body)
            if 'alternative_routes' in body:
                return {'features': [feature(100000, 3600, 40.0)]}
            if len(body['coordinates']) > 2:  # the via request
                return {'features': [feature(130000, 5000, 41.0)]}
            return {'features': [feature(100000, 3600, 40.0)]}  # variants: same road, dropped

        with patch.object(providers, 'request_json', side_effect=fake):
            routes, warnings = providers.fetch_routes(O, D)
        self.assertEqual([r['label'] for r in routes], ['', 'Alternative 1'])
        via_body = next(b for b in sent if len(b['coordinates']) > 2)
        self.assertEqual(len(via_body['radiuses']), len(via_body['coordinates']))
        self.assertIn(providers.VARIANTS_WARNING, warnings)

    def test_tomtom_failure_is_ignored(self):
        from api.http import ProviderError

        def fake(method, url, **kw):
            if 'calculateRoute' in url:
                raise ProviderError('down', 502)
            return {'features': [feature(100000, 3600, 40.0)]}

        with patch.object(providers, 'request_json', side_effect=fake):
            routes, _ = providers.fetch_routes(O, D)
        self.assertEqual(len(routes), 1)
