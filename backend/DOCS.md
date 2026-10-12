# Backend documentation

Decision-support API for weather-aware truck routing. Given an origin, destination, departure time and load weight it fetches route alternatives, samples checkpoints along each route, looks up the forecast for each checkpoint's ETA, classifies risk, and ranks the routes.

> Not a guarantee of road safety. The routing profile is OpenRouteService `driving-hgv` (a heavy-goods-vehicle profile) but **load weight is not sent to the router**, so axle/weight limits, bridge clearance and hazmat rules are not enforced. Forecasts are uncertain; missing weather is reported as `UNKNOWN`, never as safe.

## 1. Run it

```powershell
cd backend
.venv\Scripts\python.exe manage.py migrate          # creates trips/routes/checkpoints tables
.venv\Scripts\python.exe manage.py runserver
.venv\Scripts\python.exe manage.py test             # 35 tests, all providers mocked, no network
```

Required in `backend/.env` (see `.env.example`): `OPENROUTESERVICE_API_KEY`. Everything else has a default.
Swagger UI: `http://127.0.0.1:8000/api/docs/` - OpenAPI JSON: `/api/schema/` - admin: `/admin/`.

## 2. Layout and responsibilities

```
config/        settings.py (env parsing, DRF, cache, CORS), urls.py (/admin, /api)
api/           http.py   shared outbound HTTP + ProviderError
               views.py  health        urls.py  /api/* routing table
routing/       providers.py  Nominatim geocoding + OpenRouteService routes
               geometry.py   pure: haversine + checkpoint sampling/ETA
               views.py      GeocodeView
weather/       providers.py  Open-Meteo HTTP + parsing
               services.py   caching, dedupe, ETA -> forecast-hour matching
risk_engine/   classifiers.py  pure: thresholds, overrides -> risk level
               ranking.py      pure: miles aggregation + ranking key
trips/         models.py serializers.py services.py views.py urls.py admin.py
```

Dependency direction: `trips` -> (`routing`, `weather`, `risk_engine`) -> `api.http`. `risk_engine` and `routing.geometry` do no I/O, so they are unit-tested without mocks.

## 3. Request flow: `POST /api/trips/`

1. `TripInputSerializer` validates the body (400 on failure).
2. `resolve_place` turns each place into `{label, lat, lon}` (free text is geocoded via Nominatim; a `{label, lat, lon}` object skips geocoding).
3. A `Trip` row is created.
4. `services.analyze`:
   1. `fetch_routes` -> up to 3 distinct ORS routes (+ warnings).
   2. `sample_checkpoints` per route at 10/25/50 miles, always including start and end.
   3. ETA per checkpoint = `departure_at` + linear-in-distance share of the route duration.
   4. `score_routes` -> weather at each ETA, `classify`, `summarize`, rank.
5. `services.save` persists routes + checkpoints atomically and sets `recommended_route`.
6. Response `201` = full analysis. If any provider fails, the half-created `Trip` is deleted and the provider error is returned.

## 4. Routes

Base prefix `/api`. All responses are JSON. Anonymous throttle: 120 requests/minute/IP (429 beyond that). No authentication.

| Method | Path | Purpose | Success |
|---|---|---|---|
| GET | `/api/health/` | Liveness | `200 {"status":"ok"}` |
| GET | `/api/geocoding/search/?q=` | Place search (>= 3 chars) | `200 [{label, lat, lon}]` |
| POST | `/api/trips/` | Validate, analyse, persist | `201` full trip |
| GET | `/api/trips/{id}/` | Trip + recommendation + route summaries | `200` |
| GET | `/api/trips/{id}/routes/` | Routes with geometry and summaries | `200` list |
| GET | `/api/trips/{id}/checkpoints/[?route_id=]` | Checkpoint weather/risk per route | `200` list |
| GET | `/api/trips/{id}/forecast/?offset_hours=0..48` | Re-score with ETAs shifted | `200` |
| GET | `/api/trips/{id}/traffic/?offset_hours=0..48` | Traffic-aware delay and congested sections per route (TomTom Routing) | `200` |
| POST | `/api/trips/{id}/reanalyze/` | Re-run analysis with fresh providers data | `200` full trip |
| GET | `/api/traffic/status/` | Is the live traffic layer configured? | `200 {enabled, provider, attribution}` |
| GET | `/api/traffic/tiles/{z}/{x}/{y}.png` | Traffic-flow map tile (proxied from TomTom; key stays server-side) | `200` PNG, `204` no data, `503` not configured |
| GET | `/api/schema/` | OpenAPI schema | `200` |
| GET | `/api/docs/` | Swagger UI | `200` |

`{id}` is the UUID `trip_id` returned by `POST /api/trips/`; unknown ids return `404`.

### `POST /api/trips/`

```json
{
  "origin": "Denver, CO",
  "destination": {"label": "Colorado Springs, CO", "lat": 38.83, "lon": -104.82},
  "departure_at": "2026-10-20T08:00:00Z",
  "load_weight_lb": 32000,
  "checkpoint_interval_miles": 25
}
```

| Field | Rule |
|---|---|
| `origin`, `destination` | non-empty string **or** `{lat, lon[, label]}` with valid ranges |
| `departure_at` | ISO-8601 **with** timezone offset (naive -> 400) |
| `load_weight_lb` | number > 0 (pounds only; other units are not accepted) |
| `checkpoint_interval_miles` | exactly 10, 25 or 50 |

Response (abridged):

```json
{
  "trip_id": "6c0f...-uuid",
  "origin_label": "...", "origin_lat": 39.7, "origin_lon": -104.9,
  "destination_label": "...", "destination_lat": 38.8, "destination_lon": -104.8,
  "departure_at": "2026-10-20T08:00:00Z", "load_weight_lb": 32000.0, "checkpoint_interval_miles": 25,
  "recommended_route_id": 12,
  "warnings": ["..."],
  "routes": [{
    "id": 12, "rank": 1, "eligible": true,
    "distance_miles": 75.2, "duration_minutes": 85.0,
    "risk_summary": {"severe_miles": 0.0, "high_miles": 3.1, "no_travel_miles": 0.0,
                     "unknown_miles": 0.0, "average_risk": 0.42, "has_no_travel": false},
    "geometry": [[39.7, -104.9], "..."],
    "checkpoints": [{
      "sequence": 0, "distance_miles": 0.0, "lat": 39.7, "lon": -104.9,
      "eta": "2026-10-20T08:00:00Z",
      "weather": {"forecast_time": "2026-10-20T08:00:00+00:00", "wind_mph": 12.3, "rain_in_hr": 0.0, "snow_in_hr": 0.0},
      "risk": "LOW", "reasons": ["all hazards below thresholds"]
    }]
  }]
}
```

- `recommended_route_id` is `null` when every route contains a NO_TRAVEL checkpoint.
- `weather` is `null` and `risk` is `"UNKNOWN"` when no forecast exists for that hour.
- `routes` has 1-3 entries. Fewer than 3 means the provider returned fewer distinct routes (a warning explains why).
- `average_risk` scale: 0=LOW, 1=MODERATE, 2=HIGH, 3=SEVERE, 4=NO_TRAVEL; `null` if no known miles.

### `GET /api/trips/{id}/`
Same trip fields but `routes` contain only `id, rank, eligible, distance_miles, duration_minutes, risk_summary` (no geometry/checkpoints).

### `GET /api/trips/{id}/routes/`
List of route summaries plus `geometry` ([lat, lon] pairs), ordered by rank.

### `GET /api/trips/{id}/checkpoints/`
`[{"route_id": 12, "checkpoints": [...]}]`. `?route_id=12` filters to one route; non-integer -> 400.

### `GET /api/trips/{id}/forecast/?offset_hours=N`
Models "what if I leave N hours later": every stored checkpoint ETA is shifted by N hours, weather is re-fetched/cached, and routes are re-classified and **re-ranked**. Defaults to 0 when omitted; non-integer or outside 0-48 -> 400.

```json
{
  "trip_id": "...", "offset_hours": 6, "recommended_route_id": 12,
  "routes": [{"id": 12, "rank": 1, "eligible": true, "distance_miles": 75.2,
              "duration_minutes": 85.0, "risk_summary": {...}, "checkpoints": [...]}]
}
```
This does not modify the database. Weather series are cached for 30 minutes, so sweeping the slider over 0-48 is cheap after the first call.

### `POST /api/trips/{id}/reanalyze/`
Re-runs the full analysis from the stored inputs and replaces routes/checkpoints (route ids change). Returns the same body as create.

### `GET /api/geocoding/search/?q=denver`
Returns up to 5 `{label, lat, lon}`. `q` shorter than 3 chars -> 400. Results cached 24h, per Nominatim policy. This is a lookup you call on submit, not an autocomplete (the public endpoint forbids autocomplete).

### Error responses

| Status | When |
|---|---|
| 400 | Validation failure (`{"field": ["message"]}`), bad query params, unknown place (`{"origin": "Could not find..."}`) |
| 404 | Unknown trip id |
| 429 | Our own throttle |
| 502 | Provider returned an error or malformed data |
| 503 | `OPENROUTESERVICE_API_KEY` missing, or a provider rate-limited us (upstream 429) |
| 504 | Provider timed out |

Provider error bodies are `{"detail": "OpenRouteService timed out."}`; URLs, keys and upstream bodies are never included.

### Traffic layer

Set `TOMTOM_API_KEY` in `backend/.env` (free key from developer.tomtom.com) and restart. The browser requests tiles from `/api/traffic/tiles/...`; Django adds the key and forwards to TomTom (`traffic/map/4/tile/flow/relative`). Tiles are served with `Cache-Control: max-age=120` and are exempt from the anonymous throttle. Traffic is display-only: it does not change risk classification, ETAs or ranking.

## 5. Risk rules (as implemented)

Thresholds (`risk_engine/classifiers.py`):

| Hazard | MODERATE | HIGH | SEVERE | NO_TRAVEL |
|---|---|---|---|---|
| Wind (mph) | >= 25 | >= 35 | >= 45 | >= 55 |
| Rain (in/hr) | >= 0.10 | >= 0.25 | >= 0.50 | > 1.00 |
| Snow (in/hr) | >= 0.5 | >= 1.0 | >= 2.0 | > 3.0 |

**Boundary convention.** The assessment's ranges overlap at rain 0.25/0.50 and snow 1.0/2.0. Lower bounds are inclusive, so an exact boundary value takes the **higher** level (conservative). NO_TRAVEL for rain/snow is strictly above the top value as written; for wind it is `>= 55`. Each boundary is covered by a test.

**Load overrides** (only ever raise the wind level):
- wind >= 55: NO_TRAVEL (any load; already the base rule)
- wind 45-54 and load > 30,000 lb: NO_TRAVEL
- wind 35-44 and load > 40,000 lb: SEVERE

Checkpoint level = highest of wind/rain/snow after overrides. If any input is missing -> `UNKNOWN`.

**Weather mapping** (`weather/providers.py`): wind = `wind_speed_10m` (mph); rain = `rain + showers` (inches in the hour -> treated as in/hr); snow = `snowfall` (inches of snow, not water equivalent). Open-Meteo's hourly precipitation is an hourly *total*, not an instantaneous rate; the mean rate over that hour is used. Wind gusts are not used. An ETA is matched to the nearest forecast hour (UTC). Hours with any null value are dropped, so they surface as `UNKNOWN`.

## 6. Ranking policy (as implemented)

**Miles.** The segment between checkpoint *i* and *i+1* takes the level of the *preceding* checkpoint *i*. The final checkpoint covers 0 miles but still counts toward `has_no_travel`. Same method for all routes.

**Order** (`rank_key`, lexicographic, never a weighted sum):

1. routes with no NO_TRAVEL checkpoint first
2. fewer `no_travel_miles`
3. fewer `severe_miles`
4. fewer `high_miles + unknown_miles` (unknown is counted pessimistically as high so missing data is never rewarded)
5. lower `average_risk` (known miles only)
6. shorter `duration_minutes`

**Eligibility.** A route with any NO_TRAVEL checkpoint is `eligible: false` and is never recommended. If no route is eligible, `recommended_route_id` is `null` and a warning is added. Unknown segments do not make a route ineligible but are surfaced in `unknown_miles` and `warnings`.

## 7. Function reference

### `api/http.py`
- **`ProviderError(detail, status_code=None, upstream=None)`** - `APIException` used for every upstream failure. `upstream` is the provider's own HTTP status when known (used to detect the ORS "alternatives not supported" 400).
- **`request_json(method, url, *, provider, **kwargs)`** - the only place `httpx` is called. Applies `EXTERNAL_API_TIMEOUT_SECONDS`; maps timeout -> 504, network error -> 502, upstream 429 -> 503, other >= 400 -> 502, non-JSON -> 502.

### `api/traffic.py`
- **`TrafficStatusView.get`** - reports whether a TomTom key is configured.
- **`TrafficTileView.get`** - validates z/x/y, proxies the tile, maps provider 204/404 to 204, 429 to 503 and other failures to 502.

### `api/views.py`
- **`health(request)`** - returns `{"status": "ok"}`.

### `routing/providers.py`
- **`geocode(query, limit=5)`** - Nominatim `/search` (`jsonv2`, identifying `User-Agent`); returns `[{label, lat, lon}]`; cached 24h; malformed items -> 502.
- **`resolve_place(value, field)`** - passes through a resolved place, otherwise geocodes the free text and takes the best match; no match raises a 400 on `field`.
- **`_ors_request(origin, destination, alternatives)`** - POST `/v2/directions/driving-hgv/geojson` with `alternative_routes` (up to 3, share 0.6, weight 1.4) when requested. 503 if the API key is not configured.
- **`fetch_routes(origin, destination)`** - calls ORS with alternatives; on an upstream 400 retries once without alternatives (ORS only supports alternatives on shorter trips) and adds a warning; drops routes with identical rounded distance+duration; validates the payload. Returns `(routes, warnings)` where a route is `{distance_miles, duration_s, coords[(lat, lon)]}`. Never invents alternatives.

### `routing/geometry.py`
- **`haversine_miles(a, b)`** - great-circle distance between `(lat, lon)` pairs.
- **`sample_checkpoints(coords, total_miles, duration_s, interval_miles)`** - emits points at 0, interval, 2*interval, ... and the exact end. Provider distance/duration are authoritative; the polyline only locates each point by *fraction* of total length, then interpolates linearly between vertices. `eta_seconds` is `duration_s * fraction` (an approximation that ignores speed variation).

### `weather/providers.py`
- **`fetch_hourly(points)`** - one Open-Meteo request for many coordinates (mph, inches, UTC, `past_days=1`, `forecast_days=16`). Validates that the response count matches the request.
- **`_parse(result)`** - converts one location's arrays to `{hour_utc: {forecast_time, wind_mph, rain_in_hr, snow_in_hr}}`; converts snowfall from cm if the units say so; skips hours with nulls.

### `weather/services.py`
- **`forecast_at(points, times)`** - rounds coordinates to 2 decimals (~1 km), dedupes, serves from cache (30 min) and fetches the rest in chunks of 50; for each `(point, time)` returns the weather for the nearest hour or `None`.

### `risk_engine/classifiers.py`
- **`classify(wind_mph, rain_in_hr, snow_in_hr, load_lb)`** -> `(level, reasons)`. `reasons` lists each non-LOW hazard and any override that fired.
- **`_index(value, cuts, top_exclusive)`** - converts one value to a level index 0-4 with the boundary convention above.

### `risk_engine/ranking.py`
- **`summarize(checkpoints)`** - input `[(distance_miles, level)]`; returns miles per level, `average_risk` and `has_no_travel`.
- **`rank_key(summary, duration_minutes)`** - the tuple described in section 6.

### `trips/services.py`
- **`score_routes(routes, load_lb)`** - shared by create and forecast. One batched weather lookup for all checkpoints of all routes; sets `weather/risk/reasons` on checkpoints and `risk_summary/eligible/rank` on routes; returns the recommended index or `None`.
- **`analyze(origin, destination, departure_at, load_lb, interval_miles)`** - the pipeline in section 3 without any DB access; adds warnings for unknown checkpoints and for the no-eligible-route case.
- **`save(trip, result)`** - `@transaction.atomic`; deletes old routes, bulk-inserts routes/checkpoints, sets `recommended_route` and `warnings`.
- **`forecast(trip, offset_hours)`** - rebuilds route dicts from the DB with ETAs shifted, then `score_routes`; read-only.

### `trips/serializers.py`
- **`PlaceField`** - accepts a non-empty string or `{lat, lon[, label]}`; validates coordinate ranges.
- **`AwareDateTimeField`** - rejects naive datetimes instead of assuming UTC.
- **`TripInputSerializer`** - request validation (`load_weight_lb > 0`, interval in {10, 25, 50}).
- **`CheckpointSerializer`, `RouteSummarySerializer`, `RouteGeometrySerializer`, `RouteDetailSerializer`** - progressively richer route output.
- **`TripSerializer`** (summaries) and **`TripDetailSerializer`** (full routes).

### `trips/views.py`
- **`_trip(id)`** - fetch with prefetch or 404. **`_run(trip)`** - analyse + save + serialize (used by create and reanalyze).
- **`TripCreateView.post`**, **`TripDetailView.get`**, **`TripRoutesView.get`**, **`TripCheckpointsView.get`**, **`TripForecastView.get`**, **`TripReanalyzeView.post`** - the routes in section 4.

### `config/settings.py`
- **`env_list(name)`** - comma-separated env var -> list.
- **`_database()`** - SQLite unless `DATABASE_URL` is set; then parses `postgres://user:pass@host:port/db` into a Django config.
- `SECRET_KEY` falls back to a dev key only when `DJANGO_DEBUG` is true; otherwise startup fails. `DJANGO_DEBUG` defaults to **False**.
- Cache is Redis when `REDIS_URL` is set, else in-process memory (per worker; use Redis in production so the cache and throttle are shared).

## 8. Data model

- **Trip** - UUID pk, origin/destination label+coords, `departure_at`, `load_weight_lb`, `checkpoint_interval_miles`, `recommended_route` (nullable FK), `warnings` (JSON).
- **Route** - `trip` FK, `rank`, `eligible`, `distance_miles`, `duration_minutes`, `geometry` (JSON `[[lat, lon]]`), `risk_summary` (JSON).
- **Checkpoint** - `route` FK, `sequence`, `distance_miles`, `lat`, `lon`, `eta` (offset 0), `weather` (JSON, nullable), `risk`, `reasons` (JSON).

All three are registered in `/admin/`. Migration: `trips/migrations/0001_initial.py`.

## 9. Tests (`manage.py test`)

| File | Covers |
|---|---|
| `risk_engine/tests.py` | every wind/rain/snow boundary, load overrides at exact limits, unknown handling, mile aggregation, ranking order |
| `routing/tests.py` | sampling at 10/25/50, start/end inclusion, linear ETA, duplicate-route dropping, alternatives fallback, missing key, malformed ORS response |
| `weather/tests.py` | Open-Meteo parsing, unit conversion, null hours, batch shape, nearest-hour matching, dedupe, cache hit |
| `trips/tests.py` | validation, create + recommendation, read endpoints, forecast offset + re-ranking, unknown weather, provider failure rollback, reanalyze |

## 10. Known limitations

- Load weight is not passed to ORS, so weight restrictions are not enforced by routing.
- Alternatives are only returned for shorter trips on the public ORS API; long trips will show one route plus a warning.
- ETA is linear in distance; it ignores traffic, stops and speed limits.
- Forecast horizon is 16 days (+1 past day); later ETAs are `UNKNOWN`.
- Analysis is synchronous (a few seconds per request). Move to a background job if provider latency becomes a problem.
- Geometry is stored unsimplified; large routes produce large payloads (simplify before sending if the map is slow).
- Per-IP throttling does not enforce Nominatim's global 1 request/second; use a self-hosted or commercial geocoder at volume.

---

See also: `CHANGES_AND_DJANGO_CONCEPTS.md` for the change log, `.env` fixes and the Django concepts used.

## Worldwide routing: what is and is not limited

The app itself has no country or state restriction: geocoding, routing (OpenRouteService HGV profile) and weather (Open-Meteo) are all global, and start/end points snap to the nearest road at any distance (`radiuses: [-1, -1]`).

Verified against the live providers: Sydney to Melbourne, London to Edinburgh, Mumbai to Delhi and Los Angeles to New York (2,794 mi, 281 checkpoints at 10 mi, about 9 s).

Limits that remain, all imposed by the free providers rather than this code:

| Limit | Effect |
|---|---|
| OpenRouteService maximum route length (about 6,000 km on the public API) | longer trips return a clear 422 message from the provider |
| No road connection (for example New York to London) | 422 with the provider reason |
| Alternative routes only for trips under about 100 km | longer trips show one route plus a warning |
| Open-Meteo forecast horizon of 16 days | ETAs beyond it show as No forecast |
| Free-tier daily quotas (ORS, Open-Meteo, TomTom) | 503 with a rate-limit message when exceeded |

Provider rejections (400/404/422) now surface the provider own message with HTTP 422; refused credentials (401/403) return 503 telling you to check the key or User-Agent.

## Route traffic (`GET /api/trips/{id}/traffic/`)

Calls TomTom Routing (`traffic=true`, truck mode, up to 2 alternatives) for the trip at the departure time plus `offset_hours` (past times mean "now"; if the provider rejects a far-future time the call is repeated for "now"). TomTom computes its own routes, so each stored route is matched to the TomTom route that follows the same roads (mean polyline distance under 0.6 mi). Only matched routes receive data; unmatched routes return `matched: false` so congestion is never drawn on a different road.

```json
{ "trip_id": "...", "enabled": true, "offset_hours": 0,
  "routes": [{ "route_id": 24, "matched": true, "travel_minutes": 35.8,
               "typical_minutes": 35.6, "delay_minutes": 0.0,
               "sections": [{ "magnitude": 2, "delay_s": 240, "category": "JAM", "points": [[39.7, -104.9]] }] }] }
```

Without `TOMTOM_API_KEY` the endpoint returns `enabled: false` and no routes. Results are cached 5 minutes per trip and offset. `travel_minutes` is TomTom's own estimate and differs from the HGV duration used for ranking; only the *delay* is shown in the UI.

## How up to three routes are found

1. **Built-in alternatives** (OpenRouteService, trips under about 100 km).
2. **Separate requests**, in parallel: shortest, avoiding highways, avoiding tolls.
3. **Map-provider guide** (needs `TOMTOM_API_KEY`): TomTom suggests alternative roads; each is re-planned through OpenRouteService via points taken from it, so every route shares one vehicle profile and one timing model.

A candidate is kept only if it follows different roads from every route already chosen (mean polyline distance of at least 0.75 mi). Each route stores a `label` saying how it was found ("", "Shortest", "Avoids highways", "Alternative 1"). A failing variant never breaks a trip. Verified live: Denver to Colorado Springs, Dallas to Houston and Los Angeles to New York each return three routes.

## Stateless endpoints (used by the web app)

Because a serverless database may be a throw-away file, these endpoints take the routes in the request body (as returned by `POST /api/trips/`) and read no stored state.

| Method | Route | Body | Returns |
|---|---|---|---|
| POST | `/api/forecast/` | `load_weight_lb`, `offset_hours` (0-48), `routes[{id, distance_miles, duration_minutes, checkpoints[{sequence, distance_miles, lat, lon, eta}]}]` | same shape as `GET /api/trips/{id}/forecast/` |
| POST | `/api/forecast/sweep/` | `load_weight_lb`, `offsets[]`, `routes[...]` | `{offsets: [{offset_hours, recommended_route_id, routes[{id, rank, eligible, distance_miles, duration_minutes, risk_summary}]}]}`, summaries only, with one weather fetch for all offsets |
| POST | `/api/traffic/routes/` | `origin`, `destination`, `departure_at`, `offset_hours`, `routes[{id, geometry[[lat, lon]]}]` (at most 400 points each) | same shape as `GET /api/trips/{id}/traffic/` |

Validation: timestamps must carry a timezone, at most 5 routes, at most 1,500 checkpoints per route, offsets 0-48. Ranking and risk use exactly the same code as the stored-trip endpoints (`services.rescore`).
