from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from .providers import geocode


class GeocodeView(APIView):
    @extend_schema(
        parameters=[OpenApiParameter('q', str, required=True, description='Place or address (min 3 chars).')],
        responses={200: {'type': 'array', 'items': {'type': 'object', 'properties': {
            'label': {'type': 'string'}, 'lat': {'type': 'number'}, 'lon': {'type': 'number'}}}}},
    )
    def get(self, request):
        q = request.query_params.get('q', '').strip()
        if len(q) < 3:
            return Response({'q': 'Provide at least 3 characters.'}, status=400)
        return Response(geocode(q))
