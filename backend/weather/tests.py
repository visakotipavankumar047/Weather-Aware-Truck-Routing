from datetime import UTC, datetime
from unittest.mock import patch

from django.core.cache import caches
from django.test import SimpleTestCase

from api.http import ProviderError

from . import providers, services

T = datetime(2026, 10, 20, 8, 0, tzinfo=UTC)


def om_result(snow_unit='inch'):
    return {
        'hourly_units': {'snowfall': snow_unit},
        'hourly': {
            'time': ['2026-10-20T08:00', '2026-10-20T09:00'],
            'wind_speed_10m': [10.0, None],
            'rain': [0.05, 0.0], 'showers': [0.02, 0.0], 'snowfall': [2.54, 0.0],
        },
    }


class ProviderTests(SimpleTestCase):
    def fetch(self, data, n=1):
        with patch.object(providers, 'request_json', return_value=data):
            return providers.fetch_hourly([(40.0, -105.0)] * n)

    def test_parse_sums_rain_and_showers_and_skips_incomplete_hours(self):
        (series,) = self.fetch(om_result())
        self.assertEqual(list(series), [T])  # 09:00 had a null wind -> omitted (UNKNOWN)
        self.assertAlmostEqual(series[T]['rain_in_hr'], 0.07)
        self.assertEqual(series[T]['wind_mph'], 10.0)

    def test_snowfall_cm_is_converted_to_inches(self):
        (series,) = self.fetch(om_result('cm'))
        self.assertAlmostEqual(series[T]['snow_in_hr'], 1.0)

    def test_batch_response_is_a_list(self):
        self.assertEqual(len(self.fetch([om_result(), om_result()], n=2)), 2)

    def test_wrong_count_or_shape_is_an_error(self):
        with self.assertRaises(ProviderError):
            self.fetch([om_result()], n=2)
        with self.assertRaises(ProviderError):
            self.fetch({'hourly': {}})


class ServiceTests(SimpleTestCase):
    def setUp(self):
        caches['shared'].clear()

    def test_nearest_hour_matching_and_missing_is_none(self):
        full = {'forecast_time': T.isoformat(), 'wind_mph': 1.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}
        series = {T: full}
        with patch.object(providers, 'fetch_hourly', return_value=[series]) as f:
            out = services.forecast_at(
                [(40.001, -105.001)] * 3,
                [T.replace(minute=20), T.replace(minute=40), T.replace(hour=20)],
            )
        self.assertEqual(out, [full, None, None])
        f.assert_called_once()  # three identical grid cells -> one upstream request

    def test_second_call_hits_cache(self):
        with patch.object(providers, 'fetch_hourly', return_value=[{T: {'forecast_time': 'x', 'wind_mph': 1.0, 'rain_in_hr': 0.0, 'snow_in_hr': 0.0}}]) as f:
            services.forecast_at([(40.0, -105.0)], [T])
            services.forecast_at([(40.0, -105.0)], [T])
        self.assertEqual(f.call_count, 1)
