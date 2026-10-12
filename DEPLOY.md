# Deploying to Vercel (frontend and backend in one project)

One deployment serves both: Vercel builds the React app to static files and runs Django as a single Python function. The frontend calls `/api/...` on the same domain, so there is no CORS setup and nothing to deploy twice.

## Files that make this work

| File | Purpose |
|---|---|
| `vercel.json` | Builds `frontend/`, publishes `frontend/dist`, sends `/api/*` to the Django function, sends every other path to `index.html` (single-page app), gives the function 60 s for slow provider calls. |
| `api/index.py` | The Vercel function. Adds `backend/` to the path, exposes Django's WSGI `app`, and runs `migrate` once per cold start. |
| `requirements.txt` | Runtime-only Python packages for the function. (`backend/requirements.txt` still holds dev/test tools.) |
| `.vercelignore` | Keeps `.env`, `.venv`, local databases and `node_modules` out of the upload. |
| `backend/config/settings.py` | Allows Vercel hostnames, uses `/tmp` SQLite when no `DATABASE_URL`, reads `sslmode` from the database URL. |

## Steps

1. Push the repository to GitHub (never commit `backend/.env`).
2. In Vercel: **Add New Project**, import the repo, leave **Root Directory** as the repository root. Vercel reads everything else from `vercel.json`; do not override the build settings.
3. Add these **Environment Variables** (Production and Preview):

| Variable | Value |
|---|---|
| `DJANGO_SECRET_KEY` | a long random string (required) |
| `DJANGO_DEBUG` | `False` |
| `OPENROUTESERVICE_API_KEY` | your OpenRouteService key (required) |
| `OPENROUTESERVICE_BASE_URL` | `https://api.openrouteservice.org` |
| `TOMTOM_API_KEY` | your TomTom key (live traffic, and extra route alternatives) |
| `DATABASE_URL` | Postgres URL, e.g. `postgres://user:pass@host/db?sslmode=require` (see below) |
| `NOMINATIM_USER_AGENT` | optional fallback geocoder contact, e.g. `Weather-Aware/1.0 (contact: you@yourdomain.com)` |
| `DJANGO_ALLOWED_HOSTS` | only if you add a custom domain, e.g. `routes.example.com` |

   `OPEN_METEO_BASE_URL` and `EXTERNAL_API_TIMEOUT_SECONDS` have working defaults.

4. Click **Deploy**. Open the URL; the status in the sidebar should read "Connected". `https://<your-app>.vercel.app/api/docs/` shows the API documentation.

## The database (SQLite is fine)

You do not need Neon or any hosted database. Without `DATABASE_URL` the backend uses Django's built-in SQLite, stored in `/tmp` on Vercel. That file is temporary and each serverless instance has its own, so the app is built not to depend on it:

- `POST /api/trips/` analyses the trip and returns everything (routes, geometry, checkpoints, weather). The browser keeps that copy in `localStorage`, so saved trips reopen from the browser even after the server restarts.
- The forecast slider, the heat strip and traffic use **stateless endpoints**: `POST /api/forecast/`, `POST /api/forecast/sweep/` and `POST /api/traffic/routes/`. The request carries the routes, so any server instance can answer and a missing server-side trip is never a problem.
- "Refresh forecast" runs a new analysis from the stored inputs and replaces the saved entry.
- The server still writes each analysis to SQLite (useful locally and in `/admin/`), and the old `GET /api/trips/{id}/...` routes work whenever the same instance still has it. The app does not rely on them.

Saved trips are therefore **per browser**: another browser or device will not see them. If you later want trips shared across devices, set `DATABASE_URL` to a Postgres database; the code already supports it and the stateless endpoints keep working.

Forecast and geocoding responses are cached in memory per instance. If a provider answers 429 under heavy use, set `OPEN_METEO_API_KEY` or `DATABASE_URL` (which also enables a shared cache).

## Limits to know

- **Function time:** analysis takes 5-15 s. `vercel.json` requests 60 s, which is the Hobby plan maximum. Pro allows more.
- **Django admin:** `/admin/` is not exposed in this setup (its static files are not served). Inspect data with your Postgres provider's console.
- **Cache and rate limits:** the in-memory cache is per instance. Set `REDIS_URL` (and add `django-redis` to `requirements.txt`) if you want a shared cache.
- **Provider quotas:** OpenRouteService, Open-Meteo and TomTom free tiers have daily limits that apply to the whole deployment.

## Verify locally before deploying

```powershell
cd frontend; npm ci; npm run build      # must succeed
cd ../backend; .venv\Scripts\python.exe manage.py test
```

## Troubleshooting the build

**"Failed to read Django application settings ... No module named django"**: Vercel found `backend/manage.py` and tried to import Django before the Python packages were installed. The repo avoids this three ways: `"framework": null` in `vercel.json`, `backend/manage.py` listed in `.vercelignore`, and the install step also runs `pip install -r requirements.txt`. If it still appears, open the failing deployment, copy the lines above that error (the dependency install output) and check that the Python version is 3.12.

## Repository hygiene (do this before pushing)

- `.gitignore` now excludes `.env`, `*.sqlite3`, `node_modules`, `dist` and virtualenvs. These were previously committed (including `backend/.env` with API keys and about 8,000 `node_modules` files); they are removed from the git index but stay on your disk.
- **Rotate the keys that were committed** (OpenRouteService, TomTom): anyone with access to the repository history can read them. Put the new values only in the Vercel Environment Variables.
- The build command deletes `backend/manage.py` inside the Vercel build container only (your repository keeps it). Vercel otherwise tries to auto-build Django from `manage.py` before the packages are available, which fails with "No module named django".
