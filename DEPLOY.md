# Deploying to Vercel (frontend and backend in one project)

One Vercel project, one deployment, one domain. It uses **Vercel Services**: the React app (`frontend/`) and the Django API (`backend/`) are built as two services and routed by `vercel.json`, so nothing is deployed twice and there is no CORS setup.

```json
{
  "services": {
    "web": { "root": "frontend/" },
    "api": { "root": "backend/", "entrypoint": "config.wsgi:application" }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "api" } },
    { "source": "/(.*)", "destination": { "service": "web" } }
  ]
}
```

`/api/*` goes to Django (which receives the original `/api/...` path, matching `config/urls.py`); everything else is the React app.

The `entrypoint` is required for Python services: Vercel detects Django but must be told which WSGI callable to serve (`config.wsgi:application` = the `application` variable in `backend/config/wsgi.py`).

## What Vercel does with each service

| Service | Detected as | How it is built |
|---|---|---|
| `web` (`frontend/`) | Vite | `npm install`, `npm run build`, serves `dist/` |
| `api` (`backend/`) | Django | installs `backend/requirements.txt`, runs `manage.py` to read `WSGI_APPLICATION` (`config.wsgi.application`), and serves it as one function |

`backend/requirements.txt` contains only runtime packages. Development and test tools are in `backend/requirements-dev.txt` (`pip install -r requirements-dev.txt` locally).

## Steps

1. Push the repository to GitHub (the `.gitignore` keeps `.env`, `node_modules`, `dist` and SQLite files out).
2. In Vercel: **Add New Project**, import the repo, leave **Root Directory** at the repository root. Vercel reads `vercel.json`; do not override build settings.
3. Add **Environment Variables** (Production and Preview):

| Variable | Value |
|---|---|
| `DJANGO_SECRET_KEY` | a long random string |
| `DJANGO_DEBUG` | `False` |
| `OPENROUTESERVICE_API_KEY` | your OpenRouteService key (required) |
| `OPENROUTESERVICE_BASE_URL` | `https://api.openrouteservice.org` |
| `TOMTOM_API_KEY` | your TomTom key (live traffic, and extra route alternatives) |
| `NOMINATIM_USER_AGENT` | optional fallback geocoder contact, e.g. `Weather-Aware/1.0 (contact: you@yourdomain.com)` |
| `DJANGO_ALLOWED_HOSTS` | only for a custom domain, e.g. `routes.example.com` |
| `DATABASE_URL` | optional Postgres URL; **not needed** (see below) |

4. Deploy, then open the site. The sidebar should say "Connected". `https://<your-app>.vercel.app/api/docs/` shows the API docs.

## The database (SQLite is fine)

You do not need Neon or any hosted database. Without `DATABASE_URL` the backend uses Django's built-in SQLite, stored in `/tmp` on Vercel. That file is temporary and every serverless instance has its own, so the app is built not to depend on it:

- `POST /api/trips/` analyses the trip and returns everything (routes, geometry, checkpoints, weather). The browser keeps that copy in `localStorage`, so saved trips reopen from the browser even after the server restarts.
- The forecast slider, heat strip and traffic use **stateless endpoints** (`POST /api/forecast/`, `POST /api/forecast/sweep/`, `POST /api/traffic/routes/`). The request carries the routes, so any instance can answer.
- "Refresh forecast" runs a new analysis from the stored inputs and replaces the saved entry.
- The server still writes each analysis to SQLite (useful locally and in `/admin/`), and `config/wsgi.py` creates the tables when an instance starts.

Saved trips are therefore **per browser**. For trips shared across devices, set `DATABASE_URL` to Postgres; the code already supports it (`?sslmode=require` included) and also switches the shared cache to the database.

Forecast and geocoding responses are cached in memory per instance. If a provider answers 429 under heavy use, set `OPEN_METEO_API_KEY` or `DATABASE_URL`.

## Limits to know

- **Django admin:** `/admin/` works but has no styling on Vercel (static files are not collected).
- **Provider quotas:** OpenRouteService, Open-Meteo and TomTom free tiers have daily limits shared by the whole deployment.
- **Function time:** analysis takes about 5-15 s; Vercel Functions on Fluid compute allow far longer.

## Troubleshooting

- **`Service "api" detected framework "django" ... must specify an "entrypoint"`:** the `api` service in `vercel.json` needs `"entrypoint": "config.wsgi:application"` (already set).
- **Build says it cannot find a service or entrypoint:** confirm `backend/manage.py` is committed (it must not be in `.vercelignore`) and `WSGI_APPLICATION` exists in `backend/config/settings.py`.
- **"No module named ..." while reading Django settings:** a package is missing from `backend/requirements.txt`.
- **404 on `/api/...`:** check the deployment's *Services* tab shows both `web` and `api`, and that `vercel.json` is at the repository root.
- **Secrets:** `backend/.env` was committed earlier. Rotate the OpenRouteService and TomTom keys and keep new values only in Vercel.

## Verify locally before deploying

```powershell
cd frontend; npm ci; npm run build      # must succeed
cd ../backend; .venv\Scripts\python.exe manage.py test
```
