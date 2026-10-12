from datetime import UTC, datetime
from unittest.mock import patch

from django.core.cache import caches
from django.test import SimpleTestCase, TestCase, override_settings

from . import traffic
from .models import Place, Route, Trip

LINE = [(40.0, -105.0 + i * 0.1) for i in range(11)]  # ~8.5 mi east-west line
FAR = [(41.0, -105.0 + i * 0.1) for i in range(11)]   # ~69 mi north of LINE


def tomtom_response(points, delay=240, sections=True):
    return {'routes': [{
        'summary': {'travelTimeInSeconds': 1800 + delay, 'trafficDelayInSeconds': delay,
                    'noTrafficTravelTimeInSeconds': 1800},
        'legs': [{'points': [{'latitude': a, 'longitude': b} for a, b in points]}],
        'sections': [
            {'sectionType': 'TRAFFIC', 'startPointIndex': 2, 'endPointIndex': 5, 'simpleCategory': 'JAM',
             'delayInSeconds': delay, 'magnitudeOfDelay': 2},
            {'sectionType': 'TRAFFIC', 'startPointIndex': 6, 'endPointIndex': 7, 'delayInSeconds': 0,
             'magnitudeOfDelay': 0},
            {'sectionType': 'TRAVEL_MODE', 'startPointIndex': 0, 'endPointIndex': 10},
        ] if sections else [],
    }]}


class ParseAndMatchTests(SimpleTestCase):
    def test_only_delaying_traffic_sections_are_kept(self):
        (r,) = traffic.parse_routes(tomtom_response(LINE))
        self.assertEqual((r['travel_s'], r['delay_s'], r['typical_s']), (2040, 240, 1800))
        self.assertEqual(len(r['sections']), 1)
        self.assertEqual(len(r['sections'][0]['points']), 4)
        self.assertEqual(r['sections'][0]['magnitude'], 2)

    def test_matches_same_road_and_rejects_different_road(self):
        (t,) = traffic.parse_routes(tomtom_response(LINE))
        got = traffic.match_routes([(1, [list(p) for p in LINE]), (2, [list(p) for p in FAR])], [t])
        self.assertIs(got[1], t)
        self.assertIsNone(got[2])  # a route on another road never receives this congestion


@override_settings(TOMTOM_API_KEY='k')
class EndpointTests(TestCase):
    def setUp(self):
        caches['shared'].clear()
        self.trip = Trip.objects.create(
            origin=Place.objects.create(label='A', lat=40.0, lon=-105.0),
            destination=Place.objects.create(label='B', lat=40.0, lon=-104.0), departure_at=datetime(2026, 10, 20, 8, tzinfo=UTC),
            load_weight_lb=30000, checkpoint_interval_miles=25,
        )
        Route.objects.create(trip=self.trip, rank=1, eligible=True, distance_miles=8, duration_minutes=15,
                             geometry=[list(p) for p in LINE], risk_summary={})

    def test_matched_route_gets_delay_and_sections(self):
        with patch.object(traffic, '_fetch', return_value=tomtom_response(LINE)):
            d = self.client.get(f'/api/trips/{self.trip.id}/traffic/?offset_hours=2').json()
        self.assertTrue(d['enabled'])
        (r,) = d['routes']
        self.assertTrue(r['matched'])
        self.assertEqual((r['delay_minutes'], r['typical_minutes']), (4.0, 30.0))
        self.assertEqual(len(r['sections']), 1)

    def test_future_departure_too_far_ahead_retries_without_it(self):
        from api.http import ProviderError

        calls = []

        def fake(o, d, depart_at):
            calls.append(depart_at)
            if depart_at is not None:
                raise ProviderError('too far', 422, upstream=400)
            return tomtom_response(LINE)

        with patch.object(traffic, '_fetch', side_effect=fake), \
                patch.object(traffic.timezone, 'now', return_value=datetime(2026, 10, 1, tzinfo=UTC)):
            r = self.client.get(f'/api/trips/{self.trip.id}/traffic/')
        self.assertEqual(r.status_code, 200)
        self.assertIsNotNone(calls[0])
        self.assertIsNone(calls[1])

    @override_settings(TOMTOM_API_KEY='')
    def test_disabled_without_key(self):
        d = self.client.get(f'/api/trips/{self.trip.id}/traffic/').json()
        self.assertEqual((d['enabled'], d['routes']), (False, []))

    def test_validates_offset(self):
        self.assertEqual(self.client.get(f'/api/trips/{self.trip.id}/traffic/?offset_hours=99').status_code, 400)
