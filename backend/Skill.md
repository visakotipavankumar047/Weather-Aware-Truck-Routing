# Backend Skill Guide — Weather-Aware Truck Routing

## 1. Purpose

Build a Django REST Framework API that obtains route alternatives, samples each route at mileage checkpoints, fetches weather forecasts aligned to estimated checkpoint arrival times, classifies risk using the assessment rules, and ranks routes deterministically.

This is a proposed implementation specification. API endpoints below must be implemented; creating Django apps does not create these endpoints automatically.

## 2. Stack

- Python 3.12
- `uv` for Python/environment/dependency management
- Django
- Django REST Framework
- `django-cors-headers`
- `httpx` for external API requests
- `openrouteservice` Python client (or a single HTTP client adapter)
- `shapely` and `polyline` for route geometry/checkpoint sampling where appropriate
- PostgreSQL with `psycopg[binary]` for hosted persistence
- `python-dotenv` for local environment configuration
- `drf-spectacular` for OpenAPI schema/docs
- pytest, pytest-django, pytest-cov for tests
- Redis / django-redis only if caching is actually enabled

## 3. Suggested backend structure

```text
backend/
├── config/
│   ├── settings.py
│   ├── urls.py
│   ├── asgi.py
│   └── wsgi.py
├── api/
│   ├── urls.py
│   └── views.py
├── trips/
│   ├── models.py
│   ├── serializers.py
│   ├── services.py
│   ├── urls.py
│   ├── views.py
│   └── admin.py
├── routing/
│   ├── providers.py
│   ├── services.py
│   └── geometry.py
├── weather/
│   ├── providers.py
│   └── services.py
├── risk_engine/
│   ├── classifiers.py
│   ├── ranking.py
│   └── tests/
├── tests/
├── manage.py
├── requirements.txt
├── pyproject.toml
├── uv.lock
└── .env.example
```

Provider adapters should isolate external API contracts from business logic. Risk calculations and ranking should be pure functions where possible.

## 4. Environment configuration

Create `backend/.env.example` and copy it to `.env` for local development:

```dotenv
# Django
DJANGO_SECRET_KEY=replace-with-a-long-random-secret
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1

# React dev server; comma-separated origins if multiple are needed
CORS_ALLOWED_ORIGINS=http://localhost:5173
CSRF_TRUSTED_ORIGINS=

# Database: leave empty to use local SQLite if settings support this fallback.
DATABASE_URL=

# Routing provider (key is required for hosted OpenRouteService)
OPENROUTESERVICE_API_KEY=
OPENROUTESERVICE_BASE_URL=https://api.openrouteservice.org

# Geocoding (public Nominatim only for policy-compliant development use)
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=WeatherAwareTruckRouting/1.0 (contact: your-email@example.com)

# Weather
OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1/forecast

# Optional cache; only use if Redis is configured in Django settings
REDIS_URL=

# HTTP behavior
EXTERNAL_API_TIMEOUT_SECONDS=15
```

Important:
- `.env.example` is safe to commit; `.env` is not.
- The settings module must explicitly load environment variables (for example with `python-dotenv`) and parse booleans/lists correctly.
- `DATABASE_URL` parsing requires an appropriate helper or explicit Django database configuration. Django does not automatically read this variable by itself.
- Never use `DJANGO_DEBUG=True` in production.
- Keep provider keys on the backend only.
- Do not claim public OSM/Nominatim endpoints are unlimited or production-guaranteed.

## 5. External providers

### OpenStreetMap
- The frontend renders map tiles using Leaflet and an appropriate tile provider.
- Include OpenStreetMap attribution.
- Tile service is not a general-purpose bulk tile-download service; respect the selected provider's usage policy.

### OpenRouteService
- Use the routing API to request route geometry, distance, and duration.
- Ask for alternative routes where the API profile and endpoint support it.
- Never duplicate a single route to pretend three alternatives exist.
- General car-routing profiles do not guarantee truck dimensions, weight limits, bridge clearance, or hazardous-material restrictions. Disclose this limitation.

### Nominatim
- Convert place/address input to coordinates through a server-side provider adapter.
- For the public endpoint, follow the current usage policy: no autocomplete, maximum one request per second, identifying User-Agent, attribution, and suitable caching.
- For production or higher volume, use a provider with appropriate terms or self-host Nominatim.

### Open-Meteo
- Fetch hourly forecast values for checkpoint coordinates.
- Request suitable wind and precipitation units where available.
- Map forecast timestamps to each checkpoint's estimated arrival time.
- The free endpoint's permitted use and licensing depend on the use case; verify current terms before commercial deployment.
- Hourly precipitation amount is not necessarily instantaneous precipitation intensity. Document the conversion/interpretation used by the risk engine and flag unavailable measurements.

## 6. Proposed API routes

Base prefix: `/api`

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health/` | Liveness check |
| GET | `/api/geocoding/search/?q={query}` | Geocode a place/address |
| POST | `/api/trips/` | Validate trip input and create/run analysis |
| GET | `/api/trips/{trip_id}/` | Get trip details and recommendation |
| GET | `/api/trips/{trip_id}/routes/` | List route alternatives |
| GET | `/api/trips/{trip_id}/checkpoints/` | List route checkpoints and weather/risk |
| GET | `/api/trips/{trip_id}/forecast/?offset_hours={0..48}` | Return selected forecast offset |
| POST | `/api/trips/{trip_id}/reanalyze/` | Re-run analysis if supported |
| GET | `/api/schema/` | OpenAPI schema (if configured) |
| GET | `/api/docs/` | Swagger UI (if configured) |

These are planned routes, not existing routes until URL patterns/views are written. If an endpoint is not implemented, return 404 rather than documenting it as working.

### Example request: create trip

```json
{
  "origin": "Denver, CO",
  "destination": "Colorado Springs, CO",
  "departure_at": "2026-10-20T08:00:00Z",
  "load_weight_lb": 32000,
  "checkpoint_interval_miles": 25
}
```

Validation:
- `origin` and `destination` are required.
- Departure timestamp must be timezone-aware.
- `load_weight_lb` must be greater than zero.
- `checkpoint_interval_miles` must be one of 10, 25, 50.
- Reject unsupported units or convert them explicitly.
- Validate provider results before using them.

## 7. Analysis pipeline

1. Validate the request.
2. Geocode origin and destination.
3. Request route alternatives from OpenRouteService.
4. Decode/normalize route geometry and calculate route distance/duration.
5. Sample geometry by cumulative distance at 10/25/50-mile intervals; always include route start and end.
6. Estimate checkpoint arrival times using cumulative route duration. If only total duration is available, interpolate by cumulative distance and document that this is an approximation.
7. Fetch weather for checkpoint coordinates and the corresponding hourly arrival-time forecast.
8. Normalize units and classify each weather hazard.
9. Apply load-related wind overrides.
10. Aggregate risk miles and average risk per route.
11. Rank routes in the assessment's lexicographic priority order.
12. Return route geometry, checkpoint details, risk summaries, warnings, and recommendation.

Batch or cache weather requests where supported. Use timeouts and handle 429, provider errors, missing forecasts, and malformed responses.

## 8. Risk classification rules from the assessment

Thresholds supplied in the assessment:

| Hazard | Low | Moderate | High | Severe | No Travel |
|---|---|---|---|---|---|
| Wind | <25 mph | 25–34 mph | 35–44 mph | 45–54 mph | ≥55 mph |
| Rain | <0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00 |
| Snow | <0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | >3.0 |

The written ranges overlap at some exact boundaries (rain at 0.25 and 0.50; snow at 1.0 and 2.0). Establish and test a deterministic boundary convention in code and document it. Do not silently assume ambiguous boundaries are unambiguous.

Load overrides:
- Wind ≥55 mph: `NO_TRAVEL` for any load.
- Wind 45–54 mph and load >30,000 lb: `NO_TRAVEL`.
- Wind 35–44 mph and load >40,000 lb: `SEVERE`.

At a checkpoint, use the most severe applicable hazard classification. Missing weather must be `UNKNOWN`, not `LOW`. Define an explicit route-level policy for missing data; disclose missing-data coverage in the response rather than treating unknown as safe.

## 9. Route ranking

Use lexicographic ranking, not an arbitrary weighted sum:
1. Fewest severe miles.
2. Fewest high-risk miles.
3. Lowest average risk.
4. Shortest travel time.

Document how checkpoint risk is converted into mileage (for example, assign each segment between checkpoints the classification at its nearest/preceding checkpoint). Apply the same aggregation method to all routes. If any route contains `NO_TRAVEL`, explicitly define whether it is ineligible for recommendation; the assessment does not specify this aggregation detail, so document the product decision and test it.

## 10. Suggested data models

Create models only as needed:
- `Trip`: origin/destination labels and coordinates, departure time, load weight, checkpoint interval, status, timestamps.
- `Route`: trip FK, provider ID, geometry, distance, duration, rank, summary fields.
- `Checkpoint`: route FK, sequence, cumulative distance, coordinates, ETA, weather values, forecast timestamp, risk labels, reason codes.
- Optional `AnalysisRun`: provider timestamps, warnings, and analysis version.

Use migrations. Avoid storing provider secrets or unnecessary raw personal data.

## 11. Security, reliability, and performance

- Use environment variables for secrets.
- Restrict `ALLOWED_HOSTS`, CORS origins, and CSRF trusted origins.
- Validate all user input and external provider payloads.
- Set outbound HTTP timeouts.
- Handle external rate limits and return clear API errors.
- Cache geocoding/weather responses where terms permit.
- Avoid logging secrets or sensitive request data.
- Use database transactions for multi-record trip persistence.
- Add pagination if checkpoint responses become large.
- Add request IDs and structured logging for debugging.
- Use throttling/rate limits for public API endpoints before production.
- Do not claim the app guarantees safe routes; routing provider limitations and forecast uncertainty must be visible.

## 12. Tests

- Unit tests for each exact risk threshold and load override.
- Tests for ambiguous rain/snow boundaries.
- Route ranking tie-breakers.
- Geometry sampling at 10, 25, and 50 miles.
- ETA/forecast-hour matching, timezone behavior, and forecasts outside horizon.
- Missing or partial weather data.
- Provider timeout, 429, invalid JSON, and non-200 responses.
- Serializer validation and endpoint status codes.
- Integration tests with provider HTTP calls mocked.

## 13. Local development commands

From `backend/` using `uv` and Python 3.12:

```powershell
uv python pin 3.12
uv sync
uv run python --version
uv run python manage.py check
uv run python manage.py migrate
uv run python manage.py runserver
```

If using `requirements.txt` as the dependency source instead of `pyproject.toml`:

```powershell
uv pip install -r requirements.txt
```

Choose one dependency workflow and keep it consistent.

## 14. Definition of done

- API routes match the documented contract.
- OpenAPI docs reflect implemented endpoints.
- Provider adapters are separated from the risk engine.
- Risk boundaries and load overrides have automated tests.
- Forecast timestamps and units are handled explicitly.
- Three alternatives are shown only when the provider returns distinct routes.
- Database migrations and environment setup are documented.
- No secret keys are committed.
