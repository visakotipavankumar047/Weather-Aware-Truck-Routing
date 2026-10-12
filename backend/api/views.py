from django.conf import settings
from django.db import connection
from drf_spectacular.utils import extend_schema
from rest_framework.decorators import api_view
from rest_framework.response import Response


@extend_schema(responses={200: {'type': 'object', 'properties': {
    'status': {'type': 'string'}, 'database': {'type': 'string'}, 'persistent': {'type': 'boolean'},
    'connected': {'type': 'boolean'}}}})
@api_view(['GET'])
def health(request):
    engine = settings.DATABASES['default']['ENGINE'].rsplit('.', 1)[-1]
    # SQLite under /tmp (serverless fallback) is wiped between instances: saved trips will vanish.
    persistent = not (engine == 'sqlite3' and settings.ON_VERCEL)
    try:
        with connection.cursor() as c:
            c.execute('SELECT 1')
        connected = True
    except Exception:
        connected = False
    return Response(
        {'status': 'ok' if connected else 'error', 'database': engine, 'persistent': persistent, 'connected': connected},
        status=200 if connected else 503,
    )
