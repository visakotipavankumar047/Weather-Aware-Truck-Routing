"""Database cache that never fails a request: if the database is unreachable, behave as a cache miss."""
import logging

from django.core.cache.backends.db import DatabaseCache

log = logging.getLogger(__name__)


class SafeDatabaseCache(DatabaseCache):
    def get(self, *a, **kw):
        try:
            return super().get(*a, **kw)
        except Exception:
            log.warning('shared cache unavailable (get)', exc_info=True)
            return a[1] if len(a) > 1 else kw.get('default')

    def set(self, *a, **kw):
        try:
            super().set(*a, **kw)
        except Exception:
            log.warning('shared cache unavailable (set)', exc_info=True)

    def get_many(self, keys, *a, **kw):
        try:
            return super().get_many(keys, *a, **kw)
        except Exception:
            log.warning('shared cache unavailable (get_many)', exc_info=True)
            return {}

    def set_many(self, *a, **kw):
        try:
            return super().set_many(*a, **kw)
        except Exception:
            log.warning('shared cache unavailable (set_many)', exc_info=True)
            return []
