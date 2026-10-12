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

## The database (important)

A serverless function has no persistent disk, so **the app needs a Postgres database** to keep trips. Without one it falls back to SQLite in `/tmp`, which is wiped whenever Vercel starts another instance: you would see saved trips return 404 and the sidebar shows a "trips not saved" warning.

Quickest setup:

1. In the Vercel project open **Storage** (or Marketplace), add **Neon** (or Supabase) Postgres and connect it to this project.
2. The integration injects `DATABASE_URL` / `POSTGRES_URL` automatically. The app reads either one, including `?sslmode=require`.
3. Redeploy. On the first request after each deploy the function creates the tables and the shared cache table; nothing to run by hand.
4. Check `https://<your-app>.vercel.app/api/health/`: it should show `"database": "postgresql"` and `"persistent": true`.

The same database also backs a **shared cache** for geocoding, forecasts and traffic. On serverless each request may land on a new instance with an empty memory cache; without a shared cache every instance would call Open-Meteo again, and the provider's per-IP limit (HTTP 429, reported as 503) would break the forecast slider. Optionally set `OPEN_METEO_API_KEY` (Open-Meteo customer plan) if you expect heavy traffic.

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
