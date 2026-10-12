from django.test import SimpleTestCase

from .classifiers import classify
from .ranking import rank_key, summarize


def level(wind=0, rain=0, snow=0, load=10000):
    return classify(wind, rain, snow, load)[0]


class ClassifierTests(SimpleTestCase):
    def test_wind_boundaries(self):
        for value, expected in [(24.9, 'LOW'), (25, 'MODERATE'), (34.9, 'MODERATE'), (35, 'HIGH'),
                                (44.9, 'HIGH'), (45, 'SEVERE'), (54.9, 'SEVERE'), (55, 'NO_TRAVEL')]:
            self.assertEqual(level(wind=value), expected, value)

    def test_rain_boundaries_shared_edges_take_higher_level(self):
        for value, expected in [(0.09, 'LOW'), (0.10, 'MODERATE'), (0.25, 'HIGH'), (0.50, 'SEVERE'),
                                (1.00, 'SEVERE'), (1.01, 'NO_TRAVEL')]:
            self.assertEqual(level(rain=value), expected, value)

    def test_snow_boundaries(self):
        for value, expected in [(0.49, 'LOW'), (0.5, 'MODERATE'), (1.0, 'HIGH'), (2.0, 'SEVERE'),
                                (3.0, 'SEVERE'), (3.01, 'NO_TRAVEL')]:
            self.assertEqual(level(snow=value), expected, value)

    def test_highest_hazard_wins(self):
        self.assertEqual(level(wind=26, rain=0.3, snow=2.5), 'SEVERE')

    def test_load_overrides(self):
        self.assertEqual(level(wind=50, load=30000), 'SEVERE')       # not > 30,000
        self.assertEqual(level(wind=50, load=30001), 'NO_TRAVEL')
        self.assertEqual(level(wind=40, load=40000), 'HIGH')         # not > 40,000
        self.assertEqual(level(wind=40, load=40001), 'SEVERE')
        self.assertEqual(level(wind=30, load=90000), 'MODERATE')     # below 35 mph: no override

    def test_missing_weather_is_unknown_not_low(self):
        self.assertEqual(classify(None, 0, 0, 1000)[0], 'UNKNOWN')
        self.assertEqual(classify(10, None, 0, 1000)[0], 'UNKNOWN')


class RankingTests(SimpleTestCase):
    def test_summarize_uses_preceding_checkpoint(self):
        s = summarize([(0, 'LOW'), (25, 'SEVERE'), (50, 'HIGH'), (60, 'UNKNOWN')])
        self.assertEqual((s['severe_miles'], s['high_miles'], s['unknown_miles']), (25, 10, 0))
        self.assertEqual(s['average_risk'], round((0 * 25 + 3 * 25 + 2 * 10) / 60, 3))
        self.assertFalse(s['has_no_travel'])

    def test_unknown_miles_counted_and_excluded_from_average(self):
        s = summarize([(0, 'UNKNOWN'), (10, 'LOW'), (20, 'LOW')])
        self.assertEqual((s['unknown_miles'], s['average_risk']), (10, 0))

    def test_all_unknown_has_no_average(self):
        self.assertIsNone(summarize([(0, 'UNKNOWN'), (10, 'UNKNOWN')])['average_risk'])

    def test_lexicographic_order(self):
        base = dict(severe_miles=0, high_miles=0, no_travel_miles=0, unknown_miles=0,
                    average_risk=0.5, has_no_travel=False)
        severe = {**base, 'severe_miles': 1}
        high = {**base, 'high_miles': 50}
        # fewer severe miles beats everything else, even a much longer trip
        self.assertLess(rank_key(high, 500), rank_key(severe, 1))
        # tie on severe -> fewer high miles
        self.assertLess(rank_key(base, 500), rank_key(high, 1))
        # tie on both -> lower average risk, then shorter duration
        self.assertLess(rank_key({**base, 'average_risk': 0.1}, 500), rank_key(base, 1))
        self.assertLess(rank_key(base, 10), rank_key(base, 20))

    def test_no_travel_ranks_last_and_unknown_is_not_free(self):
        base = dict(severe_miles=0, high_miles=0, no_travel_miles=0, unknown_miles=0,
                    average_risk=0, has_no_travel=False)
        self.assertLess(rank_key({**base, 'severe_miles': 99}, 1),
                        rank_key({**base, 'has_no_travel': True}, 1))
        self.assertLess(rank_key({**base, 'high_miles': 5}, 1), rank_key({**base, 'unknown_miles': 6}, 1))
