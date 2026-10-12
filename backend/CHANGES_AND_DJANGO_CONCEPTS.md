# Changes made, and the Django concepts behind this project

Companion to `DOCS.md` (routes and functions). Part 1 lists every change and why. Part 2 explains the Django and DRF ideas the project relies on, with the file where each one appears.

---

## Part 1. Change log

| # | Change | Where | Why |
|---|---|---|---|
| 1 | Pointed VS Code at the project virtualenv | `.vscode/settings.json` | Pylance reported "could not be resolved from source" because it used another Python. Django was installed in `backend/.venv` all along. |
| 2 | Removed unused imports, added lint config | scaffold files, `backend/ruff.toml` | `ruff` found 16 leftovers from `startapp`. The config stops Django idioms being flagged. |
| 3 | Settings read the environment | `config/settings.py` | Secrets, hosts, CORS, database and provider keys come from `backend/.env` instead of being hard-coded. |
| 4 | Built the API | `api/`, `trips/`, `routing/`, `weather/`, `risk_engine/` | The pipeline described in `DOCS.md` sections 3-8. |
| 5 | Database tables | `trips/migrations/0001_initial.py` | Trips, routes and checkpoints are stored so they can be reopened. |
| 6 | One retry on provider 5xx | `api/http.py` | Open-Meteo returned an occasional HTTP 503; one quick retry hides it. |
| 7 | Live traffic proxy | `api/traffic.py`, `api/urls.py`, settings | Django fetches traffic tiles so `TOMTOM_API_KEY` never reaches the browser. |
| 8 | Fixed `.env` values | `backend/.env` | See the table below. |
| 9 | Frontend built | `frontend/` | React app that uses only the documented endpoints. See `frontend/README.md`. |
| 10 | Base map provider | `frontend/src/components/map/RouteMap.tsx` | CARTO raster tiles began requiring an API key (watermark "API KEY REQUIRED"), so the map uses standard OpenStreetMap tiles, which need no key. |

### `.env` problems found and fixed

| Variable | Problem | Result |
|---|---|---|
| `OPENROUTESERVICE_BASE_URL` | was `https://api.heigit.org`, which returns HTTP 404 | now `https://api.openrouteservice.org` |
| `TOMTOM_API-KEY` | the name contained a hyphen, so Django never saw it and traffic stayed off | renamed to `TOMTOM_API_KEY`; a real traffic tile now loads |
| `NOMINATIM_USER_AGENT` | still the placeholder contact; Nominatim answers 403 | **you must set a real contact** (below) |

Environment variable names may only contain letters, digits and underscores. A hyphen makes it a different, unknown name and fails silently.

**Restart the Django server after editing `.env`.** `load_dotenv` runs once at startup and the autoreloader only watches `.py` files.

```dotenv
NOMINATIM_USER_AGENT=WeatherAwareTruckRouting/1.0 (contact: you@yourdomain.com)
```

### How the traffic key was verified
With the Django test client (no server running), `/api/traffic/status/` returned `enabled: true` and `/api/traffic/tiles/7/26/48.png` returned a real `200 image/png` from TomTom. The browser only ever requests `/api/traffic/tiles/...` on your own backend.

---

## Part 2. Django concepts this project relies on

### Project vs apps
A **project** (`config/`) holds global settings and the root URL table. An **app** is a self-contained feature package. Here the apps are `trips` (data and endpoints), `routing`, `weather` and `risk_engine`. `api/` is a plain package for URL wiring and shared helpers; it is not in `INSTALLED_APPS` because it has no models.

An app must be listed in `INSTALLED_APPS` (`config/settings.py`) for Django to find its models and migrations.

### `settings.py`
One module of configuration. Values that differ per machine (secret key, debug flag, hosts, keys) are read from environment variables, loaded from `.env` by `python-dotenv`.
- `DEBUG`, `SECRET_KEY`, `ALLOWED_HOSTS` are safety settings. The secret key may fall back to a dev value only when `DEBUG` is true.
- `USE_TZ = True` means every datetime is timezone-aware and stored in UTC. This is why `departure_at` must carry an offset.
- `DATABASES` is SQLite by default and Postgres when `DATABASE_URL` is set.
- `CACHES` is in-process memory by default and Redis when `REDIS_URL` is set.

### URL routing (`urls.py`)
`ROOT_URLCONF = 'config.urls'` is the entry point. `path('api/', include('api.urls'))` hands everything under `/api/` to `api/urls.py`, which includes `trips/urls.py` under `trips/`. Path converters such as `<uuid:trip_id>` and `<int:z>` validate the URL segment before your view runs, so a malformed id is a 404 automatically.

### Models and the ORM (`trips/models.py`)
A model class is a table, a field is a column, an instance is a row. No SQL is written by hand.
- `UUIDField(primary_key=True)` gives hard-to-guess trip ids.
- `ForeignKey(..., on_delete=CASCADE, related_name='routes')` links Route to Trip. Deleting a trip deletes its routes and checkpoints; `trip.routes.all()` is the reverse lookup.
- `JSONField` stores flexible structures (geometry, weather, risk summary) without extra tables.
- `Meta.ordering` sets the default sort.
- `objects.create()`, `.filter()`, `.delete()`, `bulk_create()` (many rows in one query) and `prefetch_related()` (load children in a few queries rather than one per row) are used in `trips/services.py` and `trips/views.py`.

### Migrations
Models describe the schema you want; migrations are the generated steps that make the database match. `makemigrations` writes a step, `migrate` applies it. Do not edit tables by hand.

### Transactions (`transaction.atomic`)
`services.save` is decorated with `@transaction.atomic`: a trip's routes and checkpoints are either all written or none are, so a half-saved analysis can never be read.

### The admin (`trips/admin.py`)
`admin.site.register(Model)` gives a free web UI at `/admin/` for inspecting rows. Create a login with `manage.py createsuperuser`.

### Django REST Framework (DRF)
Django renders pages; DRF adds JSON APIs.
- **`APIView`** is a class whose `get` / `post` methods are the handlers (`trips/views.py`). `@api_view` does the same for a function (`health`).
- **Serializers** (`trips/serializers.py`) convert between Python/ORM objects and JSON and **validate input**. `Serializer` is hand written (`TripInputSerializer`); `ModelSerializer` derives its fields from a model. A custom `Field` (`PlaceField`) accepts either a string or an object. `validate_<field>` methods add rules, and `is_valid(raise_exception=True)` turns bad input into an HTTP 400 automatically.
- **`Response`** returns JSON with a status code.
- **Exceptions**: raising a `ValidationError` or an `APIException` subclass (`ProviderError`) becomes a JSON error with the right status. This is how provider failures turn into 502/503/504.
- **Throttling**: `AnonRateThrottle` limits each IP to 120 requests per minute. The tile view opts out with `throttle_classes = []` because a map loads many tiles at once.
- **Authentication/permissions** are empty lists: the API is public and stateless, so there are no session cookies or CSRF tokens.
- **Renderers**: only JSON.

### Middleware
Code that wraps every request. `corsheaders.middleware.CorsMiddleware` adds the CORS headers that let the React app on port 5173 call the API on port 8000. It must be listed first.

### Caching framework
`django.core.cache` is one `cache.get/set` API over memory or Redis. It is used for geocoding (24 h, as Nominatim's policy asks) and weather series (30 min, so dragging the forecast slider does not call Open-Meteo each time).

### Raw HTTP responses
`HttpResponse` (used for map tiles) returns bytes and headers instead of JSON, including `Cache-Control` so the browser caches tiles for two minutes.

### `get_object_or_404`
Fetches a row or raises a 404 that DRF renders as `{"detail": "Not found."}`.

### Management commands (`manage.py`)
| Command | Purpose |
|---|---|
| `check` | validate settings, models and URLs |
| `makemigrations` / `migrate` | create / apply schema changes |
| `test` | run all tests against a throwaway database |
| `shell` | Python prompt with Django loaded (`shell -c "..."` runs one snippet) |
| `runserver` | development server that reloads on code changes |
| `createsuperuser` | user for `/admin/` |

### Testing (`*/tests.py`)
- `SimpleTestCase` is for pure logic with no database (risk rules, geometry).
- `TestCase` wraps each test in a transaction and provides `self.client`, which calls URLs in-process (`trips/tests.py`).
- `override_settings` changes a setting for one test, for example an empty API key.
- `unittest.mock.patch` replaces provider calls so tests never touch the network.

### drf-spectacular
Reads serializers and views to generate an OpenAPI schema (`/api/schema/`) and Swagger UI (`/api/docs/`). `@extend_schema` fills in what it cannot infer.

### The design rule that ties it together
Pure logic (`risk_engine`, `routing/geometry.py`) imports nothing from Django or the network. Providers (`routing/providers.py`, `weather/providers.py`, `api/traffic.py`) are the only code doing outbound HTTP. Views only validate input, call a service and serialize the result. That separation is why 40 tests run in a fraction of a second with no internet.
