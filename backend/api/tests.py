from unittest.mock import MagicMock, patch

from django.test import TestCase, override_settings


class TrafficTests(TestCase):
    @override_settings(TOMTOM_API_KEY='')
    def test_disabled_without_key(self):
        self.assertFalse(self.client.get('/api/traffic/status/').json()['enabled'])
        self.assertEqual(self.client.get('/api/traffic/tiles/5/6/12.png').status_code, 503)

    @override_settings(TOMTOM_API_KEY='k')
    def test_status_enabled_and_key_never_exposed(self):
        body = self.client.get('/api/traffic/status/').content.decode()
        self.assertIn('"enabled":true', body.replace(' ', ''))
        self.assertNotIn('"k"', body)

    @override_settings(TOMTOM_API_KEY='k')
    def test_tile_is_proxied_with_cache_header(self):
        upstream = MagicMock(status_code=200, content=b'\x89PNG')
        with patch('api.traffic.httpx.get', return_value=upstream) as get:
            r = self.client.get('/api/traffic/tiles/5/6/12.png')
        self.assertEqual((r.status_code, r['Content-Type']), (200, 'image/png'))
        self.assertIn('max-age', r['Cache-Control'])
        self.assertIn('/flow/relative-delay/5/6/12.png', get.call_args.args[0])

    @override_settings(TOMTOM_API_KEY='k')
    def test_invalid_tile_coordinates(self):
        self.assertEqual(self.client.get('/api/traffic/tiles/2/9/0.png').status_code, 404)

    @override_settings(TOMTOM_API_KEY='k')
    def test_empty_and_failing_provider(self):
        with patch('api.traffic.httpx.get', return_value=MagicMock(status_code=404)):
            self.assertEqual(self.client.get('/api/traffic/tiles/5/6/12.png').status_code, 204)
        with patch('api.traffic.httpx.get', return_value=MagicMock(status_code=403)):
            self.assertEqual(self.client.get('/api/traffic/tiles/5/6/12.png').status_code, 502)


class ProviderErrorMappingTests(TestCase):
    def _call(self, status, body):
        from api.http import request_json

        resp = MagicMock(status_code=status)
        resp.json.return_value = body
        with patch('api.http.httpx.request', return_value=resp):
            return request_json('GET', 'http://x', provider='Prov')

    def test_provider_rejection_is_422_with_its_message(self):
        from api.http import ProviderError

        with self.assertRaises(ProviderError) as cm:
            self._call(404, {'error': {'code': 2010, 'message': 'Route could not be found'}})
        self.assertEqual(cm.exception.status_code, 422)
        self.assertIn('Route could not be found', str(cm.exception.detail))

    def test_refused_credentials_are_503_not_retryable_text(self):
        from api.http import ProviderError

        with self.assertRaises(ProviderError) as cm:
            self._call(403, {})
        self.assertEqual(cm.exception.status_code, 503)
        self.assertIn('API key', str(cm.exception.detail))
