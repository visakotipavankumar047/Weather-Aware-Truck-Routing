from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from . import traffic

CP = [
    {'sequence': 0, 'distance_miles': 0, 'lat': 40.0, 'lon': -105.0, 'eta': '2026-10-20T08:00:00Z'},
    {'sequence': 1, 'distance_miles': 25, 'lat': 40.0, 'lon': -104.6, 'eta': '2026-10-20T08:30:00Z'},
    {'sequence': 2, 'distance_miles': 50, 'lat': 40.0, 'lon': -104.2, 'eta': '2026-10-20T09:00:00Z'},
]


def calm(points, times):
    return [{'forecast_time': 'x', 'wind_mph': 5.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}] * len(points)


def windy_after_noon(points, times):
    # departure delays of >= 6 h push every ETA into 60 mph wind (NO_TRAVEL)
    return [
        {'forecast_time': 'x', 'wind_mph': 60.0 if t.hour >= 14 else 5.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}
        for t in times
    ]


BODY = {'load_weight_lb': 32000, 'routes': [
    {'id': 7, 'distance_miles': 50, 'duration_minutes': 60, 'checkpoints': CP},
]}


class StatelessForecastTests(SimpleTestCase):
    def post(self, path, body):
        return self.client.post(path, body, content_type='application/json')

    def test_forecast_needs_no_stored_trip_and_shifts_etas(self):
        with patch('trips.services.forecast_at', calm):
            d = self.post('/api/forecast/', {**BODY, 'offset_hours': 6}).json()
        self.assertEqual(d['offset_hours'], 6)
        self.assertEqual(d['recommended_route_id'], 7)
        self.assertTrue(d['routes'][0]['checkpoints'][0]['eta'].startswith('2026-10-20T14:00'))
        self.assertEqual(d['routes'][0]['checkpoints'][0]['risk'], 'LOW')

    def test_sweep_scores_many_offsets_in_one_request(self):
        with patch('trips.services.forecast_at', windy_after_noon):
            d = self.post('/api/forecast/sweep/', {**BODY, 'offsets': [0, 3, 6, 12]}).json()
        got = {o['offset_hours']: o['recommended_route_id'] for o in d['offsets']}
        self.assertEqual(got[0], 7)
        self.assertIsNone(got[12])  # NO_TRAVEL everywhere at +12 h: nothing recommended
        self.assertNotIn('checkpoints', d['offsets'][0]['routes'][0])  # summaries only, keeps it small

    def test_validation(self):
        bad = {**BODY, 'offset_hours': 99}
        self.assertEqual(self.post('/api/forecast/', bad).status_code, 400)
        naive = {**BODY, 'routes': [{**BODY['routes'][0], 'checkpoints': [{**CP[0], 'eta': '2026-10-20T08:00:00'}]}]}
        self.assertEqual(self.post('/api/forecast/', naive).status_code, 400)
        self.assertEqual(self.post('/api/forecast/', {'load_weight_lb': 5, 'routes': []}).status_code, 400)


LINE = [[40.0, -105.0 + i * 0.1] for i in range(11)]


@override_settings(TOMTOM_API_KEY='k')
class StatelessTrafficTests(SimpleTestCase):
    def test_traffic_for_routes_in_the_request(self):
        data = {'routes': [{
            'summary': {'travelTimeInSeconds': 2040, 'trafficDelayInSeconds': 240, 'noTrafficTravelTimeInSeconds': 1800},
            'legs': [{'points': [{'latitude': a, 'longitude': b} for a, b in LINE]}],
            'sections': [{'sectionType': 'TRAFFIC', 'startPointIndex': 2, 'endPointIndex': 5,
                          'simpleCategory': 'JAM', 'delayInSeconds': 240, 'magnitudeOfDelay': 2}],
        }]}
        body = {
            'origin': {'lat': 40.0, 'lon': -105.0}, 'destination': {'lat': 40.0, 'lon': -104.0},
            'departure_at': '2026-10-20T08:00:00Z', 'offset_hours': 0,
            'routes': [{'id': 3, 'geometry': LINE}],
        }
        with patch.object(traffic, '_fetch', return_value=data) as f:
            r = self.client.post('/api/traffic/routes/', body, content_type='application/json')
        self.assertEqual(r.status_code, 200)
        (route,) = r.json()['routes']
        self.assertEqual((route['route_id'], route['matched'], route['delay_minutes']), (3, True, 4.0))
        f.assert_called_once()
