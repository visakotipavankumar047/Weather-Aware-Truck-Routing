"""Live traffic map tiles, proxied so the provider key never reaches the browser.

Provider: TomTom Traffic Flow raster tiles (needs TOMTOM_API_KEY; free tier available).
Without a key the status endpoint reports `enabled: false` and the UI hides the layer.
"""
import httpx
from django.conf import settings
from django.http import HttpResponse
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

FLOW_STYLE = 'relative-delay'  # only slowed roads are coloured; free-flowing roads stay clear


class TrafficStatusView(APIView):
    @extend_schema(responses={200: {'type': 'object', 'properties': {
        'enabled': {'type': 'boolean'}, 'provider': {'type': 'string'}, 'attribution': {'type': 'string'}}}})
    def get(self, request):
        return Response({
            'enabled': bool(settings.TOMTOM_API_KEY),
            'provider': 'TomTom',
            'attribution': '© TomTom',
        })


class TrafficTileView(APIView):
    throttle_classes = []  # a map loads dozens of tiles per view; the provider enforces its own quota

    @extend_schema(responses={(200, 'image/png'): bytes})
    def get(self, request, z, x, y):
        if not settings.TOMTOM_API_KEY:
            return HttpResponse('Traffic is not configured.', status=503, content_type='text/plain')
        if not (0 <= z <= 22 and 0 <= x < 2 ** z and 0 <= y < 2 ** z):
            return HttpResponse(status=404)
        url = f'{settings.TOMTOM_BASE_URL}/traffic/map/4/tile/flow/{FLOW_STYLE}/{z}/{x}/{y}.png'
        try:
            resp = httpx.get(url, params={'key': settings.TOMTOM_API_KEY},
                             timeout=settings.EXTERNAL_API_TIMEOUT_SECONDS)
        except httpx.HTTPError:
            return HttpResponse('Traffic provider unreachable.', status=502, content_type='text/plain')
        if resp.status_code in (204, 404):
            return HttpResponse(status=204)  # no traffic data for this tile
        if resp.status_code != 200:
            return HttpResponse(f'Traffic provider returned HTTP {resp.status_code}.',
                                status=503 if resp.status_code == 429 else 502, content_type='text/plain')
        out = HttpResponse(resp.content, content_type='image/png')
        out['Cache-Control'] = 'public, max-age=120'
        return out
