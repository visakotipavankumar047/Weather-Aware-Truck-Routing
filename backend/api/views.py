from django.conf import settings
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view
from rest_framework.response import Response


@extend_schema(responses={200: {'type': 'object', 'properties': {
    'status': {'type': 'string'}, 'database': {'type': 'string'}, 'persistent': {'type': 'boolean'}}}})
@api_view(['GET'])
def health(request):
    engine = settings.DATABASES['default']['ENGINE'].rsplit('.', 1)[-1]
    # SQLite under /tmp (serverless fallback) is wiped between instances: saved trips will vanish.
    persistent = not (engine == 'sqlite3' and settings.ON_VERCEL)
    return Response({'status': 'ok', 'database': engine, 'persistent': persistent})
