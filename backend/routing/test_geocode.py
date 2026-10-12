from unittest.mock import patch

from django.core.cache import caches
from django.test import SimpleTestCase, override_settings

from api.http import ProviderError

from . import providers

ORS = {'features': [{'properties': {'label': 'Denver, CO, USA'}, 'geometry': {'coordinates': [-104.99, 39.74]}}]}
NOM = [{'display_name': 'Denver, Colorado', 'lat': '39.74', 'lon': '-104.99'}]


@override_settings(OPENROUTESERVICE_API_KEY='k', NOMINATIM_USER_AGENT='App/1.0 (contact: placeholder@example.com)')
class GeocodeTests(SimpleTestCase):
    def setUp(self):
        caches['shared'].clear()

    def test_ors_is_used_parsed_and_cached(self):
        with patch.object(providers, 'request_json', return_value=ORS) as rj:
            first = providers.geocode('Denver')
            second = providers.geocode('Denver')
        self.assertEqual(first, [{'label': 'Denver, CO, USA', 'lat': 39.74, 'lon': -104.99}])
        self.assertEqual(first, second)
        self.assertEqual(rj.call_count, 1)

    @override_settings(NOMINATIM_USER_AGENT='App/1.0 (contact: dev@mycompany.io)')
    def test_falls_back_to_nominatim_with_real_contact(self):
        def fake(method, url, **kw):
            if 'geocode/search' in url:
                raise ProviderError('boom')
            return NOM

        with patch.object(providers, 'request_json', side_effect=fake):
            self.assertEqual(providers.geocode('Denver')[0]['label'], 'Denver, Colorado')

    def test_placeholder_user_agent_never_used(self):
        with patch.object(providers, 'request_json', side_effect=ProviderError('boom')):
            with self.assertRaises(ProviderError):
                providers.geocode('Denver')

    @override_settings(OPENROUTESERVICE_API_KEY='', NOMINATIM_USER_AGENT='')
    def test_no_geocoder_configured(self):
        with self.assertRaises(ProviderError) as cm:
            providers.geocode('Denver')
        self.assertEqual(cm.exception.status_code, 503)
