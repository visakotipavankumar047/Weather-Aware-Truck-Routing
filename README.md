# Weather-Aware Truck Routing

A full-stack assessment project that compares route alternatives and evaluates forecast weather at checkpoints along a truck journey. The application recommends a route using deterministic risk and travel-time criteria.

> **Safety disclaimer:** This is a decision-support prototype, not a guarantee of road safety. General routing providers may not enforce truck-specific dimensions, axle/weight limits, bridge clearance, or hazardous-material restrictions. Forecasts are uncertain, and missing weather data must never be presented as safe conditions.

## Table of contents

- [Problem and goals](#problem-and-goals)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [External APIs and policies](#external-apis-and-policies)
- [Risk rules](#risk-rules)
- [Proposed API contract](#proposed-api-contract)
- [Environment variables](#environment-variables)
- [Local setup](#local-setup)
- [Frontend setup](#frontend-setup)
- [Backend setup](#backend-setup)
- [Testing](#testing)
- [Deployment](#deployment)
- [Limitations and future work](#limitations-and-future-work)

## Problem and goals

Truck drivers and dispatchers need to compare not only travel time but also weather hazards expected along the route at the time the truck reaches each segment. This project uses external routing and weather services; it does not build a routing engine from scratch.

The assessment asks for:
- Origin and destination.
- Departure date/time and load weight.
- Three route options where the provider supports distinct alternatives.
- Weather sampled every 10, 25, or 50 miles at estimated checkpoint arrival times.
- Risk classification using specified weather/load rules.
- A recommendation prioritizing severe miles, high-risk miles, average risk, and then travel time.
- Map routes, checkpoints, risk levels, ETAs, summaries, and a 0–48-hour forecast slider/heatmap.
- A GitHub repository, hosted application, and 5–10 minute walkthrough.

## Features

### Frontend
- Trip input form with address selection, departure timestamp, load weight, and checkpoint interval.
- Interactive map with route geometries and checkpoint markers.
- Route comparison cards and a recommendation explanation.
- Checkpoint weather/risk details.
- Forecast offset slider and corridor overlay.
- Loading, empty, partial-data, and error states.

### Backend
- REST API using Django REST Framework.
- Geocoding and route provider adapters.
- Route geometry normalization and distance-based checkpoint sampling.
- Weather forecast lookup aligned to checkpoint ETAs.
- Deterministic risk classification and route ranking.
- Trip, route, and checkpoint persistence when configured with a database.
- OpenAPI schema/documentation when enabled.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Map | Leaflet, React Leaflet |
| Server-state management | TanStack Query (recommended) |
| Backend | Python 3.12, Django, Django REST Framework |
| HTTP clients | httpx / requests |
| Routing | OpenRouteService |
| Geocoding | Nominatim |
| Weather | Open-Meteo |
| Map data | OpenStreetMap and an appropriate tile provider |
| Geometry | Shapely, polyline |
| Database | SQLite for initial local setup if configured; PostgreSQL for hosted deployment |
| Dependency management | uv |
| Testing | pytest, pytest-django, pytest-cov, Vitest |

## Architecture

```text
Browser
  |
  v
React + Vite + Leaflet
  |
  | /api/*
  v
Django REST Framework
  |
  +--> Geocoding adapter --> Nominatim
  |
  +--> Routing adapter ----> OpenRouteService
  |
  +--> Weather adapter ----> Open-Meteo
  |
  +--> Checkpoint sampler / ETA estimator
  |
  +--> Risk classifier and route ranking
  |
  v
SQLite (local) / PostgreSQL (hosted)
```

Keep external-provider calls behind adapters. Risk classification and ranking should be independent of the HTTP clients so that unit tests can cover them without network access.

## Repository layout

```text
weather-aware-truck-routing/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types/
│   │   └── App.tsx
│   ├── .env.example
│   └── package.json
├── backend/
│   ├── config/
│   ├── api/
│   ├── trips/
│   ├── routing/
│   ├── weather/
│   ├── risk_engine/
│   ├── tests/
│   ├── manage.py
│   ├── requirements.txt
│   ├── pyproject.toml
│   ├── uv.lock
│   └── .env.example
├── .gitignore
└── README.md
```

The structure is a recommended target; only routes and files actually implemented in the repository should be described as working.

## External APIs and policies

### OpenStreetMap
Used as map data and, depending on the selected tile provider, for the base map. Show required attribution. Public tile services have usage policies and are not intended for bulk tile downloading.

- Website: https://www.openstreetmap.org/
- Tile usage policy: https://operations.osmfoundation.org/policies/tiles/

### OpenRouteService
Used for route geometry, distance, duration, and route alternatives when supported by the selected endpoint/profile. A hosted API key is required.

- Docs: https://openrouteservice.org/dev/#/api-docs
- Signup: https://openrouteservice.org/dev/#/signup

A general car profile is not necessarily a truck-routing profile. Verify supported restrictions and clearly disclose gaps.

### Nominatim
Used to geocode place names and addresses. The public endpoint is suitable only for policy-compliant, low-volume development use.

- Policy: https://operations.osmfoundation.org/policies/nominatim/

The public service limits requests, disallows autocomplete, expects an identifying User-Agent and attribution, and requires appropriate caching. For production/higher volume, use a provider with suitable terms or self-host it.

### Open-Meteo
Used to request hourly forecasts for checkpoint coordinates.

- Docs: https://open-meteo.com/en/docs

Check current licensing and use terms for your use case. Hourly precipitation amounts are not necessarily instantaneous intensity values. Document the mapping from forecast values to the assessment's in/hr thresholds; report unsupported or unavailable values rather than fabricating them.

## Risk rules

The assessment provides the following classifications:

| Condition | Low | Moderate | High | Severe | No Travel |
|---|---:|---:|---:|---:|---:|
| Wind | <25 mph | 25–34 mph | 35–44 mph | 45–54 mph | ≥55 mph |
| Rain | <0.10 in/hr | 0.10–0.25 | 0.25–0.50 | 0.50–1.00 | >1.00 |
| Snow | <0.5 in/hr | 0.5–1.0 | 1.0–2.0 | 2.0–3.0 | >3.0 |

### Load-related wind overrides
- Wind ≥55 mph: No Travel for any load.
- Wind 45–54 mph and load >30,000 lb: No Travel.
- Wind 35–44 mph and load >40,000 lb: Severe.

At each checkpoint, use the highest applicable hazard risk. The written rain/snow ranges overlap at exact boundary values; the implementation must define, document, and test a deterministic boundary convention. Missing weather must be represented as unknown, not low risk.

### Route ranking
Rank routes lexicographically:
1. Fewest severe miles.
2. Fewest high-risk miles.
3. Lowest average risk.
4. Shortest travel time.

Do not replace this priority order with an arbitrary weighted sum. Document how checkpoint labels are translated into risk miles. Explicitly decide how routes containing No Travel or unknown segments affect eligibility and recommendation; test this behavior.

## Proposed API contract

Base prefix: `/api`. These endpoints are a proposed contract and are not available until implemented in Django.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health/` | Backend health check |
| GET | `/api/geocoding/search/?q=...` | Address/place geocoding |
| POST | `/api/trips/` | Validate input and run/create trip analysis |
| GET | `/api/trips/{trip_id}/` | Trip and recommendation summary |
| GET | `/api/trips/{trip_id}/routes/` | Route alternatives and summary metrics |
| GET | `/api/trips/{trip_id}/checkpoints/` | Checkpoint ETA, weather, and risk |
| GET | `/api/trips/{trip_id}/forecast/?offset_hours=0` | Weather view at selected forecast offset |
| POST | `/api/trips/{trip_id}/reanalyze/` | Optional reanalysis endpoint |
| GET | `/api/schema/` | Optional OpenAPI schema |
| GET | `/api/docs/` | Optional Swagger UI |

### Example request

```json
{
  "origin": "Denver, CO",
  "destination": "Colorado Springs, CO",
  "departure_at": "2026-10-20T08:00:00Z",
  "load_weight_lb": 32000,
  "checkpoint_interval_miles": 25
}
```

### Example response shape

```json
{
  "trip_id": "trip_123",
  "recommended_route_id": "route_2",
  "routes": [
    {
      "id": "route_2",
      "distance_miles": 75.2,
      "duration_minutes": 85,
      "risk_summary": {
        "severe_miles": 0,
        "high_miles": 3.1,
        "average_risk": 0.42
      },
      "geometry": [],
      "checkpoints": []
    }
  ],
  "warnings": []
}
```

Example response is illustrative; align it with the serializers actually implemented.

## Environment variables

### Backend: `backend/.env.example`

```dotenv
DJANGO_SECRET_KEY=replace-with-a-long-random-secret
DJANGO_DEBUG=True
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1

CORS_ALLOWED_ORIGINS=http://localhost:5173
CSRF_TRUSTED_ORIGINS=

# Leave empty if local settings fall back to SQLite.
DATABASE_URL=

OPENROUTESERVICE_API_KEY=
OPENROUTESERVICE_BASE_URL=https://api.openrouteservice.org

NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org
NOMINATIM_USER_AGENT=WeatherAwareTruckRouting/1.0 (contact: your-email@example.com)

OPEN_METEO_BASE_URL=https://api.open-meteo.com/v1/forecast

# Optional
REDIS_URL=
EXTERNAL_API_TIMEOUT_SECONDS=15
```

Django settings must load and parse these values; `DATABASE_URL` is not automatically interpreted by Django without custom configuration or a helper library. Never commit `.env`. In production set `DJANGO_DEBUG=False`, a strong secret, restricted allowed hosts, and production CORS/CSRF origins.

### Frontend: `frontend/.env.example`

```dotenv
VITE_API_BASE_URL=/api
```

If frontend and backend have separate domains, set the full backend API base URL and configure CORS on Django. Never put private provider keys in `VITE_*` variables because they are exposed in the client bundle.

## Local setup

### Prerequisites
- Git
- Node.js LTS and npm
- Python 3.12
- uv

### Backend setup (Windows PowerShell)

```powershell
cd backend
uv python install 3.12
uv python pin 3.12
uv sync
```

If dependencies are maintained from `requirements.txt` rather than `pyproject.toml`:

```powershell
uv pip install -r requirements.txt
```

Choose one dependency workflow and keep it consistent.

Create `backend/.env` from `.env.example` and fill the required values. Then:

```powershell
uv run python manage.py check
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver
```

Django runs at `http://127.0.0.1:8000/`. The admin is at `/admin/`. The health endpoint is available only after it is implemented and wired to the URL configuration.

### Frontend setup

```powershell
cd frontend
npm install
```

Create `frontend/.env` from `.env.example`, then run:

```powershell
npm run dev
```

Vite normally runs at `http://localhost:5173/`. The frontend must either use a configured backend URL or a Vite development proxy for `/api` requests.

## Testing

### Backend

```powershell
cd backend
uv run python manage.py check
uv run python manage.py test
```

If pytest is configured:

```powershell
uv run pytest
```

Test at least:
- Wind, rain, and snow thresholds, including exact boundary values.
- Every load override.
- Ranking tie-breakers.
- Route geometry sampling and endpoint inclusion.
- Timezone and ETA-to-hourly-forecast matching.
- Missing/partial weather data.
- Provider timeouts, rate limits, invalid responses, and errors.
- Serializer validation and API status codes.

### Frontend

```powershell
cd frontend
npm run build
npm run test
```

Use the actual test script defined in `package.json`; it may be `test`, `test:unit`, or another name depending on the chosen setup.

## Deployment

### Vercel
Vercel can host the Vite frontend. Configure the frontend root/build output as appropriate for the repository and set `VITE_API_BASE_URL`.

### Django backend
Deploy Django to a platform that supports the selected deployment model (for example, a Docker-capable web service), or use a Vercel-supported Python deployment approach after checking current runtime constraints. A conventional long-running Docker container is not interchangeable with a serverless function.

### Production checklist
- Set `DJANGO_DEBUG=False`.
- Use a strong secret and secure environment variables.
- Configure `ALLOWED_HOSTS`, CORS, and CSRF origins.
- Use managed PostgreSQL and apply migrations during deployment.
- Configure HTTPS and secure cookies as appropriate.
- Configure health checks, logging, timeouts, and rate limiting.
- Respect provider quotas, caching requirements, and attribution.
- Verify the deployment works from the actual public frontend domain.

## Limitations and future work

- General routing APIs may not support all truck-specific restrictions.
- Weather forecasts have uncertainty and limited forecast horizons.
- Public Nominatim and map tile services are policy-limited.
- Precipitation rate semantics may not exactly match the assessment thresholds.
- A three-route response depends on provider availability; do not fabricate alternatives.
- Future enhancements could include a truck-specific routing provider, background analysis jobs, route-result caching, authentication, saved trips, and monitoring.

## Documentation

- OpenStreetMap: https://www.openstreetmap.org/
- Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- OpenRouteService docs: https://openrouteservice.org/dev/#/api-docs
- Open-Meteo docs: https://open-meteo.com/en/docs
- Django: https://docs.djangoproject.com/
- Django REST Framework: https://www.django-rest-framework.org/
- React: https://react.dev/
- Vite: https://vite.dev/
- Leaflet: https://leafletjs.com/
