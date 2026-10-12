"""Vercel entry point: serves the Django backend as one serverless function.

vercel.json rewrites every /api/* request here and the original URL path is kept, so Django's
own URL routing (backend/api/urls.py) handles it. The frontend is built to static files and
served by Vercel itself from the same domain, so no CORS or second deployment is needed."""
import logging
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / 'backend'
sys.path.insert(0, str(BACKEND))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

from django.core.management import call_command  # noqa: E402
from django.core.wsgi import get_wsgi_application  # noqa: E402

app = get_wsgi_application()

# Apply migrations once per cold start so a fresh deploy (new database, or the temporary SQLite
# fallback) works without a manual step. It is a no-op when the schema is already current.
try:
    call_command('migrate', interactive=False, verbosity=0)
except Exception:  # never take the whole API down because the migrate check failed
    logging.getLogger(__name__).exception('Automatic migrate failed')
