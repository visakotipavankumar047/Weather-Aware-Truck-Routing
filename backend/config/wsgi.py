"""
WSGI config for config project.

It exposes the WSGI callable as a module-level variable named ``application``.
"""

import logging
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

application = get_wsgi_application()

# On Vercel there is no release step and the SQLite file lives in a temporary directory, so make
# sure the tables exist when an instance starts. It is a no-op when the schema is current.
if os.environ.get('VERCEL'):
    from django.core.management import call_command

    try:
        call_command('migrate', interactive=False, verbosity=0)
        call_command('createcachetable', verbosity=0)  # only does anything for a DB-backed cache
    except Exception:  # never take the whole API down because the start-up check failed
        logging.getLogger(__name__).exception('Automatic migrate failed')
